import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedVenueCatalog } from '../../../scripts/catalog-seed.js';
import { createBookingBoundaryUnitOfWork } from '../../../src/core/database/booking-unit-of-work.js';
import { createPaymentsBillingProviders } from '../../../src/modules/payments-billing/payments-billing.providers.js';
import type { ContractContext } from '../../../src/modules/payments-billing/application/payments-billing.providers.js';
import { createVnpayEvidenceRepository } from '../../../src/modules/payments-billing/infrastructure/vnpay.persistence.js';
import { createCheckout } from '../../../src/modules/payments-billing/infrastructure/vnpay.protocol.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { createPayableBooking } from './deposit-fixture.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('PB-W4 durable provider evidence', () => {
  const database = new CatalogTestDatabase('billing_vnpay_evidence');
  beforeAll(async () => {
    await database.connect();
    await seedVenueCatalog(database.prisma);
  }, 60000);
  afterAll(async () => {
    await database.disconnect();
  });
  const settings = {
    merchantCode: 'CTTVNP01',
    hashSecret: 'controlled-key',
    returnUrl: 'https://wedding.example.com/return',
    queryIp: '127.0.0.1',
  };
  async function fixture() {
    const booking = await createPayableBooking(database.prisma);
    const providers = createPaymentsBillingProviders(database.prisma);
    const { attempt } = await providers.deposits.createDeposit(booking.command, booking.context);
    const scope = createBookingBoundaryUnitOfWork(database.prisma);
    const repo = createVnpayEvidenceRepository(database.prisma, scope);
    const checkout = createCheckout(attempt, '127.0.0.1', settings);
    const run = <T>(work: (context: ContractContext) => Promise<T>) =>
      scope.boundary.run({ bookingId: booking.bookingId, context: booking.system }, work);
    await run((context) =>
      repo.saveCheckout(
        booking.bookingId,
        { paymentAttemptId: attempt.id, parameters: checkout.parameters },
        context,
      ),
    );
    const proof = {
      paymentAttemptId: attempt.id,
      merchantCode: settings.merchantCode,
      transactionId: '14226112',
      amountVnd: attempt.amountVnd,
      outcome: 'SUCCEEDED' as const,
      settledAt: '2026-10-08T12:00:00.000Z',
      payloadHash: 'a'.repeat(64),
      channel: 'IPN' as const,
    };
    return { booking, attempt, run, repo, proof };
  }
  it('persists evidence/dedup/audit and checkout replay, rejects mutation and quarantines changed payload', async () => {
    const f = await fixture();
    const first = await f.run((ctx) => f.repo.recordEvidence(f.booking.bookingId, f.proof, ctx));
    expect(first).toMatchObject({ replayed: false, evidence: { decision: 'ACCEPTED' } });
    expect(await f.run((ctx) => f.repo.recordEvidence(f.booking.bookingId, f.proof, ctx))).toEqual({
      ...first,
      replayed: true,
    });
    expect(
      await f.run((ctx) =>
        f.repo.recordEvidence(
          f.booking.bookingId,
          { ...f.proof, payloadHash: 'b'.repeat(64) },
          ctx,
        ),
      ),
    ).toMatchObject({ evidence: { decision: 'CONFLICT' } });
    expect(
      await f.run((ctx) =>
        f.repo.recordEvidence(
          f.booking.bookingId,
          { ...f.proof, amountVnd: 1, payloadHash: 'c'.repeat(64) },
          ctx,
        ),
      ),
    ).toMatchObject({ evidence: { decision: 'AMOUNT_MISMATCH' } });
    const snapshot = await f.run((ctx) =>
      f.repo.getCheckout(f.booking.bookingId, f.attempt.id, ctx),
    );
    expect(snapshot).not.toBeNull();
    expect(
      await f.run((ctx) =>
        f.repo.saveCheckout(
          f.booking.bookingId,
          {
            paymentAttemptId: f.attempt.id,
            parameters: { ...snapshot!.parameters, vnp_IpAddr: '192.0.2.1' },
          },
          ctx,
        ),
      ),
    ).toEqual(snapshot);
    await expect(
      database.prisma.billingProviderEvidence.update({
        where: { id: first.evidence.id },
        data: { amountVnd: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingProviderTransaction.delete({
        where: {
          merchantCode_transactionId: {
            merchantCode: settings.merchantCode,
            transactionId: f.proof.transactionId,
          },
        },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.billingVnpayCheckout.update({
        where: { paymentAttemptId: f.attempt.id },
        data: { parameters: {} },
      }),
    ).rejects.toThrow();
    expect(await f.repo.findAttemptBooking(randomUUID())).toBeNull();
    expect(await f.repo.findAttemptBooking('unknown-provider-order')).toBeNull();
    const audit = await database.prisma.auditLog.findMany({
      where: { action: 'billing.provider-evidence' },
    });
    expect(audit).toHaveLength(3);
    const text = JSON.stringify(audit);
    for (const privateField of ['controlled-key', 'vnp_', 'BankTranNo', 'CardType'])
      expect(text).not.toContain(privateField);
    await expect(
      f.repo.recordEvidence(f.booking.bookingId, f.proof, f.booking.system),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION_SCOPE' });
  });
  it('rolls back proof and claim with a failed boundary; provider transaction cannot be reused by another attempt', async () => {
    const a = await fixture();
    await expect(
      a.run(async (ctx) => {
        await a.repo.recordEvidence(a.booking.bookingId, a.proof, ctx);
        throw new Error('injected owner failure');
      }),
    ).rejects.toThrow('injected owner failure');
    expect(
      await database.prisma.billingProviderEvidence.count({
        where: { paymentAttemptId: a.attempt.id },
      }),
    ).toBe(0);
    const b = await fixture();
    const proof = { ...a.proof, transactionId: '14226113' };
    await a.run((ctx) => a.repo.recordEvidence(a.booking.bookingId, proof, ctx));
    expect(
      await b.run((ctx) =>
        b.repo.recordEvidence(
          b.booking.bookingId,
          { ...proof, paymentAttemptId: b.attempt.id },
          ctx,
        ),
      ),
    ).toMatchObject({ evidence: { decision: 'CONFLICT' } });
    expect(
      await database.prisma.billingProviderTransaction.count({
        where: { transactionId: '14226113' },
      }),
    ).toBe(1);
  });
});
