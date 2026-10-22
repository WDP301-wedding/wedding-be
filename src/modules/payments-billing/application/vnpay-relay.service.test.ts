import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { BookingBoundaryUnitOfWork } from '../../../core/database/booking-unit-of-work.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { transitionPaymentAttempt } from '../domain/billing-policy.js';
import { createVnpayProtocol, formatVnpayDate } from '../infrastructure/vnpay.protocol.js';
import {
  controlledVnpay,
  queryFixture,
} from '../../../../tests/integration/payments-billing/vnpay-fixture.js';
import type { BillingLedgerRepository, PaymentAttempt } from './billing-ledger.port.js';
import type { ContractContext } from './payments-billing.providers.js';
import type { ProviderEvidence, StoredProviderEvidence } from './vnpay.port.js';
import { createVnpayService } from './vnpay.service.js';

function fixture(purpose: 'DEPOSIT' | 'BALANCE' = 'DEPOSIT') {
  const bookingId = randomUUID();
  const attemptId = randomUUID();
  let time = new Date('2026-10-23T00:00:00Z');
  let attempt: PaymentAttempt = {
    id: attemptId,
    bookingId,
    commandId: randomUUID(),
    purpose,
    provider: 'VNPAY',
    amountVnd: 15_000_000,
    timelineRevisionId: purpose === 'DEPOSIT' ? randomUUID() : null,
    createdAt: '2026-10-22T10:00:00Z',
    expiresAt: '2026-10-22T10:15:00Z',
    state: 'UNKNOWN',
    terminalEvidenceId: null,
  };
  const context: ContractContext = {
    requestId: randomUUID(),
    causationId: randomUUID(),
    actorAccountId: null,
    authority: 'SYSTEM',
  };
  const protocol = createVnpayProtocol(controlledVnpay);
  const checkout = {
    paymentAttemptId: attemptId,
    parameters: protocol.createCheckout(attempt, '127.0.0.1').parameters,
  };
  const boundary: BookingBoundaryUnitOfWork = {
    run: ({ context }, work) => work({ ...context, transactionScopeId: randomUUID() }),
  };
  const proofs: StoredProviderEvidence[] = [];
  const appliedPayments = new Set<string>();
  const getAttempt = vi.fn<BillingLedgerRepository['getAttempt']>((booking, id) => {
    if (booking !== bookingId || id !== attemptId) return Promise.reject(new NotFoundError());
    return Promise.resolve(attempt);
  });
  const transitionAttempt = vi.fn<BillingLedgerRepository['transitionAttempt']>((input) => {
    attempt = {
      ...attempt,
      state: transitionPaymentAttempt(attempt.state, input.evidence),
      terminalEvidenceId: input.providerEvidenceId,
    };
    return Promise.resolve(attempt);
  });
  const recordEvidence = vi.fn((_booking: string, proof: ProviderEvidence) => {
    const prior = proofs.find((stored) => stored.payloadHash === proof.payloadHash);
    if (prior !== undefined) return Promise.resolve({ evidence: prior, replayed: true });
    const evidence: StoredProviderEvidence = {
      ...proof,
      id: randomUUID(),
      decision: proof.amountVnd === attempt.amountVnd ? 'ACCEPTED' : 'AMOUNT_MISMATCH',
    };
    proofs.push(evidence);
    return Promise.resolve({ evidence, replayed: false });
  });
  const apply = vi.fn(({ paymentAttemptId }: { paymentAttemptId: string }) => {
    appliedPayments.add(paymentAttemptId);
    return Promise.resolve({ applicationStatus: 'SUCCEEDED' as const });
  });
  const releaseVerifiedFailure = vi.fn(() => Promise.resolve());
  const gateway = { query: vi.fn(() => Promise.reject(new Error('controlled CONNECT_TIMEOUT'))) };
  const service = createVnpayService({
    boundary,
    protocol,
    gateway,
    ledger: { getAttempt, transitionAttempt },
    evidence: {
      getCheckout: () => Promise.resolve(checkout),
      recordEvidence,
      getTerminalEvidence: () =>
        Promise.resolve(proofs.find((proof) => proof.id === attempt.terminalEvidenceId) ?? null),
    },
    deposits: { applySettledDeposit: apply },
    balances: { applySettledBalance: apply },
    coordinator: { releaseVerifiedFailure, recordUnknown: () => Promise.resolve() },
    now: () => time,
  } as unknown as Parameters<typeof createVnpayService>[0]);
  return {
    service,
    context,
    bookingId,
    attemptId,
    checkout,
    protocol,
    gateway,
    getAttempt,
    transitionAttempt,
    releaseVerifiedFailure,
    recordEvidence,
    proofs,
    appliedPayments,
    state: () => attempt,
    at: (instant: string) => {
      time = new Date(instant);
    },
    terminal: (state: 'SUCCEEDED' | 'FAILED') => {
      attempt = { ...attempt, state };
    },
  };
}

