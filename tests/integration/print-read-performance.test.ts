import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';

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
    const lines = vi.spyOn(db.prisma.invitationPrintLine, 'findMany');
    try {
      for (const limit of [1, 3, 20]) {
        lines.mockClear();
        const page = await f.services.printOrders.listManagementPrintOrders(
          { bookingId: f.bookingId, limit },
          f.manager,
        );
        expect(page.items).toHaveLength(limit);
        for (const item of page.items)
          expect(item).toEqual(expected.find((e) => e.orderId === item.orderId));
        expect(page.nextCursor).toBe(page.items.at(-1)!.orderId);
        expect(lines).toHaveBeenCalledTimes(1);
        const next = await f.services.printOrders.listManagementPrintOrders(
          { bookingId: f.bookingId, limit: 100, cursor: page.nextCursor! },
          f.manager,
        );
        expect(new Set([...page.items, ...next.items].map((o) => o.orderId)).size).toBe(21);
      }
    } finally {
      lines.mockRestore();
    }
  }, 30000);
});
