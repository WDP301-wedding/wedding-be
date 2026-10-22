import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPaymentsBillingHttpServices } from './payments-billing.http-services.js';

describe('PaymentsBillingHttpServices attempt reconciliation and cooldowns', () => {
  it('does not override fresh SUCCEEDED ledger status with stale PENDING cooldown', async () => {
    const bookingId = randomUUID();
    const attemptId = randomUUID();
    const accountId = randomUUID();
    let state: 'PENDING' | 'SUCCEEDED' = 'PENDING';

    const prisma = {
      account: { findUnique: () => Promise.resolve({ status: 'ACTIVE', roles: [{ role: 'MANAGER' }] }) },
      booking: { findUnique: () => Promise.resolve({ consultationId: randomUUID(), phase: 'CONFIRMED' }) },
    };
    const reconcile = vi.fn(() =>
      Promise.resolve({
        status: state,
        applicationStatus: state === 'SUCCEEDED' ? ('SUCCEEDED' as const) : null,
      }),
    );
    const getAttempt = vi.fn(() =>
      Promise.resolve({
        id: attemptId,
        provider: 'VNPAY',
        state,
        purpose: 'DEPOSIT',
        amountVnd: 1000,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    const providers = { ledger: { getAttempt }, vnpay: { reconcile } };
    const service = createPaymentsBillingHttpServices(
      prisma as unknown as Parameters<typeof createPaymentsBillingHttpServices>[0],
      providers as unknown as Parameters<typeof createPaymentsBillingHttpServices>[1],
    );
    const actor = { accountId, roles: ['MANAGER'] } as unknown as Parameters<typeof service.attempt>[2];

    const first = await service.attempt(bookingId, attemptId, actor, randomUUID());
    expect(first.data.status).toBe('PENDING');

    // Simulate ledger updated by background IPN/callback to SUCCEEDED
    state = 'SUCCEEDED';
    const second = await service.attempt(bookingId, attemptId, actor, randomUUID());
    expect(getAttempt).toHaveBeenCalledTimes(2);
    expect(second.data.status).toBe('SUCCEEDED');
    expect(second.data.applicationStatus).toBe('SUCCEEDED');
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('never returns checkoutUrl when attempt is expired', async () => {
    const bookingId = randomUUID();
    const attemptId = randomUUID();
    const accountId = randomUUID();

    const prisma = {
      account: { findUnique: () => Promise.resolve({ status: 'ACTIVE', roles: [{ role: 'MANAGER' }] }) },
      booking: { findUnique: () => Promise.resolve({ consultationId: randomUUID(), phase: 'CONFIRMED' }) },
    };
    const reconcile = vi.fn(() =>
      Promise.resolve({
        status: 'PENDING' as const,
        applicationStatus: null,
        checkoutUrl: 'https://vnpay.example.test/checkout',
      }),
    );
    const getAttempt = vi.fn(() =>
      Promise.resolve({
        id: attemptId,
        provider: 'VNPAY',
        state: 'PENDING' as const,
        purpose: 'DEPOSIT',
        amountVnd: 1000,
        expiresAt: new Date(Date.now() - 1000).toISOString(), // expired in past
      }),
    );
    const providers = { ledger: { getAttempt }, vnpay: { reconcile } };
    const service = createPaymentsBillingHttpServices(
      prisma as unknown as Parameters<typeof createPaymentsBillingHttpServices>[0],
      providers as unknown as Parameters<typeof createPaymentsBillingHttpServices>[1],
    );
    const actor = { accountId, roles: ['MANAGER'] } as unknown as Parameters<typeof service.attempt>[2];

    const result = await service.attempt(bookingId, attemptId, actor, randomUUID());
    expect(result.data.status).toBe('PENDING');
    expect(result.data.checkoutUrl).toBeUndefined();
  });
});
