import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
        service.run(input, () => Promise.resolve({ status: 201, body: {} })),
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
