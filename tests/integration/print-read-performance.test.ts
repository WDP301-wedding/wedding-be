import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../src/core/database/diagnostics.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { controlledStorage } from './invitation-studio/controlled-storage.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('PERF-07 print page detail work', () => {
  const db = new CatalogTestDatabase('print_perf');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect(), 60000);

  it('bounds detail work for 1/3/20 orders and preserves each detail view and cursor', async () => {
    const f = await studioFixture(db.prisma);
    const design = await f.services.designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    const expected = [];
    for (let n = 0; n < 21; n++)
      expected.push(
        await f.services.printOrders.requestPrintOrder(
          f.bookingId,
          {
            lines: [{ designId: design.designId, quantity: n + 1 }],
          },
          randomUUID(),
          f.couple,
        ),
      );
    const tiedCreatedAt = expected[0]!.createdAt;
    await db.prisma.invitationPrintOrder.updateMany({
      where: { bookingId: f.bookingId },
      data: { createdAt: new Date(tiedCreatedAt), updatedAt: new Date(tiedCreatedAt) },
    });
    for (const order of expected) {
      order.createdAt = tiedCreatedAt;
      order.updatedAt = tiedCreatedAt;
    }
    const orderedIds = expected
      .map((order) => order.orderId)
      .sort()
      .reverse();
    const lines = vi.spyOn(db.prisma.invitationPrintLine, 'findMany');
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.delete('schema');
    const measured = createPrismaClient(url.toString(), true);
    const measuredOrders = createInvitationStudioServices(
      measured,
      controlledStorage().provider,
      null,
      null,
      () => f.now,
    ).printOrders;
    try {
      for (const limit of [1, 3, 20]) {
        lines.mockClear();
        const page = await f.services.printOrders.listManagementPrintOrders(
          { bookingId: f.bookingId, limit },
          f.manager,
        );
        expect(page.items).toHaveLength(limit);
        expect(page.items.map((order) => order.orderId)).toEqual(orderedIds.slice(0, limit));
        for (const item of page.items)
          expect(item).toEqual(expected.find((e) => e.orderId === item.orderId));
        expect(page.nextCursor).toBe(page.items.at(-1)!.orderId);
        expect(lines).toHaveBeenCalledTimes(1);
        const next = await f.services.printOrders.listManagementPrintOrders(
          { bookingId: f.bookingId, limit: 100, cursor: page.nextCursor! },
          f.manager,
        );
        expect(new Set([...page.items, ...next.items].map((o) => o.orderId)).size).toBe(21);
        const diagnostics = newDatabaseDiagnostics();
        const observed = await withDatabaseDiagnostics(diagnostics, () =>
          measuredOrders.listManagementPrintOrders({ bookingId: f.bookingId, limit }, f.manager),
        );
        expect(observed).toEqual(page);
        expect(diagnostics.queries).toBeLessThanOrEqual(5);
        expect(diagnostics.errors).toBe(0);
      }
    } finally {
      lines.mockRestore();
      await measured.$disconnect();
    }
  }, 30000);

  async function approvedFixture() {
    const f = await studioFixture(db.prisma);
    const designs = f.services.designs;
    const orders = f.services.printOrders;
    const design = await designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    await f.services.publication.publish(
      {
        bookingId: f.bookingId,
        designId: design.designId,
        designRevisionId: design.revisionId,
        expectedRevision: 1,
        expectedPublicationRevision: 0,
        idempotencyKey: randomUUID(),
      },
      f.couple,
    );
    const requested = await orders.requestPrintOrder(
      f.bookingId,
      { lines: [{ designId: design.designId, quantity: 10 }] },
      randomUUID(),
      f.couple,
    );
    const lineId = requested.lines[0]!.lineId;
    const quote = {
      expectedRevision: requested.revision,
      lines: [{ lineId, unitPriceVnd: 1000 }],
      estimatedHandoverAt: new Date(f.now.getTime() + 86400000).toISOString(),
    };
    const quoted = await orders.quotePrintOrder(requested.orderId, quote, randomUUID(), f.manager);
    const approved = await orders.approvePrintOrder(
      f.bookingId,
      requested.orderId,
      {
        expectedRevision: quoted.revision,
        commercialRevisionId: quoted.currentCommercialRevisionId,
      },
      randomUUID(),
      f.couple,
    );
    return { f, orders, approved, quote, lineId };
  }

  it('bounds current-revision and successor reads for 1/3/20 approved orders', async () => {
    const { f, orders, approved, quote, lineId } = await approvedFixture();
    const expected = [];
    let order = approved;
    let currentLineId = lineId;
    for (let n = 0; n < 21; n++) {
      if (n > 0) {
        const requested = await orders.requestPrintOrder(
          f.bookingId,
          { lines: [{ designId: approved.lines[0]!.designId, quantity: n + 1 }] },
          randomUUID(),
          f.couple,
        );
        currentLineId = requested.lines[0]!.lineId;
        const quoted = await orders.quotePrintOrder(
          requested.orderId,
          {
            ...quote,
            expectedRevision: requested.revision,
            lines: [{ lineId: currentLineId, unitPriceVnd: 1000 }],
          },
          randomUUID(),
          f.manager,
        );
        order = await orders.approvePrintOrder(
          f.bookingId,
          requested.orderId,
          {
            expectedRevision: quoted.revision,
            commercialRevisionId: quoted.currentCommercialRevisionId,
          },
          randomUUID(),
          f.couple,
        );
      }
      const proposal = await orders.proposeReplacement(
        order.orderId,
        {
          ...quote,
          expectedRevision: order.revision,
          lines: [{ lineId: currentLineId, unitPriceVnd: 2000 }],
        },
        randomUUID(),
        f.manager,
      );
      expected.push(proposal);
    }
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.delete('schema');
    const measured = createPrismaClient(url.toString(), true);
    try {
      const reader = createInvitationStudioServices(
        measured,
        controlledStorage().provider,
        null,
        null,
        () => f.now,
      ).printOrders;
      const counts = [];
      for (const limit of [1, 3, 20]) {
        const diagnostics = newDatabaseDiagnostics();
        const page = await withDatabaseDiagnostics(diagnostics, () =>
          reader.listManagementPrintOrders({ bookingId: f.bookingId, limit }, f.manager),
        );
        expect(page.items).toHaveLength(limit);
        for (const item of page.items) {
          expect(item).toEqual(expected.find((e) => e.orderId === item.orderId));
          expect(item.currentCommercialRevision!.orderTotalVnd).toBe(
            item.lines[0]!.quantity * 1000,
          );
          expect(item.pendingReplacementProposal!.orderTotalVnd).toBe(
            item.lines[0]!.quantity * 2000,
          );
        }
        expect(diagnostics.errors).toBe(0);
        expect(diagnostics.queries).toBeLessThanOrEqual(7);
        counts.push(diagnostics.queries);
      }
      expect(new Set(counts).size).toBe(1);
    } finally {
      await measured.$disconnect();
    }
  }, 60000);

  it('selects the newest unexpired successor without repricing accepted lines or writing histories', async () => {
    const { f, orders, approved, quote, lineId } = await approvedFixture();
    const older = await orders.proposeReplacement(
      approved.orderId,
      { ...quote, expectedRevision: approved.revision, lines: [{ lineId, unitPriceVnd: 2000 }] },
      randomUUID(),
      f.manager,
    );
    const newer = await orders.proposeReplacement(
      approved.orderId,
      { ...quote, expectedRevision: older.revision, lines: [{ lineId, unitPriceVnd: 3000 }] },
      randomUUID(),
      f.manager,
    );
    async function facts() {
      const where = { bookingId: f.bookingId };
      return {
        orders: await db.prisma.invitationPrintOrder.findMany({ where, orderBy: { id: 'asc' } }),
        lines: await db.prisma.invitationPrintLine.findMany({ where, orderBy: { id: 'asc' } }),
        revisions: await db.prisma.invitationCommercialRevision.findMany({
          where,
          orderBy: { id: 'asc' },
        }),
        ledger: await db.prisma.billingLedgerEntry.findMany({ where, orderBy: { id: 'asc' } }),
        audit: await db.prisma.invitationPrintAudit.findMany({ where, orderBy: { id: 'asc' } }),
      };
    }
    const before = await facts();
    const page = await orders.listManagementPrintOrders(
      { bookingId: f.bookingId, limit: 20 },
      f.manager,
    );
    expect(page.items).toEqual([await orders.getPrintOrder(null, approved.orderId, f.manager)]);
    expect(page.items[0]!.pendingReplacementProposal).toEqual(newer.pendingReplacementProposal);
    expect(page.items[0]!.currentCommercialRevision).toEqual(approved.currentCommercialRevision);
    expect(page.items[0]!.receivableChargeId).toBe(approved.receivableChargeId);
    const clock = vi
      .spyOn(orders, 'now')
      .mockReturnValue(new Date(newer.pendingReplacementProposal!.expiresAt));
    try {
      const expired = await orders.listManagementPrintOrders(
        { bookingId: f.bookingId, limit: 20 },
        f.manager,
      );
      expect(expired.items[0]!.pendingReplacementProposal).toBeNull();
      expect(expired.items[0]!.currentCommercialRevision).toEqual(
        approved.currentCommercialRevision,
      );
    } finally {
      clock.mockRestore();
    }
    expect(await facts()).toEqual(before);
  });

  it.each(['order', 'booking', 'missing'] as const)(
    'preserves the %s current-revision ownership/missing behavior',
    async (changed) => {
      const { f, orders, approved } = await approvedFixture();
      const read = db.prisma.invitationCommercialRevision.findMany.bind(
        db.prisma.invitationCommercialRevision,
      );
      const spy = vi
        .spyOn(db.prisma.invitationCommercialRevision, 'findMany')
        .mockImplementationOnce((args) => {
          const result = read(args);
          return result.then((rows) =>
            changed === 'missing'
              ? []
              : rows.map((row) => ({
                  ...row,
                  ...(changed === 'order'
                    ? { orderId: randomUUID() }
                    : { bookingId: randomUUID() }),
                })),
          ) as typeof result;
        });
      try {
        const reading = orders.listManagementPrintOrders(
          { bookingId: f.bookingId, limit: 20 },
          f.manager,
        );
        if (changed === 'missing') {
          expect((await reading).items[0]).toMatchObject({
            currentCommercialRevisionId: approved.currentCommercialRevisionId,
            currentCommercialRevision: null,
            pendingReplacementProposal: null,
          });
        } else await expect(reading).rejects.toMatchObject({ status: 404 });
      } finally {
        spy.mockRestore();
      }
    },
  );

  it.each([
    ['empty', 'session'],
    ['populated', 'session'],
    ['empty', 'role'],
    ['populated', 'role'],
  ] as const)('rechecks %s-page Manager authority after %s removal', async (page, changed) => {
    const { f, orders } = await approvedFixture();
    const read = db.prisma.invitationPrintLine.findMany.bind(db.prisma.invitationPrintLine);
    const spy = vi
      .spyOn(db.prisma.invitationPrintLine, 'findMany')
      .mockImplementationOnce((args) => {
        const result = read(args);
        return result.then(async (rows) => {
          if (changed === 'session')
            await db.prisma.session.update({
              where: { id: f.manager.sessionId },
              data: { status: 'REVOKED' },
            });
          else
            await db.prisma.accountRole.deleteMany({
              where: { accountId: f.manager.actorId, role: 'MANAGER' },
            });
          return rows;
        }) as typeof result;
      });
    try {
      await expect(
        orders.listManagementPrintOrders(
          { bookingId: page === 'empty' ? randomUUID() : f.bookingId, limit: 20 },
          f.manager,
        ),
      ).rejects.toMatchObject({ status: changed === 'session' ? 401 : 404 });
    } finally {
      spy.mockRestore();
    }
  });

  it('serializes replacement approval versus cancellation and posts the old credit only once', async () => {
    const { f, orders, approved, quote, lineId } = await approvedFixture();
    const proposal = await orders.proposeReplacement(
      approved.orderId,
      {
        ...quote,
        expectedRevision: approved.revision,
        lines: [{ lineId, unitPriceVnd: 2000 }],
      },
      randomUUID(),
      f.manager,
    );
    await orders.recordCancellationIntent(
      f.bookingId,
      approved.orderId,
      { expectedRevision: proposal.revision, reason: 'Local concurrency acceptance' },
      randomUUID(),
      f.couple,
    );
    const results = await Promise.allSettled([
      orders.approveReplacement(
        f.bookingId,
        approved.orderId,
        {
          expectedRevision: proposal.revision,
          commercialRevisionId: proposal.pendingReplacementProposal!.commercialRevisionId,
        },
        randomUUID(),
        f.couple,
      ),
      orders.cancelPrintOrder(
        f.bookingId,
        approved.orderId,
        { expectedRevision: proposal.revision },
        randomUUID(),
        f.manager,
        'MANAGER',
      ),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected');
    expect(failed).toMatchObject({ reason: { status: 409 } });
    const credits = await db.prisma.billingLedgerEntry.findMany({
      where: {
        bookingId: f.bookingId,
        kind: 'CREDIT_ADJUSTMENT',
        sourceEntryId: approved.receivableChargeId!,
      },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]!.amountVnd.toNumber()).toBe(10000);
    const page = await orders.listManagementPrintOrders(
      { bookingId: f.bookingId, limit: 20 },
      f.manager,
    );
    expect(page.items).toEqual([await orders.getPrintOrder(null, approved.orderId, f.manager)]);
    expect(page.items[0]!.pendingReplacementProposal).toBeNull();
  });
});
