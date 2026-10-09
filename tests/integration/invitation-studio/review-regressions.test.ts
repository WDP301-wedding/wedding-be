import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  ContractContext,
  PrismaBookingBoundary,
} from '../../../src/core/database/booking-boundary.js';
import type { Prisma } from '../../../src/generated/prisma/client.js';
import { CatalogTestDatabase } from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';

describe('SPEC-05 review regressions', () => {
  const database = new CatalogTestDatabase('spec05_review');
  beforeAll(() => database.connect(), 60_000);
  afterAll(() => database.disconnect(), 60_000);

  async function approvedOrder() {
    const f = await studioFixture(database.prisma);
    const design = await f.services.designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    await f.services.publication.publish(
      {
        bookingId: f.bookingId,
        designId: design.designId,
        expectedRevision: 1,
        designRevisionId: design.revisionId,
        expectedPublicationRevision: 0,
        idempotencyKey: randomUUID(),
      },
      f.couple,
    );
    const orders = f.services.printOrders;
    const requested = await orders.requestPrintOrder(
      f.bookingId,
      { lines: [{ designId: design.designId, quantity: 10 }] },
      randomUUID(),
      f.couple,
    );
    const lineId = requested.lines[0]!.lineId;
    const estimatedHandoverAt = new Date(f.now.getTime() + 86_400_000).toISOString();
    const quote = await orders.quotePrintOrder(
      requested.orderId,
      {
        expectedRevision: requested.revision,
        lines: [{ lineId, unitPriceVnd: 1_000 }],
        estimatedHandoverAt,
      },
      randomUUID(),
      f.manager,
    );
    const approved = await orders.approvePrintOrder(
      f.bookingId,
      requested.orderId,
      { expectedRevision: quote.revision, commercialRevisionId: quote.currentCommercialRevisionId },
      randomUUID(),
      f.couple,
    );
    const reportingContext = {
      ...f.contract,
      actorAccountId: null,
      authority: 'SYSTEM' as const,
      purpose: 'reporting:invitation-studio',
    };
    return { f, orders, approved, lineId, estimatedHandoverAt, reportingContext };
  }

  it('rejects superseded replacement approval without changing the accepted charge', async () => {
    const { f, orders, approved, lineId, estimatedHandoverAt } = await approvedOrder();
    expect(
      await database.prisma.billingLedgerEntry.findUnique({
        where: { id: approved.receivableChargeId! },
      }),
    ).toMatchObject({ bookingId: f.bookingId, kind: 'CHARGE', sourceType: 'PRINT_ORDER' });
    const older = await orders.proposeReplacement(
      approved.orderId,
      {
        expectedRevision: approved.revision,
        lines: [{ lineId, unitPriceVnd: 2_000 }],
        estimatedHandoverAt,
      },
      randomUUID(),
      f.manager,
    );
    const newer = await orders.proposeReplacement(
      approved.orderId,
      {
        expectedRevision: older.revision,
        lines: [{ lineId, unitPriceVnd: 3_000 }],
        estimatedHandoverAt,
      },
      randomUUID(),
      f.manager,
    );
    expect(newer.pendingReplacementProposal!.revisionNumber).toBeGreaterThan(
      older.pendingReplacementProposal!.revisionNumber,
    );

    await expect(
      orders.approveReplacement(
        f.bookingId,
        approved.orderId,
        {
          expectedRevision: newer.revision,
          commercialRevisionId: older.pendingReplacementProposal!.commercialRevisionId,
        },
        randomUUID(),
        f.couple,
      ),
    ).rejects.toMatchObject({ code: 'PRINT_QUOTE_STALE' });

    const unchanged = await database.prisma.invitationPrintOrder.findUniqueOrThrow({
      where: { id: approved.orderId },
    });
    expect(unchanged).toMatchObject({
      revision: newer.revision,
      status: 'APPROVED',
      currentCommercialRevisionId: approved.currentCommercialRevisionId,
      receivableChargeId: approved.receivableChargeId,
    });
    expect(
      await database.prisma.billingLedgerEntry.count({
        where: { bookingId: f.bookingId, kind: 'CREDIT_ADJUSTMENT' },
      }),
    ).toBe(0);

    const accepted = await orders.approveReplacement(
      f.bookingId,
      approved.orderId,
      {
        expectedRevision: newer.revision,
        commercialRevisionId: newer.pendingReplacementProposal!.commercialRevisionId,
      },
      randomUUID(),
      f.couple,
    );
    expect(accepted.currentCommercialRevisionId).toBe(
      newer.pendingReplacementProposal!.commercialRevisionId,
    );
    expect(accepted.currentCommercialRevision!.orderTotalVnd).toBe(30_000);
    const credits = await database.prisma.billingLedgerEntry.findMany({
      where: {
        kind: 'CREDIT_ADJUSTMENT',
        bookingId: f.bookingId,
        sourceEntryId: approved.receivableChargeId!,
      },
    });
    expect(credits).toHaveLength(1);
    expect(Number(credits[0]!.amountVnd)).toBe(10_000);
  }, 30_000);

  it('keeps historical report rows unchanged after replacement approval', async () => {
    const { f, orders, approved, lineId, estimatedHandoverAt, reportingContext } =
      await approvedOrder();
    const before = await f.services.reporting.readPage(
      { afterSequence: 0, limit: 500 },
      reportingContext,
    );
    const historical = before.rows.find(
      (row) => row.recordId === approved.orderId && row.value.status === 'APPROVED',
    );
    expect(historical).toBeDefined();
    expect(historical!.value).toMatchObject({
      acceptedAmountVnd: 10_000,
      commercialRevisionId: approved.currentCommercialRevisionId,
      receivableChargeId: approved.receivableChargeId,
    });

    const proposal = await orders.proposeReplacement(
      approved.orderId,
      {
        expectedRevision: approved.revision,
        lines: [{ lineId, unitPriceVnd: 2_000 }],
        estimatedHandoverAt,
      },
      randomUUID(),
      f.manager,
    );
    const replacement = await orders.approveReplacement(
      f.bookingId,
      approved.orderId,
      {
        expectedRevision: proposal.revision,
        commercialRevisionId: proposal.pendingReplacementProposal!.commercialRevisionId,
      },
      randomUUID(),
      f.couple,
    );

    const repeated = await f.services.reporting.readPage(
      { afterSequence: 0, throughSequence: before.throughSequence, limit: 500 },
      reportingContext,
    );
    expect(repeated).toEqual(before);

    const changes = await f.services.reporting.readPage(
      { afterSequence: before.throughSequence, limit: 500 },
      reportingContext,
    );
    expect(
      changes.rows.some(
        (row) =>
          row.recordId === approved.orderId &&
          row.value.commercialRevisionId === replacement.currentCommercialRevisionId &&
          row.value.receivableChargeId === replacement.receivableChargeId &&
          row.value.acceptedAmountVnd === 20_000,
      ),
    ).toBe(true);
  }, 30_000);

  it('retains both production transitions across a report fence while a command is uncommitted', async () => {
    const first = await approvedOrder();
    const second = await approvedOrder();
    const baseline = await first.f.services.reporting.readPage(
      { afterSequence: 0, limit: 500 },
      first.reportingContext,
    );
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const boundary = first.f.services.studioRepository.boundary;
    const originalRun = boundary.run.bind(boundary);
    // Keep the real command, transaction and writes; pause only its commit.
    const barrier = vi
      .spyOn(boundary, 'run')
      .mockImplementation(
        async <T>(
          input: Parameters<PrismaBookingBoundary['run']>[0],
          work: (scoped: ContractContext) => Promise<T>,
          admit?: (tx: Prisma.TransactionClient) => Promise<void>,
        ): Promise<T> =>
          originalRun(
            input,
            async (scope) => {
              const result = await work(scope);
              entered();
              await gate;
              return result;
            },
            admit,
          ),
      );
    const firstCommand = first.orders.startProduction(
      first.approved.orderId,
      { expectedRevision: first.approved.revision },
      randomUUID(),
      first.f.manager,
    );
    let secondCommand: Promise<unknown> | undefined;
    try {
      await Promise.race([ready, firstCommand]);
      let secondSettled = false;
      secondCommand = second.orders
        .startProduction(
          second.approved.orderId,
          { expectedRevision: second.approved.revision },
          randomUUID(),
          second.f.manager,
        )
        .finally(() => {
          secondSettled = true;
        });
      // Preserve the rejection for Promise.all while the fence is being read.
      void secondCommand.catch(() => undefined);
      // A safe allocator may block B until A commits. The old allocator lets B
      // commit first. Observe either state before reading the fence, without
      // depending on an arbitrary sleep or on an implementation-specific lock.
      const deadline = Date.now() + 10_000;
      while (!secondSettled) {
        const [locks] = await database.prisma.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_stat_activity
            WHERE datname = current_database()
              AND cardinality(pg_blocking_pids(pid)) > 0
          ) AS blocked
        `;
        if (locks?.blocked === true) break;
        if (Date.now() >= deadline)
          throw new Error('Second production command neither committed nor blocked.');
        await setImmediate();
      }
      const during = await first.f.services.reporting.readPage(
        { afterSequence: baseline.throughSequence, limit: 500 },
        first.reportingContext,
      );
      release();
      await Promise.all([firstCommand, secondCommand]);
      const catchup = await first.f.services.reporting.readPage(
        { afterSequence: during.throughSequence, limit: 500 },
        first.reportingContext,
      );
      const productionRows = [...during.rows, ...catchup.rows].filter(
        (row) => row.value.status === 'IN_PRODUCTION',
      );
      expect(productionRows.map((row) => row.recordId).sort()).toEqual(
        [first.approved.orderId, second.approved.orderId].sort(),
      );
      expect(new Set(productionRows.map((row) => row.sequence)).size).toBe(2);
    } finally {
      release();
      barrier.mockRestore();
      await Promise.allSettled([
        firstCommand,
        ...(secondCommand === undefined ? [] : [secondCommand]),
      ]);
    }
  }, 30_000);
});