describe('VNPay authenticated query response relay', () => {
  it('inspects the original checkout without querying or changing an unresolved attempt', async () => {
    const f = fixture();
    f.at('2026-10-22T10:05:00Z');
    expect(await f.service.inspectCheckout(f.bookingId, f.attemptId, f.context)).toMatchObject({
      status: 'UNKNOWN',
      applicationStatus: null,
      checkoutUrl: f.protocol.checkoutUrl(f.checkout.parameters),
    });
    f.at('2026-10-23T00:00:00Z');
    expect(await f.service.inspectCheckout(f.bookingId, f.attemptId, f.context)).not.toHaveProperty(
      'checkoutUrl',
    );
    expect(f.gateway.query).not.toHaveBeenCalled();
    expect(f.recordEvidence).not.toHaveBeenCalled();
    expect(f.transitionAttempt).not.toHaveBeenCalled();
  });
  it.each([
    { authority: 'AUTHENTICATED' as const, actorAccountId: null },
    { authority: 'SYSTEM' as const, actorAccountId: randomUUID() },
  ])('denies passive internal reads without valid system context %j', async (actor) => {
    const f = fixture();
    await expect(
      f.service.inspectCheckout(f.bookingId, f.attemptId, { ...f.context, ...actor }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.getAttempt).not.toHaveBeenCalled();
  });
  it('prepares a signed query using the persisted original transaction date without provider effects', async () => {
    const f = fixture();
    const request = await f.service.prepareQuery(f.bookingId, f.attemptId, f.context);
    expect(request).toMatchObject({
      vnp_Command: 'querydr',
      vnp_TxnRef: f.attemptId,
      vnp_TransactionDate: f.checkout.parameters.vnp_CreateDate,
      vnp_CreateDate: formatVnpayDate('2026-10-23T00:00:00Z'),
    });
    expect(request!.vnp_TransactionDate).not.toBe(request!.vnp_CreateDate);
    expect(request).toEqual(
      f.protocol.createQuery({
        paymentAttemptId: f.attemptId,
        transactionDate: f.checkout.parameters.vnp_CreateDate!,
        requestId: request!.vnp_RequestId!,
        createdAt: '2026-10-23T00:00:00Z',
      }),
    );
    expect(request).not.toHaveProperty('hashSecret');
    expect(f.gateway.query).not.toHaveBeenCalled();
    expect(f.recordEvidence).not.toHaveBeenCalled();
    expect(f.transitionAttempt).not.toHaveBeenCalled();
  });

  it.each([
    { authority: 'AUTHENTICATED' as const, actorAccountId: randomUUID() },
    { authority: 'SYSTEM' as const, actorAccountId: randomUUID() },
    { authority: 'AUTHENTICATED' as const, actorAccountId: null },
  ])('denies preparation before private lookup for invalid SYSTEM context %j', async (actor) => {
    const f = fixture();
    await expect(
      f.service.prepareQuery(f.bookingId, f.attemptId, { ...f.context, ...actor }),
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(f.getAttempt).not.toHaveBeenCalled();
  });

  it.each(['SUCCEEDED', 'FAILED'] as const)(
    'does not prepare a fresh provider request for terminal %s',
    async (state) => {
      const f = fixture();
      f.terminal(state);
      expect(await f.service.prepareQuery(f.bookingId, f.attemptId, f.context)).toBeNull();
      expect(f.gateway.query).not.toHaveBeenCalled();
    },
  );

  it('accepts signed failed evidence and releases an UNKNOWN deposit without outbound query', async () => {
    const f = fixture();
    const raw = queryFixture(f.attemptId, { vnp_TransactionStatus: '02' });
    expect(await f.service.reconcile(f.bookingId, f.attemptId, f.context, { raw })).toEqual({
      status: 'FAILED',
      applicationStatus: null,
    });
    expect(f.state().state).toBe('FAILED');
    expect(f.proofs).toMatchObject([{ outcome: 'FAILED', decision: 'ACCEPTED', channel: 'QUERY' }]);
    expect(f.releaseVerifiedFailure).toHaveBeenCalledOnce();
    expect(f.appliedPayments.size).toBe(0);
    expect(f.gateway.query).not.toHaveBeenCalled();
  });

  it.each(['DEPOSIT', 'BALANCE'] as const)(
    'applies relayed signed %s success once across repeated recovery',
    async (purpose) => {
      const f = fixture(purpose);
      const raw = queryFixture(f.attemptId);
      for (let i = 0; i < 2; i++) {
        expect(await f.service.reconcile(f.bookingId, f.attemptId, f.context, { raw })).toEqual({
          status: 'SUCCEEDED',
          applicationStatus: 'SUCCEEDED',
        });
      }
      expect(f.proofs).toHaveLength(1);
      expect(f.transitionAttempt).toHaveBeenCalledOnce();
      expect([...f.appliedPayments]).toEqual([f.attemptId]);
      expect(f.releaseVerifiedFailure).not.toHaveBeenCalled();
      expect(f.gateway.query).not.toHaveBeenCalled();
    },
  );

  it.each(['signature', 'order', 'amount', 'merchant', 'malformed'] as const)(
    'keeps UNKNOWN pinned for invalid relayed %s proof',
    async (kind) => {
      const f = fixture();
      const raw =
        kind === 'malformed'
          ? { status: 'FAILED' }
          : queryFixture(f.attemptId, {
              vnp_TransactionStatus: '02',
              ...(kind === 'order' ? { vnp_TxnRef: randomUUID() } : {}),
              ...(kind === 'amount' ? { vnp_Amount: '1500000100' } : {}),
              ...(kind === 'merchant' ? { vnp_TmnCode: 'OTHER001' } : {}),
              ...(kind === 'signature' ? { vnp_SecureHash: '0'.repeat(128) } : {}),
            });
      expect(await f.service.reconcile(f.bookingId, f.attemptId, f.context, { raw })).toEqual({
        status: 'UNKNOWN',
        applicationStatus: null,
      });
      expect(f.state().state).toBe('UNKNOWN');
      expect(f.releaseVerifiedFailure).not.toHaveBeenCalled();
      expect(f.appliedPayments.size).toBe(0);
      expect(f.gateway.query).not.toHaveBeenCalled();
      if (kind === 'amount') expect(f.proofs).toMatchObject([{ decision: 'AMOUNT_MISMATCH' }]);
      else expect(f.proofs).toHaveLength(0);
    },
  );

  it('uses the existing expiry grace for signed nonpayment rather than treating relay delivery as proof of failure', async () => {
    const f = fixture();
    const raw = queryFixture(f.attemptId, {
      vnp_TransactionStatus: '01',
      vnp_TransactionNo: '0',
      vnp_PayDate: undefined,
    });
    f.at('2026-10-22T10:30:00Z');
    expect((await f.service.reconcile(f.bookingId, f.attemptId, f.context, { raw })).status).toBe(
      'UNKNOWN',
    );
    expect(f.releaseVerifiedFailure).not.toHaveBeenCalled();
    f.at('2026-10-22T10:30:00.001Z');
    expect((await f.service.reconcile(f.bookingId, f.attemptId, f.context, { raw })).status).toBe(
      'FAILED',
    );
    expect(f.proofs).toMatchObject([
      { outcome: 'UNKNOWN', nonPaymentReason: 'UNPAID' },
      { outcome: 'FAILED', resolutionReason: 'EXPIRED_UNPAID' },
    ]);
    expect(f.gateway.query).not.toHaveBeenCalled();
  });

  it('does not let a later signed failed response override an already proven success', async () => {
    const f = fixture();
    const raw = queryFixture(f.attemptId);
    await f.service.reconcile(f.bookingId, f.attemptId, f.context, { raw });
    const settled = f.state();
    const failed = queryFixture(f.attemptId, { vnp_TransactionStatus: '02' });
    expect(await f.service.reconcile(f.bookingId, f.attemptId, f.context, { raw: failed })).toEqual(
      {
        status: 'SUCCEEDED',
        applicationStatus: 'SUCCEEDED',
      },
    );
    expect(f.state()).toEqual(settled);
    expect(f.transitionAttempt).toHaveBeenCalledOnce();
    expect([...f.appliedPayments]).toEqual([f.attemptId]);
    expect(f.releaseVerifiedFailure).not.toHaveBeenCalled();
    expect(f.gateway.query).not.toHaveBeenCalled();
  });
});
