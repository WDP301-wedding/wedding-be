import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../../src/generated/prisma/client.js';
import { AppError } from '../../../src/core/errors/app-error.js';
import { createBookingBoundaryUnitOfWork } from '../../../src/core/database/booking-unit-of-work.js';
import { withIdempotencyExecution } from '../../../src/core/database/idempotency-execution.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createBillingHttpIdempotency } from '../../../src/modules/payments-billing/infrastructure/billing-http-idempotency.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'billing durable HTTP intent recovery',
  () => {
    const database = new CatalogTestDatabase('billing_http_intent');
    beforeAll(() => database.connect(), 60000);
    afterAll(() => database.disconnect());
    it('executes and replays a command whose owner uses the same single-connection pool', async () => {
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = `/${database.databaseName}`;
      const client = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url.toString(),
          max: 1,
          connectionTimeoutMillis: 500,
        }),
      });
      try {
        const service = createBillingHttpIdempotency(client);
        const input = {
          actorAccountId: randomUUID(),
          route: '/bookings/{bookingId}/payments/deposit',
          key: randomUUID(),
          payload: { bookingId: randomUUID() },
        };
        let calls = 0;
        const work = async (commandId: string) => {
          calls++;
          await client.$transaction((tx) => tx.$queryRaw`SELECT 1`);
          return { status: 201, body: { commandId } };
        };
        const result = await service.run(input, work);
        expect(await service.run(input, work)).toEqual(result);
        expect(calls).toBe(1);
      } finally {
        await client.$disconnect();
      }
    });
    it('replays exact responses, denies changed body and preserves a lifetime intent', async () => {
      const service = createBillingHttpIdempotency(database.prisma);
      const input = {
        actorAccountId: randomUUID(),
        route: '/management/billing/payments/manual',
        key: 'billing-key-1',
        payload: { amountVnd: 1 },
      };
      let calls = 0;
      const work = (commandId: string) => {
        calls++;
        return Promise.resolve({ status: 201, body: { data: { paymentId: commandId } } });
      };
      const original = await service.run(input, work);
      expect(await service.run(input, work)).toEqual(original);
      expect(calls).toBe(1);
      await expect(
        service.run({ ...input, payload: { amountVnd: 2 } }, work),
      ).rejects.toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
      const stored = await database.prisma.idempotencyRecord.findFirstOrThrow({
        where: { idempotencyKey: input.key },
      });
      expect(stored.expiresAt.getUTCFullYear()).toBe(9999);
    });
    it('rejects a concurrent execution while allowing recovery after an interrupted response', async () => {
      const service = createBillingHttpIdempotency(database.prisma);
      const input = {
        actorAccountId: randomUUID(),
        route: '/bookings/{bookingId}/payments/deposit',
        key: 'billing-key-2',
        payload: { bookingId: randomUUID() },
      };
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      let originalCommand = '';
      const first = service.run(input, async (commandId) => {
        originalCommand = commandId;
        started();
        await gate;
        throw new Error('response persistence failed');
      });
      await entered;
      await expect(
        createBillingHttpIdempotency(database.prisma).run(input, () =>
          Promise.resolve({ status: 201, body: {} }),
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: 'REQUEST_IN_PROGRESS',
        headers: { 'Retry-After': '1' },
      });
      release();
      await expect(first).rejects.toThrow('response persistence failed');
      const result = await service.run(input, (commandId) => {
        expect(commandId).toBe(originalCommand);
        return Promise.resolve({ status: 201, body: { recovered: true } });
      });
      expect(result.body).toEqual({ recovered: true });
    });
    it.each(['success', 'business error'])(
      'recovers an abandoned lease with the same command and fences the old owner %s',
      async (outcome) => {
        const service = createBillingHttpIdempotency(database.prisma);
        const input = {
          actorAccountId: randomUUID(),
          route: '/bookings/{bookingId}/payments/deposit',
          key: randomUUID(),
          payload: { bookingId: randomUUID() },
        };
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const entered = new Promise<void>((resolve) => {
          started = resolve;
        });
        let originalCommand = '';
        const first = service.run(input, async (commandId) => {
          originalCommand = commandId;
          started();
          await gate;
          if (outcome === 'business error')
            throw new AppError({ status: 409, code: 'STALE_BILLING_REVISION', message: 'Stale.' });
          return { status: 201, body: { obsolete: true } };
        });
        const stale = expect(first).rejects.toMatchObject({ code: 'REQUEST_IN_PROGRESS' });
        await entered;
        await database.prisma.$executeRaw`
          UPDATE "IdempotencyRecord"
          SET "lockedAt" = clock_timestamp() - interval '6 minutes'
          WHERE "idempotencyKey" = ${input.key}`;
        try {
          const recovered = await createBillingHttpIdempotency(database.prisma).run(input, (id) => {
            expect(id).toBe(originalCommand);
            return Promise.resolve({ status: 201, body: { recovered: true } });
          });
          expect(recovered.body).toEqual({ recovered: true });
        } finally {
          release();
          await stale;
        }
        const saved = await database.prisma.idempotencyRecord.findFirstOrThrow({
          where: { idempotencyKey: input.key },
        });
        expect(saved.status).toBe('SUCCEEDED');
        expect(saved.responseBody).toEqual({ recovered: true });
        expect(saved.expiresAt.getUTCFullYear()).toBe(9999);
      },
    );
    it('waits for an active owner transaction before taking over its expired lease', async () => {
      const service = createBillingHttpIdempotency(database.prisma);
      const bookingId = randomUUID();
      const input = {
        actorAccountId: randomUUID(),
        route: '/bookings/{bookingId}/payments/deposit',
        key: randomUUID(),
        payload: { bookingId },
      };
      await expect(
        service.run(input, () => Promise.reject(new Error('interrupted'))),
      ).rejects.toThrow('interrupted');
      const lockedAt = new Date(Date.now() - 6 * 60_000);
      const row = await database.prisma.idempotencyRecord.findFirstOrThrow({
        where: { idempotencyKey: input.key },
      });
      await database.prisma.idempotencyRecord.update({ where: { id: row.id }, data: { lockedAt } });
      let release!: () => void;
      let start!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        start = resolve;
      });
      const scope = createBookingBoundaryUnitOfWork(database.prisma);
      const active = withIdempotencyExecution({ recordId: row.id, lockedAt }, () =>
        scope.boundary.run(
          {
            bookingId,
            context: {
              actorAccountId: input.actorAccountId,
              authority: 'AUTHENTICATED',
              requestId: randomUUID(),
              causationId: randomUUID(),
            },
          },
          async () => {
            start();
            await gate;
          },
        ),
      );
      await entered;
      let takeoverStarted = false;
      const replacement = service.run(input, () => {
        takeoverStarted = true;
        return Promise.resolve({ status: 201, body: { recovered: true } });
      });
      try {
        await vi.waitFor(
          async () => {
            const [waiters] = await database.prisma.$queryRaw<{ count: number }[]>`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%interval ''5 minutes''%'`;
            expect(waiters!.count).toBeGreaterThan(0);
          },
          { timeout: 2000, interval: 10 },
        );
        expect(takeoverStarted).toBe(false);
      } finally {
        release();
        await active;
      }
      expect((await replacement).body).toEqual({ recovered: true });
    });
    it('durably replays business errors but keeps dependency failures recoverable', async () => {
      const service = createBillingHttpIdempotency(database.prisma);
      const { AppError } = await import('../../../src/core/errors/app-error.js');
      const input = {
        actorAccountId: randomUUID(),
        route: '/management/billing/refunds',
        key: 'billing-key-3',
        payload: {},
      };
      await expect(
        service.run(input, () => {
          return Promise.reject(
            new AppError({
              status: 409,
              code: 'STALE_BILLING_REVISION',
              message: 'Stale revision.',
            }),
          );
        }),
      ).rejects.toMatchObject({ code: 'STALE_BILLING_REVISION' });
      await expect(
        service.run(input, () => Promise.resolve({ status: 201, body: {} })),
      ).rejects.toMatchObject({ code: 'STALE_BILLING_REVISION' });
      const retry = { ...input, key: 'billing-key-4' };
      await expect(
        service.run(retry, () => {
          return Promise.reject(
            new AppError({ status: 503, code: 'UNAVAILABLE', message: 'Unavailable.' }),
          );
        }),
      ).rejects.toMatchObject({ status: 503 });
      expect(await service.run(retry, () => Promise.resolve({ status: 201, body: {} }))).toEqual({
        status: 201,
        body: {},
      });
    });
  },
);
