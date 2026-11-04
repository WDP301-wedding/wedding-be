import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { PrintOrderService } from '../../src/modules/invitation-studio/infrastructure/print-order.service.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)('Manager print booking context', () => {
  const db = new CatalogTestDatabase('print_context');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect(), 60000);
  it('joins current explicit names and retained hall with one fixed query for 1/3/20 orders', async () => {
    const f = await studioFixture(db.prisma);
    await db.prisma.consultation.update({
      where: { id: f.consultationId },
      data: { brideName: 'cuong', groomName: 'cuong' },
    });
    const design = await f.services.designs.create(
      { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
      f.couple,
    );
    for (let n = 0; n < 21; n++)
      await f.services.printOrders.requestPrintOrder(
        f.bookingId,
        { lines: [{ designId: design.designId, quantity: 1 }] },
        randomUUID(),
        f.couple,
      );
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.delete('schema');
    const prisma = createPrismaClient(url.toString(), true);
    const service = createInvitationStudioServices(
      prisma,
      f.storage.provider,
      null,
      null,
      () => f.now,
    ).printOrders;
    const baseline = new PrintOrderService(
      service.repository,
      service.authorization,
      service.printable,
      service.billing,
      service.booking,
      service.timeline,
      service.now,
      service.fulfillment,
    );
    try {
      for (const limit of [1, 3, 20]) {
        const oldDiagnostics = newDatabaseDiagnostics(),
          diagnostics = newDatabaseDiagnostics();
        const oldPage = await withDatabaseDiagnostics(oldDiagnostics, () =>
          baseline.listManagementPrintOrders({ bookingId: f.bookingId, limit }, f.manager),
        );
        const page = await withDatabaseDiagnostics(diagnostics, () =>
          service.listManagementPrintOrders({ bookingId: f.bookingId, limit }, f.manager),
        );
        expect(diagnostics.errors).toBe(0);
        expect(diagnostics.queries - oldDiagnostics.queries).toBe(1);
        expect(
          page.items.map(({ bookingSummary, ...order }) => {
            expect(bookingSummary).toMatchObject({
              brideName: 'cuong',
              groomName: 'cuong',
              hallName: 'Approved hall',
              eventDate: new Date(f.now.getTime() + 10 * 86400000).toISOString().slice(0, 10),
            });
            return order;
          }),
        ).toEqual(oldPage.items);
        console.info('Print page query comparison', {
          limit,
          baseline: oldDiagnostics.queries,
          withContext: diagnostics.queries,
        });
      }
      const page = await service.listManagementPrintOrders(
        { bookingId: f.bookingId, limit: 1 },
        f.manager,
      );
      expect(await service.getPrintOrder(null, page.items[0]!.orderId, f.manager)).toEqual(
        page.items[0],
      );
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);
});
