import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';

const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
suite('Couple print list bounded reads', () => {
  const db = new CatalogTestDatabase('couple_print_perf');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect(), 60000);

  it('preserves approved prices and the newest pending proposal for each Couple order', async () => {
    const f = await studioFixture(db.prisma);
    const d = await f.services.designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    await f.services.publication.publish(
      {
        bookingId: f.bookingId,
        designId: d.designId,
        designRevisionId: d.revisionId,
        expectedRevision: 1,
        expectedPublicationRevision: 0,
        idempotencyKey: randomUUID(),
      },
      f.couple,
    );
    for (let n = 1; n <= 3; n++) {
      const requested = await f.services.printOrders.requestPrintOrder(
        f.bookingId,
        { lines: [{ designId: d.designId, quantity: n }] },
        randomUUID(),
        f.couple,
      );
      const lineId = requested.lines[0]!.lineId;
      const quotation = {
        expectedRevision: requested.revision,
        lines: [{ lineId, unitPriceVnd: 1000 }],
        estimatedHandoverAt: new Date(f.now.getTime() + 86400000).toISOString(),
      };
      const quoted = await f.services.printOrders.quotePrintOrder(
        requested.orderId,
        quotation,
        randomUUID(),
        f.manager,
      );
      const approved = await f.services.printOrders.approvePrintOrder(
        f.bookingId,
        requested.orderId,
        {
          expectedRevision: quoted.revision,
          commercialRevisionId: quoted.currentCommercialRevisionId,
        },
        randomUUID(),
        f.couple,
      );
      const older = await f.services.printOrders.proposeReplacement(
        approved.orderId,
        {
          ...quotation,
          expectedRevision: approved.revision,
          lines: [{ lineId, unitPriceVnd: 2000 }],
        },
        randomUUID(),
        f.manager,
      );
      await f.services.printOrders.proposeReplacement(
        approved.orderId,
        { ...quotation, expectedRevision: older.revision, lines: [{ lineId, unitPriceVnd: 3000 }] },
        randomUUID(),
        f.manager,
      );
    }
    const page = await f.services.printOrders.listPrintOrders(f.bookingId, { limit: 20 }, f.couple);
    const manager = await f.services.printOrders.listManagementPrintOrders(
      { bookingId: f.bookingId, limit: 20 },
      f.manager,
    );
    expect(page).toEqual(manager);
    expect(page.items).toHaveLength(3);
    for (const item of page.items) {
      expect(item.currentCommercialRevision!.orderTotalVnd).toBe(item.lines[0]!.quantity * 1000);
      expect(item.pendingReplacementProposal!.orderTotalVnd).toBe(item.lines[0]!.quantity * 3000);
    }
  }, 30000);

  it('batches details at 1/3/20 orders and preserves tied timestamp pagination', async () => {
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
          { lines: [{ designId: design.designId, quantity: n + 1 }] },
          randomUUID(),
          f.couple,
        ),
      );
    const createdAt = expected[0]!.createdAt;
    await db.prisma.invitationPrintOrder.updateMany({
      where: { bookingId: f.bookingId },
      data: { createdAt: new Date(createdAt), updatedAt: new Date(createdAt) },
    });
    for (const order of expected) Object.assign(order, { createdAt, updatedAt: createdAt });
    expected.sort((a, b) => b.orderId.localeCompare(a.orderId));
    const lines = vi.spyOn(db.prisma.invitationPrintLine, 'findMany');
    const revisions = vi.spyOn(db.prisma.invitationCommercialRevision, 'findMany');
    try {
      for (const limit of [1, 3, 20]) {
        lines.mockClear();
        revisions.mockClear();
        const page = await f.services.printOrders.listPrintOrders(f.bookingId, { limit }, f.couple);
        expect(page.items).toEqual(expected.slice(0, limit));
        expect(lines).toHaveBeenCalledTimes(1);
        expect(revisions).toHaveBeenCalledTimes(1);
        const next = await f.services.printOrders.listPrintOrders(
          f.bookingId,
          { limit: 100, cursor: page.nextCursor! },
          f.couple,
        );
        expect([...page.items, ...next.items]).toEqual(expected);
      }
    } finally {
      lines.mockRestore();
      revisions.mockRestore();
    }
  }, 30000);

  it.each([false, true])(
    'rechecks current Couple authority after reading a page (populated=%s)',
    async (populated) => {
      const f = await studioFixture(db.prisma);
      if (populated) {
        const design = await f.services.designs.create(
          { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
          f.couple,
        );
        await f.services.printOrders.requestPrintOrder(
          f.bookingId,
          { lines: [{ designId: design.designId, quantity: 1 }] },
          randomUUID(),
          f.couple,
        );
      }
      const read = db.prisma.invitationPrintLine.findMany.bind(db.prisma.invitationPrintLine);
      const spy = vi.spyOn(db.prisma.invitationPrintLine, 'findMany').mockImplementationOnce(
        (args) =>
          read(args).then(async (rows) => {
            await db.prisma.session.update({
              where: { id: f.couple.sessionId },
              data: { status: 'REVOKED' },
            });
            return rows;
          }) as ReturnType<typeof read>,
      );
      try {
        await expect(
          f.services.printOrders.listPrintOrders(f.bookingId, { limit: 20 }, f.couple),
        ).rejects.toMatchObject({ status: 401 });
      } finally {
        spy.mockRestore();
      }
    },
  );
});
