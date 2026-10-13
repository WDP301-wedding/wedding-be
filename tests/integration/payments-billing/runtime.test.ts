import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { parseEnvironment } from '../../../src/config/env.js';
import { hashOpaqueToken } from '../../../src/modules/identity-access/crypto/token.js';
import { createPrismaSessionRepository } from '../../../src/modules/identity-access/session/session.repository.js';
import { createPaymentsBillingRuntime } from '../../../src/modules/payments-billing/payments-billing.runtime.js';
import { billingResponseSchema } from '../../../src/modules/payments-billing/http/payments-billing.schemas.js';
import { CATALOG_SEED_IDS } from '../../../scripts/catalog-seed.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createManualBillingFixture, seedBillingManager } from './operations-fixture.js';
import { controlledVnpay } from './vnpay-fixture.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'billing runtime with real Identity sessions',
  () => {
    const database = new CatalogTestDatabase('billing_runtime');
    beforeAll(async () => {
      await database.connect();
      await seedBillingManager(database.prisma);
    }, 60000);
    afterAll(() => database.disconnect());
    it('exposes recovery only for a configured VNPay runtime and runs an empty recovery lane safely', async () => {
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = `/${database.databaseName}`;
      const base = parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: url.toString() });
      const runtime = await createPaymentsBillingRuntime({ ...base, vnpay: controlledVnpay });
      try {
        expect(runtime.recovery).toBeDefined();
        expect(await runtime.recovery!.run([])).toEqual({ attempted: 0, failed: 0 });
      } finally {
        await runtime.resource.close();
      }
    });
    it('uses current Identity authority for money, promotion, private reads and cached replay', async () => {
      const f = await createManualBillingFixture(database.prisma);
      const url = new URL(catalogMigrationDatabaseUrl!);
      url.pathname = `/${database.databaseName}`;
      const runtime = await createPaymentsBillingRuntime(
        parseEnvironment({ NODE_ENV: 'test', DATABASE_URL: url.toString() }),
      );
      try {
        const app = createApp({
          runtimeEnvironment: 'test',
          registerRoutes: (app) => {
            app.use('/api/v1', runtime.router);
          },
        });
        const sessions = createPrismaSessionRepository(database.prisma);
        async function issue(accountId: string) {
          const token = `wia_${randomBytes(32).toString('base64url')}`;
          const now = new Date();
          const expires = new Date(now.getTime() + 600000);
          const session = await sessions.createSession({
            accountId,
            clientKind: 'WEB',
            accessTokenHash: hashOpaqueToken(token, 'access'),
            refreshTokenHash: hashOpaqueToken(
              `wir_${randomBytes(32).toString('base64url')}`,
              'refresh',
            ),
            accessExpiresAt: expires,
            idleExpiresAt: expires,
            absoluteExpiresAt: expires,
            now,
          });
          return { token, ...session };
        }
        const manager = await issue(CATALOG_SEED_IDS.actor);
        const prospect = await issue(f.accountId);
        const read = `/api/v1/bookings/${f.bookingId}/billing`;
        await request(app).get(read).auth(prospect.token, { type: 'bearer' }).expect(403);
        const empty = billingResponseSchema.parse(
          (await request(app).get(read).auth(manager.token, { type: 'bearer' }).expect(200)).body,
        ).data;
        expect(empty).toMatchObject({
          billingRevision: 0,
          history: [],
          nextCursor: null,
          totals: { paidVnd: 0 },
        });
        await request(app)
          .post(`/api/v1/bookings/${f.bookingId}/payments/deposit`)
          .auth(prospect.token, { type: 'bearer' })
          .set('Idempotency-Key', 'runtime-disabled-provider')
          .send({ timelineRevisionId: f.timelineRevisionId })
          .expect(503);
        const manualUrl = '/api/v1/management/billing/payments/manual';
        const body = {
          bookingId: f.bookingId,
          purpose: 'DEPOSIT',
          amountVnd: 15000000,
          settledAt: f.deposit.settledAt,
          reason: 'Runtime receipt',
          evidenceReference: 'runtime-private-reference',
        };
        await request(app)
          .post(manualUrl)
          .auth(manager.token, { type: 'bearer' })
          .set('Idempotency-Key', 'runtime-manual')
          .send(body)
          .expect(201);
        expect(
          billingResponseSchema.parse(
            (await request(app).get(read).auth(prospect.token, { type: 'bearer' }).expect(200))
              .body,
          ).data.totals.paidVnd,
        ).toBe(15000000);
        await sessions.revokeSession({
          sessionId: manager.sessionId,
          accountId: manager.accountId,
          reason: 'TEST_REVOKE',
          now: new Date(),
        });
        await request(app)
          .post(manualUrl)
          .auth(manager.token, { type: 'bearer' })
          .set('Idempotency-Key', 'runtime-manual')
          .send(body)
          .expect(401);
        expect(
          await database.prisma.billingLedgerEntry.count({
            where: { bookingId: f.bookingId, kind: 'PAYMENT' },
          }),
        ).toBe(1);
      } finally {
        await runtime.resource.close();
      }
    });
    it('rejects a failed database connection and closes its runtime client', async () => {
      await expect(
        createPaymentsBillingRuntime(
          parseEnvironment({
            NODE_ENV: 'test',
            DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unavailable?connect_timeout=1',
          }),
        ),
      ).rejects.toThrow();
    });
  },
);
