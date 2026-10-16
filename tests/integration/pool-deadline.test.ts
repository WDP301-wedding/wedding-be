import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { safeReadQuery } from '../../src/core/database/safe-read.js';
import {
  DiagnosticPool,
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../src/core/database/diagnostics.js';
import { withRequestDeadline } from '../../src/core/http/request-deadline.js';
import { createApp } from '../../src/app.js';
import { defaultHttpSecurityConfig } from '../../src/core/http/security.js';
import { createCatalogQueryService } from '../../src/modules/venue-catalog/application/catalog-query.service.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'PERF-11 native pool and read deadline',
  () => {
    const db = new CatalogTestDatabase('pool_deadline');
    let pool: pg.Pool, prisma: PrismaClient;
    beforeAll(async () => {
      if (!['localhost', '127.0.0.1'].includes(new URL(catalogMigrationDatabaseUrl!).hostname))
        throw new Error('Loopback disposable database required.');
      await db.connect();
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = '/' + db.databaseName;
      pool = new DiagnosticPool({
        connectionString: url.toString(),
        max: 1,
        connectionTimeoutMillis: 2000,
        application_name: 'wedding-perf11-safe',
      });
      prisma = new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
      await prisma.$queryRaw`SELECT 1`;
    }, 60000);
    afterAll(async () => {
      await prisma?.$disconnect();
      await db.disconnect();
    }, 60000);

    function deadline<T>(
      ms: number,
      work: () => Promise<T>,
      signal = new AbortController().signal,
    ) {
      return withRequestDeadline({ expiresAt: performance.now() + ms, signal }, work);
    }
    it('bounds queued pool acquisition and removes the timed-out waiter', async () => {
      const held = await pool.connect();
      try {
        const started = performance.now();
        await expect(pool.connect()).rejects.toThrow('timeout');
        expect(performance.now() - started).toBeLessThan(4000);
        expect(pool.waitingCount).toBe(0);
      } finally {
        held.release();
      }
      expect((await pool.query('SELECT 1 AS value')).rows).toEqual([{ value: 1 }]);
    });
    it('cancels active SQL on the server and makes the single connection reusable', async () => {
      const started = performance.now();
      await expect(
        deadline(200, () =>
          safeReadQuery(prisma, (tx) => tx.$queryRaw`SELECT pg_sleep(3)::text`, true),
        ),
      ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
      expect(performance.now() - started).toBeLessThan(1500);
      await delay(100);
      const active = await db.prisma.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity
      WHERE application_name = 'wedding-perf11-safe' AND state = 'active' AND query LIKE '%pg_sleep%'`;
      expect(Number(active[0]!.count)).toBe(0);
      expect(await prisma.$queryRaw`SELECT 1 AS value`).toEqual([{ value: 1 }]);
    });
    it('does not submit a read that expired while waiting for the only connection', async () => {
      const held = await pool.connect();
      const read = vi.fn(() => Promise.resolve(1));
      try {
        await expect(deadline(100, () => safeReadQuery(prisma, read, true))).rejects.toMatchObject({
          code: 'REQUEST_TIMEOUT',
        });
      } finally {
        held.release();
      }
      await delay(100);
      expect(read).not.toHaveBeenCalled();
      expect(await prisma.$queryRaw`SELECT 1 AS value`).toEqual([{ value: 1 }]);
    });
    it('refuses writes inside the explicitly read-only scope and retains the original error', async () => {
      await expect(
        deadline(2000, () =>
          safeReadQuery(prisma, (tx) => tx.$executeRaw`CREATE TABLE forbidden_write(id int)`, true),
        ),
      ).rejects.toThrow(/read.only/i);
    });
    it('rejects expired or disconnected read work before submitting any callback', async () => {
      const read = vi.fn(() => Promise.resolve(1));
      await expect(deadline(-1, () => safeReadQuery(prisma, read, true))).rejects.toMatchObject({
        code: 'REQUEST_TIMEOUT',
      });
      const abort = new AbortController();
      abort.abort();
      await expect(
        deadline(1000, () => safeReadQuery(prisma, read, true), abort.signal),
      ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
      expect(read).not.toHaveBeenCalled();
    });
    it('does not cancel unenrolled writes, even after the HTTP deadline expires', async () => {
      const id = randomUUID();
      await deadline(1, async () => {
        await delay(10);
        await prisma.hall.create({
          data: {
            id,
            name: 'Deadline writer',
            nameNormalized: 'deadline writer',
            description: '',
            maxGuests: 100,
            displayOrder: 1,
            updatedByAccountId: randomUUID(),
          },
        });
      });
      expect(await db.prisma.hall.count({ where: { id } })).toBe(1);
    });
    it('allows a small-pool reader and writer to finish without acquiring nested connections', async () => {
      await Promise.all([
        deadline(2000, () => safeReadQuery(prisma, (tx) => tx.hall.findMany({ take: 1 }), true)),
        prisma.hall.updateMany({
          where: { name: 'Deadline writer' },
          data: { description: 'committed' },
        }),
      ]);
      expect(await db.prisma.hall.count({ where: { description: 'committed' } })).toBe(1);
    });
    it('returns the existing HTTP timeout and skips media after a blocked hall read expires', async () => {
      vi.stubEnv('DB_SAFE_READ_DEADLINE_ENABLED', 'true');
      const media = { listSigned: vi.fn(), listSignedBatch: vi.fn() };
      const catalog = createCatalogQueryService(prisma, media);
      const app = createApp({
        runtimeEnvironment: 'test',
        securityConfig: { ...defaultHttpSecurityConfig, requestTimeoutMs: 200 },
        registerRoutes(router) {
          router.get('/api/v1/catalog/halls', async (_req, res, next) => {
            try {
              res.json({ data: await catalog.listPublicHalls({ limit: 20 }) });
            } catch (error) {
              next(error);
            }
          });
        },
      });
      try {
        await db.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`LOCK TABLE "Hall" IN ACCESS EXCLUSIVE MODE`;
          const response = await request(app).get('/api/v1/catalog/halls');
          expect(response.status).toBe(408);
          expect(response.body as unknown).toMatchObject({ error: { code: 'REQUEST_TIMEOUT' } });
          await delay(100);
          expect(media.listSignedBatch).not.toHaveBeenCalled();
        });
      } finally {
        vi.unstubAllEnvs();
      }
      expect(await prisma.hall.count()).toBe(1);
    });
    it('records the opt-in transaction cost separately from the normal pure read', async () => {
      const samples: { enabled: boolean; ms: number; queries: number }[] = [];
      for (let n = 0; n < 20; n++) {
        for (const enabled of n % 2 ? [true, false] : [false, true]) {
          const state = newDatabaseDiagnostics(),
            started = performance.now();
          const rows = await withDatabaseDiagnostics(state, () =>
            deadline(2000, () =>
              safeReadQuery(prisma, (tx) => tx.hall.findMany({ take: 20 }), enabled),
            ),
          );
          expect(rows).toHaveLength(1);
          expect(state.queries).toBe(enabled ? 5 : 1);
          samples.push({ enabled, ms: performance.now() - started, queries: state.queries });
        }
      }
      await mkdir('test-results/performance', { recursive: true });
      await writeFile(
        'test-results/performance/safe-read-cost.json',
        JSON.stringify(
          {
            node: process.version,
            poolMax: 1,
            fixtureHalls: 1,
            modelMs: 0,
            samples,
          },
          null,
          2,
        ),
      );
    });
  },
);
