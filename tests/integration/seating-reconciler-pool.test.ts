import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { DiagnosticPool, type DatabaseDiagnostics } from '../../src/core/database/diagnostics.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createSeatingRouter } from '../../src/modules/seating-plan/http/seating.router.js';
import { createSeatingServices } from '../../src/modules/seating-plan/infrastructure/seating.composition.js';
import { startSeatingReconciler } from '../../src/modules/seating-plan/infrastructure/seating-reconciler.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'PERF-04 Seating reconciler and single-connection HTTP pool',
  () => {
    const db = new CatalogTestDatabase('seating_reconciler_pool');
    let prisma: PrismaClient;
    let pool: DiagnosticPool;
    let fixture: Awaited<ReturnType<typeof studioFixture>>;
    let seating: ReturnType<typeof createSeatingServices>;
    beforeAll(async () => {
      const url = new URL(catalogMigrationDatabaseUrl!);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname))
        throw new Error('Loopback disposable database required.');
      await db.connect();
      fixture = await studioFixture(db.prisma);
      url.pathname = '/' + db.databaseName;
      pool = new DiagnosticPool({
        connectionString: url.toString(),
        max: 1,
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 60000,
        application_name: 'wedding-perf04-reconciler-regression',
      });
      prisma = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
      const studio = createInvitationStudioServices(
        prisma,
        fixture.storage.provider,
        null,
        null,
        () => fixture.now,
      );
      seating = createSeatingServices(prisma, studio, () => fixture.now);
      await seating.seating.select(
        fixture.bookingId,
        { layoutTemplateVersionId: fixture.layoutId, expectedBookingRevision: 1 },
        randomUUID(),
        fixture.couple,
      );
    }, 60000);
    afterAll(async () => {
      await prisma?.$disconnect();
      await db.disconnect();
    }, 60000);

    function http() {
      const diagnostics: DatabaseDiagnostics[] = [];
      const app = createApp({
        runtimeEnvironment: 'test',
        databaseDiagnosticsEnabled: true,
        registerRoutes(app) {
          app.use((_req, res, next) => {
            res.once('finish', () => {
              diagnostics.push(res.locals.databaseDiagnostics as DatabaseDiagnostics);
            });
            next();
          });
          app.use('/api/v1', createSeatingRouter(seating.seating, seating.resolver));
        },
      });
      return {
        diagnostics,
        read: () =>
          request(app)
            .get(`/api/v1/bookings/${fixture.bookingId}/seating-plans/current`)
            .auth(fixture.couple.accessToken, { type: 'bearer' }),
      };
    }

    it('reproduces acquisition-only HTTP failure during a deliberately held real reconciliation transaction, then recovers', async () => {
      // Controlled contention simulation, not proof of the historical production holder.
      let markEntered!: () => void;
      let allowOwnerRead!: () => void;
      const entered = new Promise<void>((resolve) => {
        markEntered = resolve;
      });
      const release = new Promise<void>((resolve) => {
        allowOwnerRead = resolve;
      });
      const owner = seating.seating.guest.owners.booking;
      const original = owner.requireConfirmedEventContext.bind(owner);
      const ownerRead = vi
        .spyOn(owner, 'requireConfirmedEventContext')
        .mockImplementationOnce(async (...args) => {
          const result = await original(...args);
          markEntered();
          await release;
          return result;
        });
      const schedule = vi.spyOn(globalThis, 'setInterval');
      const report = vi.fn();
      const worker = startSeatingReconciler(seating.seating, report);
      const tick = schedule.mock.calls[0]?.[0];
      schedule.mockRestore();
      const client = http();
      try {
        expect(typeof tick).toBe('function');
        if (typeof tick !== 'function') throw new Error('Reconciler interval was not registered.');
        tick();
        await entered;
        expect(pool.totalCount).toBe(1);
        expect(pool.idleCount).toBe(0);
        const failed = await client.read().expect(500);
        expect(failed.body as unknown).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
        expect(client.diagnostics[0]).toMatchObject({
          acquires: 1,
          queries: 0,
          maxActive: 1,
          maxIdle: 0,
          maxWaiting: 1,
        });
        expect(client.diagnostics[0]!.acquireMs).toBeGreaterThanOrEqual(1900);
        expect(pool.waitingCount).toBe(0);
      } finally {
        allowOwnerRead();
        await worker.close();
        ownerRead.mockRestore();
      }
      expect(report).not.toHaveBeenCalled();
      await client.read().expect(200);
      expect(client.diagnostics[1]!.queries).toBeGreaterThan(0);
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(1);
      expect(pool.waitingCount).toBe(0);
    }, 15000);

    it('does not schedule a disabled sweep and keeps native authenticated current-plan reads available', async () => {
      const schedule = vi.spyOn(globalThis, 'setInterval');
      const worker = startSeatingReconciler(seating.seating, vi.fn(), false);
      try {
        expect(schedule).not.toHaveBeenCalled();
        const client = http();
        await client.read().expect(200);
        expect(client.diagnostics[0]!.queries).toBeGreaterThan(0);
        expect(pool.waitingCount).toBe(0);
      } finally {
        schedule.mockRestore();
        await worker.close();
      }
    });
  },
);
