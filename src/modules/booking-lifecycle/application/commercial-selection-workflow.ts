import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { PrismaClient, BookingProposalSnapshot } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { CommercialSelectionReader } from '../../venue-catalog/application/commercial-selection.reader.js';
import {
  checkedSum,
  commercialConflict,
  contractLineSchema,
  deepFreeze,
} from '../domain/commercial-contract.js';
import { proposalMenuLinesSchema } from '../domain/booking-policy.js';
import {
  evaluateSelectionAccess,
  type SelectionFinancialBlockReason,
} from '../domain/selection-access.js';
import {
  selectionDraftSchema,
  selectionSubmitSchema,
  selectionViewSchema,
} from '../domain/commercial-selections.js';

type Access = Readonly<{
  party: 'MANAGER' | 'COUPLE';
  booking: {
    id: string;
    revision: number;
    hallId: string;
    shiftCode: 'LUNCH' | 'DINNER';
    planningHeadcount: number;
    phase: string;
    commercialModelVersion: 'LEGACY_PROPOSAL_V1' | 'FULL_CONTRACT_V1';
    depositIntents: readonly { status: string }[];
    depositSettlement: { bookingId: string } | null;
    proposalSnapshot: BookingProposalSnapshot | null;
    commercialContract: {
      currentRevisionId: string | null;
      currentRevision?: { state: string } | null;
    } | null;
  };
}>;
export async function readCustomerSelection(client: PrismaClient, access: Access) {
  const row = await client.bookingCommercialSelectionRevision.findFirst({
    where: { bookingId: access.booking.id },
    orderBy: { revisionNumber: 'desc' },
  });
  if (row)
    return selectionViewSchema.parse({
      revisionId: row.id,
      revisionNumber: row.revisionNumber,
      status: row.status,
      lines: row.lines,
      totalVnd: row.totalVnd.toNumber(),
      submittedAt: row.submittedAt?.toISOString() ?? null,
    });
  const snapshot = access.booking.proposalSnapshot;
  if (!snapshot) throw new NotFoundError();
  const menus =
    snapshot.menus == null
      ? [
          {
            packageId: snapshot.menuPackageId,
            versionId: snapshot.menuPackageVersionId,
            name: snapshot.menuName,
            description: snapshot.menuDescription,
            tableCount: snapshot.tableCount,
            priceVndPerTable: snapshot.menuPriceVndPerTable.toNumber(),
            lineTotalVnd: snapshot.baseChargeVnd.toNumber(),
          },
        ]
      : proposalMenuLinesSchema.parse(snapshot.menus);
  const lines = menus.map((m) =>
    contractLineSchema.parse({
      category: 'MENU',
      sourceId: m.packageId,
      sourceRevisionId: m.versionId,
      name: m.name,
      description: m.description,
      quantity: m.tableCount,
      unit: 'table',
      unitPriceVnd: m.priceVndPerTable,
      lineTotalVnd: m.lineTotalVnd,
    }),
  );
  return selectionViewSchema.parse({
    revisionId: null,
    revisionNumber: 0,
    status: 'NOT_STARTED',
    lines,
    totalVnd: checkedSum(lines.map((l) => l.lineTotalVnd)),
    submittedAt: null,
  });
}
type Write = <T>(
  bookingId: string,
  actor: AuthenticatedActor,
  requestId: string,
  expectedRevision: number,
  work: (client: PrismaClient, access: Access) => Promise<T>,
) => Promise<T>;
export type SelectionConversionGuard = Readonly<{
  requireConvertible(bookingId: string): Promise<void>;
  selectionBlockReason(
    bookingId: string,
    model: 'LEGACY_PROPOSAL_V1' | 'FULL_CONTRACT_V1',
  ): Promise<SelectionFinancialBlockReason | null>;
}>;
export function createCustomerSelectionWorkflow(options: {
  write: Write;
  catalog: (client: PrismaClient) => CommercialSelectionReader;
  conversion: (client: PrismaClient) => SelectionConversionGuard;
  now: () => Date;
}) {
  const decision = (
    access: Access,
    selection: z.infer<typeof selectionViewSchema>,
    financialBlock: SelectionFinancialBlockReason | null = null,
  ) =>
    evaluateSelectionAccess({
      party: access.party,
      phase: access.booking.phase,
      selectionStatus: selection.status,
      commercialModelVersion:
        access.booking.commercialContract !== null
          ? 'FULL_CONTRACT_V1'
          : access.booking.commercialModelVersion,
      contractState:
        access.booking.commercialContract?.currentRevision?.state ??
        (access.booking.commercialContract?.currentRevisionId ? 'DRAFT' : null),
      hasSettlement: access.booking.depositSettlement !== null,
      depositStatuses: access.booking.depositIntents.map((intent) => intent.status),
      financialBlock,
    });
  async function selectionAccess(
    client: PrismaClient,
    access: Access,
    selection: z.infer<typeof selectionViewSchema>,
  ) {
    const basic = decision(access, selection);
    if (!basic.canEdit) return basic;
    const model =
      access.booking.commercialContract !== null
        ? 'FULL_CONTRACT_V1'
        : access.booking.commercialModelVersion;
    return decision(
      access,
      selection,
      await options.conversion(client).selectionBlockReason(access.booking.id, model),
    );
  }
  async function editable(client: PrismaClient, access: Access) {
    if (access.party !== 'COUPLE') throw new NotFoundError();
    const selection = await readCustomerSelection(client, access);
    const allowed = await selectionAccess(client, access, selection);
    if (!allowed.canEdit)
      throw commercialConflict(allowed.blockReason ?? 'CUSTOMER_SELECTION_LOCKED');
    return selection;
  }
  async function price(
    client: PrismaClient,
    access: Access,
    lines: z.infer<typeof selectionDraftSchema>['lines'],
  ) {
    const catalog = options.catalog(client);
    const { restaurant, hall } = await catalog.requireVenue(
      access.booking.hallId,
      access.booking.shiftCode,
    );
    if (lines.some((line) => line.category === 'PRINT'))
      throw commercialConflict('PRINT_POST_DEPOSIT_ONLY');
    const resolved = await catalog.requireSelections(lines, restaurant.id);
    const priced = lines.map((line) =>
      contractLineSchema.parse(resolved.get(line.category + line.sourceId)),
    );
    const hasPriceGuarantee = priced.some((l) =>
      /bảo đảm giá|bao dam gia|bảo hiểm giá|giữ giá|price guarantee/i.test(`${l.name} ${l.description}`),
    );
    const mappedLines = priced.map((line) =>
      contractLineSchema.parse({
        ...line,
        ...(line.category === 'MENU' ? { priceGuarantee: hasPriceGuarantee } : {}),
      }),
    );
    if (
      checkedSum(mappedLines.filter((l) => l.category === 'MENU').map((l) => l.quantity)) > 500 ||
      access.booking.planningHeadcount > hall.maxGuests
    )
      throw commercialConflict('CONTRACT_CAPACITY_EXCEEDED');
    return { lines: mappedLines, totalVnd: checkedSum(mappedLines.map((l) => l.lineTotalVnd)) };
  }
  async function persist(
    client: PrismaClient,
    access: Access,
    actor: AuthenticatedActor,
    requestId: string,
    prior: z.infer<typeof selectionViewSchema>,
    priced: Awaited<ReturnType<typeof price>>,
    submit: boolean,
  ) {
    const at = options.now();
    const row = await client.bookingCommercialSelectionRevision.create({
      data: {
        id: randomUUID(),
        bookingId: access.booking.id,
        revisionNumber: prior.revisionNumber + 1,
        status: submit ? 'SUBMITTED' : 'DRAFT',
        lines: priced.lines,
        totalVnd: priced.totalVnd,
        createdAt: at,
        createdByAccountId: actor.accountId,
        submittedAt: submit ? at : null,
      },
    });
    const booking = await client.booking.update({
      where: { id: access.booking.id, revision: access.booking.revision },
      data: { revision: { increment: 1 }, commercialModelVersion: 'FULL_CONTRACT_V1' },
    });
    const action = 'booking.contract-selection-' + (submit ? 'submitted' : 'draft-saved');
    const payload = { bookingId: booking.id, selectionRevisionId: row.id, status: row.status };
    await client.auditLog.create({
      data: {
        requestId,
        actorType: 'USER',
        actorId: actor.accountId,
        action,
        entityType: 'commercial-selection',
        entityId: row.id,
        metadata: payload,
      },
    });
    await client.bookingOutboxEvent.create({
      data: {
        id: randomUUID(),
        eventType: action,
        eventVersion: 1,
        correlationId: requestId,
        causationId: requestId,
        aggregateId: booking.id,
        aggregateRevision: booking.revision,
        occurredAt: at,
        payload,
      },
    });
    return deepFreeze({
      bookingRevision: booking.revision,
      selection: selectionViewSchema.parse({
        revisionId: row.id,
        revisionNumber: row.revisionNumber,
        status: row.status,
        lines: row.lines,
        totalVnd: row.totalVnd.toNumber(),
        submittedAt: row.submittedAt?.toISOString() ?? null,
      }),
    });
  }
  return {
    selectionAccess,
    async preview(
      this: void,
      bookingId: string,
      value: unknown,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = selectionDraftSchema.parse(value);
      return options.write(
        bookingId,
        actor,
        requestId,
        input.expectedRevision,
        async (client, access) => {
          const prior = await editable(client, access);
          const priced = await price(client, access, input.lines);
          return { bookingRevision: access.booking.revision, selection: { ...prior, ...priced } };
        },
      );
    },
    async save(
      this: void,
      bookingId: string,
      value: unknown,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = selectionDraftSchema.parse(value);
      return options.write(
        bookingId,
        actor,
        requestId,
        input.expectedRevision,
        async (client, access) => {
          const prior = await editable(client, access);
          const priced = await price(client, access, input.lines);
          return persist(client, access, actor, requestId, prior, priced, false);
        },
      );
    },
    async submit(
      this: void,
      bookingId: string,
      value: unknown,
      actor: AuthenticatedActor,
      requestId: string,
    ) {
      const input = selectionSubmitSchema.parse(value);
      return options.write(
        bookingId,
        actor,
        requestId,
        input.expectedRevision,
        async (client, access) => {
          const prior = await editable(client, access);
          if (prior.status !== 'DRAFT' || prior.revisionId !== input.selectionRevisionId)
            throw commercialConflict('CONTRACT_REVISION_STALE');
          const priced = await price(
            client,
            access,
            prior.lines.map(({ category, sourceId, sourceRevisionId, quantity }) => ({
              category,
              sourceId,
              sourceRevisionId,
              quantity,
            })),
          );
          if (
            JSON.stringify(priced.lines) !== JSON.stringify(prior.lines) ||
            priced.totalVnd !== prior.totalVnd
          )
            throw commercialConflict('COMMERCIAL_PRICE_REVISION_STALE');
          return persist(client, access, actor, requestId, prior, priced, true);
        },
      );
    },
  };
}
