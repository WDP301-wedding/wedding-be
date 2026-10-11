import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { PrismaClient, Prisma } from '../../../generated/prisma/client.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../../identity-access/authorization/authorization.service.js';
import type { CommercialSelectionReader } from '../../venue-catalog/application/commercial-selection.reader.js';
import type { ContractContext } from './deposit.service.js';
import { commercialConflict, deepFreeze } from '../domain/commercial-contract.js';
import {
  appendixDraftSchema,
  appendixDecisionSchema,
  appendixDocumentSchema,
  appendixViewSchema,
  appendixDigest,
  calculateAppendixChange,
} from '../domain/commercial-appendix.js';
import { createEffectiveCommercialReader } from '../infrastructure/effective-commercial.reader.js';
import { retryCommercialWrite } from '../infrastructure/commercial-write.retry.js';

const include = { approvals: { orderBy: { party: 'asc' as const } } } as const;
type Stored = Prisma.CommercialAppendixRevisionGetPayload<{ include: typeof include }>;
function view(row: Stored) {
  return appendixViewSchema.parse({
    revisionId: row.id,
    revisionNumber: row.revisionNumber,
    state: row.state,
    document: row.document,
    documentDigest: row.documentDigest,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvals: row.approvals.map((a) => ({
      party: a.party,
      actorAccountId: a.actorAccountId,
      documentDigest: a.documentDigest,
      occurredAt: a.occurredAt.toISOString(),
    })),
  });
}
type Options = {
  scope: ReturnType<typeof createBookingBoundaryUnitOfWork>;
  catalog: (client: PrismaClient) => CommercialSelectionReader;
  financial: {
    requireMutable(bookingId: string, context: ContractContext): Promise<void>;
    registerAppendix(
      bookingId: string,
      revisionId: string,
      context: ContractContext,
    ): Promise<void>;
  };
  fulfillment: (client: PrismaClient) => {
    requirePreserved(
      bookingId: string,
      lines: z.infer<typeof appendixDocumentSchema>['afterLines'],
    ): Promise<void>;
  };
  now?: () => Date;
};
export function createCommercialAppendixService(options: Options) {
  const now = options.now ?? (() => new Date());
  async function authorized(client: PrismaClient, bookingId: string, actor: AuthenticatedActor) {
    const booking = await client.booking.findUnique({
      where: { id: bookingId },
      include: { consultation: true, proposalSnapshot: true },
    });
    if (!booking) throw new NotFoundError();
    const manager =
      actor.roles.includes('MANAGER') && booking.consultation.managerAccountId === actor.accountId;
    if (!manager) {
      if (actor.roles.includes('STAFF') && !actor.roles.includes('COUPLE'))
        throw new NotFoundError();
      await createConsultationAccessReader(
        createPrismaConsultationAccessRepository(client),
      ).requireAccess({
        accountId: actor.accountId,
        consultationId: booking.consultationId,
        minimum: 'FULL',
      });
    }
    return { booking, party: manager ? ('MANAGER' as const) : ('COUPLE' as const) };
  }
  async function write(
    bookingId: string,
    actor: AuthenticatedActor,
    requestId: string,
    expectedRevision: number,
    operation: (
      client: PrismaClient,
      access: Awaited<ReturnType<typeof authorized>>,
      context: ContractContext,
    ) => Promise<Stored>,
    action: string,
  ) {
    return retryCommercialWrite(() =>
      options.scope.boundary.run(
        {
          bookingId,
          context: {
            requestId,
            causationId: requestId,
            actorAccountId: actor.accountId,
            authority: 'AUTHENTICATED',
          },
        },
        (scoped) =>
          options.scope.withClient(bookingId, scoped, async (client) => {
            const access = await authorized(client, bookingId, actor);
            if (access.booking.revision !== expectedRevision)
              throw commercialConflict('CONTRACT_REVISION_STALE');
            if (!['CONFIRMED', 'COMPLETED'].includes(access.booking.phase))
              throw commercialConflict('APPENDIX_NOT_EDITABLE');
            await options.financial.requireMutable(bookingId, scoped);
            const row = await operation(client, access, scoped);
            const booking = await client.booking.update({
              where: { id: bookingId, revision: expectedRevision },
              data: { revision: { increment: 1 } },
            });
            const payload = {
              bookingId,
              appendixRevisionId: row.id,
              documentDigest: row.documentDigest,
              party: access.party,
              state: row.state,
            };
            await client.auditLog.create({
              data: {
                requestId,
                actorType: 'USER',
                actorId: actor.accountId,
                action: 'booking.appendix-' + action,
                entityType: 'commercial-appendix',
                entityId: row.id,
                metadata: payload,
              },
            });
            await client.bookingOutboxEvent.create({
              data: {
                id: randomUUID(),
                eventType: 'booking.appendix-' + action,
                eventVersion: 1,
                correlationId: requestId,
                causationId: requestId,
                aggregateId: bookingId,
                aggregateRevision: booking.revision,
                occurredAt: now(),
                payload,
              },
            });
            return deepFreeze({ bookingRevision: booking.revision, appendix: view(row) });
          }),
      ),
    );
  }
  async function current(client: PrismaClient, bookingId: string, revisionId: string) {
    const head = await client.commercialAppendixHead.findUnique({ where: { bookingId } });
    const row = await client.commercialAppendixRevision.findFirst({
      where: { id: revisionId, bookingId },
      include,
    });
    if (!row) throw new NotFoundError();
    if (head?.currentRevisionId !== row.id)
      throw commercialConflict('COMMERCIAL_PREDECESSOR_STALE');
    return row;
  }
  return Object.freeze({
    async authorize(bookingId: string, actor: AuthenticatedActor, revisionId?: string) {
      return options.scope.withClient(bookingId, undefined, async (client) => {
        await authorized(client, bookingId, actor);
        if (
          revisionId &&
          !(await client.commercialAppendixRevision.findFirst({
            where: { id: revisionId, bookingId },
          }))
        )
          throw new NotFoundError();
      });
    },
    async list(bookingId: string, actor: AuthenticatedActor, cursor?: string) {
      return options.scope.withClient(bookingId, undefined, async (client) => {
        const { booking } = await authorized(client, bookingId, actor);
        const effective = await createEffectiveCommercialReader(client).getEffective(bookingId);
        const head = await client.commercialAppendixHead.findUnique({ where: { bookingId } });
        if (
          cursor &&
          !(await client.commercialAppendixRevision.findFirst({ where: { id: cursor, bookingId } }))
        )
          throw new NotFoundError();
        const rows = await client.commercialAppendixRevision.findMany({
          where: { bookingId },
          include,
          orderBy: { revisionNumber: 'desc' },
          take: 51,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        return {
          bookingId,
          bookingRevision: booking.revision,
          currentRevisionId: head?.currentRevisionId ?? null,
          effectiveRevisionId: effective.revisionId,
          effectiveTotalVnd: effective.totalVnd,
          revisions: rows.slice(0, 50).map(view),
          nextCursor: rows.length > 50 ? rows[49]!.id : null,
        };
      });
    },
    async create(
      bookingId: string,
      raw: z.infer<typeof appendixDraftSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = appendixDraftSchema.parse(raw);
      return write(
        bookingId,
        actor,
        requestId,
        input.expectedRevision,
        async (client, access) => {
          const effective = await createEffectiveCommercialReader(client).getEffective(bookingId);
          if (effective.revisionId !== input.predecessorRevisionId)
            throw commercialConflict('COMMERCIAL_PREDECESSOR_STALE');
          const catalog = options.catalog(client);
          const { restaurant, hall } = await catalog.requireVenue(
            access.booking.hallId,
            access.booking.shiftCode,
          );
          const resolved = new Map<string, (typeof effective.lines)[number]>();
          for (const selection of [...input.lines].sort((a, b) =>
            (a.category + a.sourceId).localeCompare(b.category + b.sourceId),
          )) {
            const frozen = effective.lines.find(
              (l) =>
                l.category === selection.category &&
                l.sourceId === selection.sourceId &&
                l.sourceRevisionId === selection.sourceRevisionId &&
                l.quantity === selection.quantity,
            );
            resolved.set(
              selection.category + selection.sourceId,
              frozen ?? (await catalog.requireSelection(selection, restaurant.id)),
            );
          }
          const afterLines = input.lines.map((l) => resolved.get(l.category + l.sourceId)!);
          if (access.booking.planningHeadcount > hall.maxGuests)
            throw commercialConflict('CONTRACT_CAPACITY_EXCEEDED');
          const document = appendixDocumentSchema.parse({
            bookingId,
            contractRevisionId: effective.contract.contractRevisionId,
            predecessorRevisionId: effective.revisionId,
            brideName: effective.contract.document.brideName,
            groomName: effective.contract.document.groomName,
            reason: input.reason,
            beforeLines: effective.lines,
            afterLines,
            ...calculateAppendixChange(effective.lines, afterLines),
          });
          const head = await client.commercialAppendixHead.upsert({
            where: { bookingId },
            create: { bookingId },
            update: {},
            include: { currentRevision: true },
          });
          if (
            head.currentRevision &&
            ['DRAFT', 'AWAITING_APPROVAL'].includes(head.currentRevision.state)
          )
            await client.commercialAppendixRevision.update({
              where: { id: head.currentRevision.id },
              data: { state: 'SUPERSEDED' },
            });
          const row = await client.commercialAppendixRevision.create({
            data: {
              id: randomUUID(),
              bookingId,
              revisionNumber: (head.currentRevision?.revisionNumber ?? 0) + 1,
              predecessorRevisionId: effective.revisionId,
              contractRevisionId: effective.contract.contractRevisionId,
              document,
              documentDigest: appendixDigest(document),
              deltaVnd: document.deltaVnd,
              effectiveTotalVnd: document.afterTotalVnd,
              createdByAccountId: actor.accountId,
              createdAt: now(),
            },
            include,
          });
          await client.commercialAppendixHead.update({
            where: { bookingId },
            data: { currentRevisionId: row.id },
          });
          return row;
        },
        'created',
      );
    },
    async submit(
      bookingId: string,
      revisionId: string,
      raw: z.infer<typeof appendixDecisionSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = appendixDecisionSchema.parse(raw);
      return write(
        bookingId,
        actor,
        requestId,
        input.expectedRevision,
        async (client) => {
          const row = await current(client, bookingId, revisionId);
          if (row.state !== 'DRAFT') throw commercialConflict('APPENDIX_NOT_EDITABLE');
          const document = appendixDocumentSchema.parse(row.document);
          const effective = await createEffectiveCommercialReader(client).getEffective(bookingId);
          if (effective.revisionId !== document.predecessorRevisionId)
            throw commercialConflict('COMMERCIAL_PREDECESSOR_STALE');
          const catalog = options.catalog(client);
          const original = effective.contract.document;
          for (const line of document.afterLines) {
            if (document.beforeLines.some((old) => JSON.stringify(old) === JSON.stringify(line)))
              continue;
            const resolved = await catalog.requireSelection(line, original.restaurantId);
            if (JSON.stringify(resolved) !== JSON.stringify(line))
              throw commercialConflict('FINANCIAL_SOURCE_CONFLICT');
          }
          return client.commercialAppendixRevision.update({
            where: { id: row.id },
            data: { state: 'AWAITING_APPROVAL', submittedAt: now() },
            include,
          });
        },
        'submitted',
      );
    },
    async approve(
      bookingId: string,
      revisionId: string,
      raw: z.infer<typeof appendixDecisionSchema>,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = appendixDecisionSchema.parse(raw);
      return write(
        bookingId,
        actor,
        requestId,
        input.expectedRevision,
        async (client, access, scoped) => {
          const row = await current(client, bookingId, revisionId);
          if (row.state !== 'AWAITING_APPROVAL')
            throw commercialConflict('APPENDIX_APPROVAL_REQUIRED');
          if (
            row.approvals.some(
              (a) => a.party === access.party || a.actorAccountId === actor.accountId,
            )
          )
            throw commercialConflict('COMMERCIAL_APPROVAL_CONFLICT');
          await client.commercialAppendixApproval.create({
            data: {
              id: randomUUID(),
              revisionId,
              party: access.party,
              actorAccountId: actor.accountId,
              documentDigest: row.documentDigest,
              requestId,
              occurredAt: now(),
            },
          });
          if (row.approvals.length === 0)
            return client.commercialAppendixRevision.findUniqueOrThrow({
              where: { id: revisionId },
              include,
            });
          await options
            .fulfillment(client)
            .requirePreserved(bookingId, appendixDocumentSchema.parse(row.document).afterLines);
          const approved = await client.commercialAppendixRevision.update({
            where: { id: revisionId },
            data: { state: 'APPROVED', approvedAt: now() },
            include,
          });
          await options.financial.registerAppendix(bookingId, revisionId, scoped);
          await client.commercialAppendixHead.update({
            where: { bookingId },
            data: { effectiveRevisionId: revisionId },
          });
          return approved;
        },
        'approved',
      );
    },
  });
}
