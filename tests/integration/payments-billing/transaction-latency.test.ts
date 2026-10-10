import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBookingBoundaryUnitOfWork } from '../../../src/core/database/booking-unit-of-work.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'billing boundary with database latency',
  () => {
    const database = new CatalogTestDatabase('billing_latency');
    beforeAll(() => database.connect(), 60000);
    afterAll(() => database.disconnect());

    it('commits a slow transaction atomically and rolls back a later failure', async () => {
      const bookingId = randomUUID();
      const context = {
        requestId: randomUUID(),
        causationId: randomUUID(),
        actorAccountId: null,
        authority: 'SYSTEM' as const,
      };
      const scope = createBookingBoundaryUnitOfWork(database.prisma);
      const committedIds = [randomUUID(), randomUUID()];
      const rolledBackId = randomUUID();
      const fact = (id: string) => ({
        id,
        requestId: context.requestId,
        actorType: 'SYSTEM' as const,
        action: 'test.billing-latency',
        entityType: 'booking',
        entityId: bookingId,
        metadata: { controlledLatencyTest: true },
      });

      await scope.boundary.run({ bookingId, context }, async (scoped) => {
        await scope.withClient(bookingId, scoped, async (client) => {
          await client.auditLog.create({ data: fact(committedIds[0]!) });
          // Reproduce the live P2028 failure after Prisma's default five seconds.
          await client.$queryRaw`SELECT 1 AS completed FROM pg_sleep(5.2)`;
          await client.auditLog.create({ data: fact(committedIds[1]!) });
        });
      });
      expect(await database.prisma.auditLog.count({ where: { id: { in: committedIds } } })).toBe(2);

      await expect(
        scope.boundary.run({ bookingId, context }, (scoped) =>
          scope.withClient(bookingId, scoped, async (client) => {
            await client.auditLog.create({ data: fact(rolledBackId) });
            throw new Error('Controlled failure after a write');
          }),
        ),
      ).rejects.toThrow('Controlled failure after a write');
      expect(await database.prisma.auditLog.count({ where: { id: rolledBackId } })).toBe(0);
    }, 20000);
  },
);
