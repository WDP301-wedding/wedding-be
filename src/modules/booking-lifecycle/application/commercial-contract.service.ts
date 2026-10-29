import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { createBookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from '../../identity-access/authorization/authorization.service.js';
import type { CommercialSelectionReader } from '../../venue-catalog/application/commercial-selection.reader.js';
import {
  contractDraftSchema,
  contractDecisionSchema,
  contractWithdrawalSchema,
  contractDocumentSchema,
  contractViewSchema,
  checkedSum,
  contractDeposit,
  documentDigest,
  commercialConflict,
  deepFreeze,
  INCIDENTAL_CLAUSE,
  type ContractDocument,
} from '../domain/commercial-contract.js';
import { renderContractPdf } from '../infrastructure/contract-pdf.renderer.js';
import { retryCommercialWrite } from '../infrastructure/commercial-write.retry.js';

const include = {
  approvals: { orderBy: { party: 'asc' as const } },
  pdf: { select: { sha256: true } },
} as const;
type Stored = Prisma.CommercialContractRevisionGetPayload<{ include: typeof include }>;
type Scope = ReturnType<typeof createBookingBoundaryUnitOfWork>;
type Options = Readonly<{
  scope: Scope;
  catalog: (client: PrismaClient) => CommercialSelectionReader;
  conversion: (
    client: PrismaClient,
  ) => Readonly<{ requireConvertible(bookingId: string): Promise<void> }>;
  now?: () => Date;
}>;
export function contractView(row: Stored) {
  return deepFreeze(
    contractViewSchema.parse({
      revisionId: row.id,
      revisionNumber: row.revisionNumber,
      predecessorRevisionId: row.predecessorRevisionId,
      state: row.state,
      documentDigest: row.documentDigest,
      document: row.document,
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      pdfSha256: row.pdf?.sha256 ?? null,
      approvals: row.approvals.map((approval) => ({
        party: approval.party,
        actorAccountId: approval.actorAccountId,
        documentDigest: approval.documentDigest,
        occurredAt: approval.occurredAt.toISOString(),
      })),
    }),
  );
}
export function createCommercialContractService(options: Options) {
  const now = options.now ?? (() => new Date());
  async function authorized(client: PrismaClient, bookingId: string, actor: AuthenticatedActor) {
    const booking = await client.booking.findUnique({
      where: { id: bookingId },
      include: {
        consultation: true,
        proposalSnapshot: true,
        currentTimelineRevision: { include: { items: { orderBy: { displayOrder: 'asc' } } } },
        commercialContract: { include: { currentRevision: { include } } },
      },
    });
    if (booking === null) throw new NotFoundError();
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
        minimum: 'RESTRICTED',
      });
    }
    return { booking, party: manager ? ('MANAGER' as const) : ('COUPLE' as const) };
  }
  type Authorized = Awaited<ReturnType<typeof authorized>>;
  function requireManager(access: Authorized) {
    if (access.party !== 'MANAGER') throw new NotFoundError();
  }
  async function unpinned(client: PrismaClient, bookingId: string, access: Authorized) {
    if (access.booking.phase !== 'DRAFT') throw commercialConflict('CONTRACT_NOT_EDITABLE');
    if (
      (await client.bookingDepositIntent.findFirst({
        where: { bookingId, status: { in: ['ACTIVE', 'UNKNOWN', 'SETTLED'] } },
      })) !== null
    )
      throw commercialConflict('DEPOSIT_INTENT_ACTIVE');
    if ((await client.bookingDepositSettlement.findUnique({ where: { bookingId } })) !== null)
      throw commercialConflict('CONTRACT_NOT_EDITABLE');
  }
  const context = (actor: AuthenticatedActor, requestId: string) => ({
    requestId,
    causationId: requestId,
    actorAccountId: actor.accountId,
    authority: 'AUTHENTICATED' as const,
  });
  async function write<T>(
    bookingId: string,
    actor: AuthenticatedActor,
    requestId: string,
    expectedRevision: number,
    work: (client: PrismaClient, access: Authorized) => Promise<T>,
  ) {
    return retryCommercialWrite(() =>
      options.scope.boundary.run({ bookingId, context: context(actor, requestId) }, (scoped) =>
        options.scope.withClient(bookingId, scoped, async (client) => {
          const access = await authorized(client, bookingId, actor);
          if (access.booking.revision !== expectedRevision)
            throw commercialConflict('CONTRACT_REVISION_STALE');
          await unpinned(client, bookingId, access);
          return work(client, access);
        }),
      ),
    );
  }
  async function evidence(
    client: PrismaClient,
    access: Authorized,
    row: Stored,
    actor: AuthenticatedActor,
    requestId: string,
    action: string,
    reason?: string,
  ) {
    const booking = await client.booking.update({
      where: { id: access.booking.id, revision: access.booking.revision },
      data: { revision: { increment: 1 } },
    });
    const payload = {
      bookingId: booking.id,
      contractRevisionId: row.id,
      documentDigest: row.documentDigest,
      party: access.party,
      state: row.state,
      ...(reason === undefined ? {} : { reason }),
    };
    await client.auditLog.create({
      data: {
        requestId,
        actorType: 'USER',
        actorId: actor.accountId,
        action: 'booking.contract-' + action,
        entityType: 'commercial-contract',
        entityId: row.id,
        metadata: payload,
      },
    });
    await client.bookingOutboxEvent.create({
      data: {
        id: randomUUID(),
        eventType: 'booking.contract-' + action,
        eventVersion: 1,
        correlationId: requestId,
        causationId: requestId,
        aggregateId: booking.id,
        aggregateRevision: booking.revision,
        occurredAt: now(),
        payload,
      },
    });
    return deepFreeze({ bookingRevision: booking.revision, contract: contractView(row) });
  }
  async function buildDocument(
    client: PrismaClient,
    access: Authorized,
    input: z.infer<typeof contractDraftSchema>,
  ): Promise<ContractDocument> {
    const booking = access.booking;
    const timeline = booking.currentTimelineRevision;
    if (timeline === null || timeline.id !== input.timelineRevisionId)
      throw commercialConflict('COMMERCIAL_PREDECESSOR_STALE');
    const catalog = options.catalog(client);
    const { restaurant, hall } = await catalog.requireVenue(booking.hallId, booking.shiftCode);
    const resolved = await catalog.requireSelections(input.lines, restaurant.id);
    const lines = input.lines.map((line) => resolved.get(line.category + line.sourceId)!);
    const proposal = booking.proposalSnapshot;
    if (proposal === null) throw new NotFoundError();
    const tableCount = checkedSum(
      lines.filter((line) => line.category === 'MENU').map((line) => line.quantity),
    );
    // No invented seats-per-table ratio; hall capacity constrains independently entered headcount.
    if (tableCount > 500 || booking.planningHeadcount > hall.maxGuests)
      throw commercialConflict('CONTRACT_CAPACITY_EXCEEDED');
    const total = checkedSum(lines.map((line) => line.lineTotalVnd));
    return deepFreeze(
      contractDocumentSchema.parse({
        modelVersion: 'FULL_CONTRACT_V1',
        bookingId: booking.id,
        timelineRevisionId: timeline.id,
        timelineDigest: timeline.contentHash,
        timeline: timeline.items.map((item) => ({
          order: item.displayOrder,
          startTime: item.startTime.toISOString().slice(11, 16),
          title: item.title,
          description: item.description,
        })),
        brideName: booking.consultation.brideName,
        groomName: booking.consultation.groomName,
        restaurantId: restaurant.id,
        restaurantName: restaurant.displayName,
        restaurantAddress: restaurant.address,
        hallId: hall.id,
        hallName: hall.name,
        maxGuests: hall.maxGuests,
        eventDate: booking.eventDate.toISOString().slice(0, 10),
        shiftCode: booking.shiftCode,
        // Event operations and timeline validation use these already-frozen bounds.
        shiftStartTime: proposal.shiftStartTime.toISOString().slice(11, 16),
        shiftEndTime: proposal.shiftEndTime.toISOString().slice(11, 16),
        planningHeadcount: booking.planningHeadcount,
        tableCount,
        lines,
        contractTotalVnd: total,
        depositAmountVnd: contractDeposit(total),
        incidentalClause: INCIDENTAL_CLAUSE,
      }),
    );
  }
  async function prepareDraft(
    client: PrismaClient,
    access: Authorized,
    input: z.infer<typeof contractDraftSchema>,
  ) {
    requireManager(access);
    const current = access.booking.commercialContract?.currentRevision;
    if (current?.state === 'APPROVED' || (current?.approvals.length ?? 0) > 0)
      throw commercialConflict('CONTRACT_NOT_EDITABLE');
    if (
      (access.booking.commercialContract?.currentRevisionId ?? null) !== input.predecessorRevisionId
    )
      throw commercialConflict('COMMERCIAL_PREDECESSOR_STALE');
    if (access.booking.commercialContract === null)
      await options.conversion(client).requireConvertible(access.booking.id);
    return buildDocument(client, access, input);
  }
  async function createRevision(
    client: PrismaClient,
    access: Authorized,
    document: ContractDocument,
    actor: AuthenticatedActor,
  ) {
    const head = access.booking.commercialContract;
    const prior = head?.currentRevision;
    if (prior !== null && prior !== undefined)
      await client.commercialContractRevision.update({
        where: { id: prior.id },
        data: { state: 'SUPERSEDED' },
      });
    if (head === null)
      await client.commercialContract.create({ data: { bookingId: access.booking.id } });
    const row = await client.commercialContractRevision.create({
      data: {
        id: randomUUID(),
        bookingId: access.booking.id,
        revisionNumber: (prior?.revisionNumber ?? 0) + 1,
        predecessorRevisionId: prior?.id ?? null,
        timelineRevisionId: document.timelineRevisionId,
        document,
        documentDigest: documentDigest(document),
        contractTotalVnd: document.contractTotalVnd,
        depositAmountVnd: document.depositAmountVnd,
        createdAt: now(),
        createdByAccountId: actor.accountId,
        lines: {
          create: document.lines.map((line, displayOrder) => ({
            ...line,
            id: randomUUID(),
            displayOrder,
          })),
        },
      },
      include,
    });
    await client.commercialContract.update({
      where: { bookingId: access.booking.id },
      data: { currentRevisionId: row.id },
    });
    return row;
  }
  function requireCurrent(access: Authorized, revisionId: string) {
    const row = access.booking.commercialContract?.currentRevision;
    if (row === null || row === undefined || row.id !== revisionId) throw new NotFoundError();
    return row;
  }
  return Object.freeze({
    async authorize(bookingId: string, actor: AuthenticatedActor, revisionId?: string) {
      return options.scope.withClient(bookingId, undefined, async (client) => {
        await authorized(client, bookingId, actor);
        if (
          revisionId !== undefined &&
          (await client.commercialContractRevision.findFirst({
            where: { id: revisionId, bookingId },
          })) === null
        )
          throw new NotFoundError();
      });
    },
    async list(bookingId: string, actor: AuthenticatedActor, cursor?: string) {
      return options.scope.boundary.run(
        { bookingId, context: context(actor, randomUUID()) },
        (scoped) =>
          options.scope.withClient(bookingId, scoped, async (client) => {
            const { booking, party } = await authorized(client, bookingId, actor);
            if (
              cursor !== undefined &&
              (await client.commercialContractRevision.findFirst({
                where: { id: cursor, bookingId },
                select: { id: true },
              })) === null
            )
              throw new NotFoundError();
            const rows = await client.commercialContractRevision.findMany({
              where: { bookingId },
              orderBy: { revisionNumber: 'desc' },
              take: 51,
              ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
              include,
            });
            const current = booking.commercialContract?.currentRevision;
            const timeline = booking.currentTimelineRevision;
            const pinned = await client.bookingDepositIntent.findFirst({
              where: { bookingId, status: { in: ['ACTIVE', 'UNKNOWN', 'SETTLED'] } },
              select: { id: true },
            });
            const editable = booking.phase === 'DRAFT' && pinned === null;
            const ownApproval =
              current?.approvals.some((approval) => approval.party === party) ?? false;
            const eligible =
              current?.state === 'APPROVED' &&
              timeline !== null &&
              current.timelineRevisionId === timeline.id &&
              timeline.managerApprovedAt !== null &&
              timeline.coupleApprovedAt !== null &&
              ['DRAFT', 'AWAITING_DEPOSIT'].includes(booking.phase);
            return deepFreeze({
              bookingId,
              bookingRevision: booking.revision,
              modelVersion:
                booking.commercialContract === null
                  ? ('LEGACY_PROPOSAL_V1' as const)
                  : ('FULL_CONTRACT_V1' as const),
              currentRevisionId: booking.commercialContract?.currentRevisionId ?? null,
              eligibleForDeposit: eligible,
              capabilities: {
                canManageDraft:
                  editable &&
                  party === 'MANAGER' &&
                  current?.state !== 'APPROVED' &&
                  (current?.approvals.length ?? 0) === 0,
                canApprove:
                  editable &&
                  current?.state === 'AWAITING_APPROVAL' &&
                  !ownApproval &&
                  current.timelineRevisionId === timeline?.id,
                canWithdrawApproval: editable && ownApproval,
              },
              revisions: rows.slice(0, 50).map(contractView),
              nextCursor: rows.length > 50 ? rows[49]!.id : null,
            });
          }),
      );
    },
    async preview(bookingId: string, value: unknown, actor: AuthenticatedActor, requestId: string) {
      const input = contractDraftSchema.parse(value);
      // Reuse the exact edit guards/pricing under the same booking transaction.
      // No revision, approval, ledger entry or evidence is created by a preview.
      return write(bookingId, actor, requestId, input.expectedRevision, async (client, access) => {
        return deepFreeze({
          bookingRevision: access.booking.revision,
          document: await prepareDraft(client, access, input),
        });
      });
    },
    async create(bookingId: string, value: unknown, actor: AuthenticatedActor, requestId: string) {
      const input = contractDraftSchema.parse(value);
      return write(bookingId, actor, requestId, input.expectedRevision, async (client, access) => {
        const document = await prepareDraft(client, access, input);
        const row = await createRevision(client, access, document, actor);
        return evidence(client, access, row, actor, requestId, 'draft-created');
      });
    },
    async submit(
      bookingId: string,
      revisionId: string,
      value: unknown,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = contractDecisionSchema.parse(value);
      return write(bookingId, actor, requestId, input.expectedRevision, async (client, access) => {
        requireManager(access);
        const prior = requireCurrent(access, revisionId);
        if (prior.state !== 'DRAFT') throw commercialConflict('CONTRACT_REVISION_STALE');
        const document = contractDocumentSchema.parse(prior.document);
        if (document.brideName === null || document.groomName === null)
          throw commercialConflict('COUPLE_NAMES_INCOMPLETE');
        const refreshed = await buildDocument(client, access, {
          expectedRevision: input.expectedRevision,
          predecessorRevisionId: prior.predecessorRevisionId,
          timelineRevisionId: prior.timelineRevisionId,
          lines: document.lines.map(({ category, sourceId, sourceRevisionId, quantity }) => ({
            category,
            sourceId,
            sourceRevisionId,
            quantity,
          })),
        });
        if (documentDigest(refreshed) !== prior.documentDigest)
          throw commercialConflict('COMMERCIAL_PRICE_REVISION_STALE');
        const row = await client.commercialContractRevision.update({
          where: { id: revisionId },
          data: { state: 'AWAITING_APPROVAL', submittedAt: now() },
          include,
        });
        return evidence(client, access, row, actor, requestId, 'submitted');
      });
    },
    async approve(
      bookingId: string,
      revisionId: string,
      value: unknown,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = contractDecisionSchema.parse(value);
      return write(bookingId, actor, requestId, input.expectedRevision, async (client, access) => {
        const prior = requireCurrent(access, revisionId);
        if (prior.state !== 'AWAITING_APPROVAL' && prior.state !== 'APPROVED')
          throw commercialConflict('CONTRACT_REVISION_STALE');
        const document = contractDocumentSchema.parse(prior.document);
        if (document.brideName === null || document.groomName === null)
          throw commercialConflict('COUPLE_NAMES_INCOMPLETE');
        if (access.booking.currentTimelineRevisionId !== prior.timelineRevisionId)
          throw commercialConflict('COMMERCIAL_PREDECESSOR_STALE');
        const own = prior.approvals.find((item) => item.party === access.party);
        if (own !== undefined)
          return { bookingRevision: access.booking.revision, contract: contractView(prior) };
        if (prior.approvals.some((item) => item.actorAccountId === actor.accountId))
          throw commercialConflict('CONTRACT_DISTINCT_APPROVERS_REQUIRED');
        await client.commercialContractApproval.create({
          data: {
            id: randomUUID(),
            revisionId,
            party: access.party,
            actorAccountId: actor.accountId,
            documentDigest: prior.documentDigest,
            requestId,
            occurredAt: now(),
          },
        });
        const row = await client.commercialContractRevision.update({
          where: { id: revisionId },
          data: prior.approvals.length === 1 ? { state: 'APPROVED', approvedAt: now() } : {},
          include,
        });
        if (row.state === 'APPROVED') {
          const pdf = await renderContractPdf(contractView(row));
          await client.commercialContractPdf.create({
            data: {
              revisionId,
              bytes: new Uint8Array(pdf.bytes),
              sha256: pdf.sha256,
              createdAt: row.approvedAt!,
            },
          });
        }
        const final = await client.commercialContractRevision.findUniqueOrThrow({
          where: { id: revisionId },
          include,
        });
        return evidence(client, access, final, actor, requestId, 'approved');
      });
    },
    async withdraw(
      bookingId: string,
      revisionId: string,
      value: unknown,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = contractWithdrawalSchema.parse(value);
      return write(bookingId, actor, requestId, input.expectedRevision, async (client, access) => {
        const prior = requireCurrent(access, revisionId);
        if (!prior.approvals.some((item) => item.party === access.party))
          throw commercialConflict('CONTRACT_APPROVAL_REQUIRED');
        const row = await createRevision(
          client,
          access,
          contractDocumentSchema.parse(prior.document),
          actor,
        );
        return evidence(client, access, row, actor, requestId, 'withdrawn', input.reason);
      });
    },
    async pdf(bookingId: string, revisionId: string, actor: AuthenticatedActor) {
      return options.scope.boundary.run(
        { bookingId, context: context(actor, randomUUID()) },
        (scoped) =>
          options.scope.withClient(bookingId, scoped, async (client) => {
            await authorized(client, bookingId, actor);
            const row = await client.commercialContractRevision.findFirst({
              where: { id: revisionId, bookingId },
              include,
            });
            if (row === null) throw new NotFoundError();
            const retained = await client.commercialContractPdf.findUnique({
              where: { revisionId },
            });
            if (retained !== null)
              return { bytes: Buffer.from(retained.bytes), sha256: retained.sha256 };
            return renderContractPdf(contractView(row));
          }),
      );
    },
  });
}
