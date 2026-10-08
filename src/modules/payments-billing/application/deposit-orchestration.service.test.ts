import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type {
  BillingLedgerRepository,
  LedgerEntry,
  PaymentAttempt,
} from './billing-ledger.port.js';
import type {
  BookingLifecycleReader,
  BookingDepositIntentCoordinator,
  BookingDepositRecorder,
} from './payments-billing.providers.js';
import type { BookingCommercialSnapshotReader } from '../../booking-lifecycle/application/booking-snapshots.js';
import { createDepositOrchestrationService } from './deposit-orchestration.service.js';

const bookingId = randomUUID();
const timelineRevisionId = randomUUID();
const accountId = randomUUID();
const context = {
  requestId: randomUUID(),
  causationId: randomUUID(),
  actorAccountId: accountId,
  authority: 'AUTHENTICATED' as const,
};
const system = { ...context, actorAccountId: null, authority: 'SYSTEM' as const };
const instant = new Date('2026-10-08T06:00:00Z');

function setup() {
  const entries: LedgerEntry[] = [];
  const applied = new Set<string>();
  let attempt: PaymentAttempt | null = null;
  const ledger = {
    isDepositApplied: vi.fn<BillingLedgerRepository['isDepositApplied']>((_booking, id) =>
      Promise.resolve(applied.has(id)),
    ),
    markDepositApplied: vi.fn<BillingLedgerRepository['markDepositApplied']>((_booking, id) => {
      applied.add(id);
      return Promise.resolve();
    }),
    findAttemptByCommand: vi.fn<BillingLedgerRepository['findAttemptByCommand']>(() =>
      Promise.resolve(attempt),
    ),
    createAttempt: vi.fn<BillingLedgerRepository['createAttempt']>((input) => {
      attempt = { ...input, state: 'CREATED', terminalEvidenceId: null };
      return Promise.resolve({ attempt, replayed: false });
    }),
    getAttempt: vi.fn<BillingLedgerRepository['getAttempt']>(() => Promise.resolve(attempt!)),
    getLedger: vi.fn<BillingLedgerRepository['getLedger']>(() =>
      Promise.resolve({
        revision: entries.length,
        entries,
        totals: {
          acceptedChargesVnd: 1_000,
          paidVnd: 0,
          refundedVnd: 0,
          netPaidVnd: 0,
          outstandingVnd: 1_000,
          creditVnd: 0,
        },
      }),
    ),
    append: vi.fn<BillingLedgerRepository['append']>((input) => {
      const prior = entries.find((entry) => entry.sourceRevisionId === input.sourceRevisionId);
      if (prior) return Promise.resolve({ entry: prior, replayed: true });
      const entry = { ...input, revision: entries.length + 1 };
      entries.push(entry);
      return Promise.resolve({ entry, replayed: false });
    }),
  };
  const booking = {
    requireBookingAccess: vi.fn<BookingLifecycleReader['requireBookingAccess']>(() =>
      Promise.resolve({ bookingId, consultationId: randomUUID(), phase: 'DRAFT' as const }),
    ),
    requireDepositEligibility: vi.fn<BookingLifecycleReader['requireDepositEligibility']>(() =>
      Promise.resolve({
        eligible: true,
        reasonCode: 'ELIGIBLE' as const,
        consultationId: randomUUID(),
        coupleAccountId: accountId,
        bookingRevision: 1,
        depositAmountVnd: 300,
      }),
    ),
    requireConfirmedEventContext: vi.fn<BookingLifecycleReader['requireConfirmedEventContext']>(),
  } satisfies BookingLifecycleReader;
  const commercial = {
    getAccepted: vi.fn<BookingCommercialSnapshotReader['getAccepted']>(() =>
      Promise.resolve({
        bookingId,
        commercialRevisionId: randomUUID(),
        bookingRevision: 1,
        baseChargeVnd: 1_000,
        depositAmountVnd: 300,
        menuPackageVersionId: randomUUID(),
        tableCount: 1,
        acceptedAt: instant.toISOString(),
      }),
    ),
  } satisfies BookingCommercialSnapshotReader;
  const coordinator = {
    reserve: vi.fn<BookingDepositIntentCoordinator['reserve']>(() =>
      Promise.resolve({ paymentAttemptId: attempt!.id, bookingRevision: 2, replayed: false }),
    ),
    recordUnknown: vi.fn<BookingDepositIntentCoordinator['recordUnknown']>(),
    releaseVerifiedFailure: vi.fn<BookingDepositIntentCoordinator['releaseVerifiedFailure']>(),
  } satisfies BookingDepositIntentCoordinator;
  const recorder = {
    recordSuccessfulDeposit: vi.fn<BookingDepositRecorder['recordSuccessfulDeposit']>(() =>
      Promise.resolve({ phase: 'CONFIRMED' as const, replayed: false }),
    ),
  } satisfies BookingDepositRecorder;
  const service = createDepositOrchestrationService({
    ledger,
    booking,
    commercial,
    coordinator,
    recorder,
    boundary: { run: (_input, work) => work(system) },
    now: () => instant,
  });
  return {
    service,
    ledger,
    booking,
    commercial,
    coordinator,
    recorder,
    entries,
    succeed: () => {
      attempt = { ...attempt!, state: 'SUCCEEDED', terminalEvidenceId: randomUUID() };
    },
  };
}

describe('deposit orchestration through owner contracts', () => {
  it('rejects amounts outside the official VNPay transport range before claiming an attempt or hold', async () => {
    const fixture = setup();
    const amount = 10_000_000_000;
    const eligibility = await fixture.booking.requireDepositEligibility({
      bookingId,
      timelineRevisionId,
    });
    fixture.booking.requireDepositEligibility.mockResolvedValue({
      ...eligibility,
      depositAmountVnd: amount,
    });
    const command = { bookingId, timelineRevisionId, commandId: randomUUID() };
    const commercial = await fixture.commercial.getAccepted(command, context);
    fixture.commercial.getAccepted.mockResolvedValue({ ...commercial, depositAmountVnd: amount });
    await expect(fixture.service.createDeposit(command, context)).rejects.toMatchObject({
      status: 422,
      code: 'PAYMENT_PROVIDER_AMOUNT_UNSUPPORTED',
    });
    expect(fixture.ledger.createAttempt).not.toHaveBeenCalled();
    expect(fixture.coordinator.reserve).not.toHaveBeenCalled();
  });
  it('preserves the original base acceptance when a later timeline retains its commercial revision', async () => {
    const fixture = setup();
    const command = { bookingId, timelineRevisionId, commandId: randomUUID() };
    const commercial = await fixture.commercial.getAccepted(command, context);
    fixture.commercial.getAccepted.mockResolvedValue(commercial);
    await fixture.service.createDeposit(command, context);
    fixture.ledger.findAttemptByCommand.mockResolvedValue(null);
    fixture.commercial.getAccepted.mockResolvedValue({
      ...commercial,
      acceptedAt: '2026-10-08T07:00:00Z',
    });
    await fixture.service.createDeposit(
      { ...command, commandId: randomUUID(), timelineRevisionId: randomUUID() },
      context,
    );
    expect(fixture.entries.filter((entry) => entry.sourceType === 'BASE_BOOKING')).toHaveLength(1);
    expect(fixture.entries[0]!.occurredAt).toBe(commercial.acceptedAt);
  });
  it('rejects changed timeline under the same durable command', async () => {
    const fixture = setup();
    const command = { bookingId, timelineRevisionId, commandId: randomUUID() };
    await fixture.service.createDeposit(command, context);
    await expect(
      fixture.service.createDeposit({ ...command, timelineRevisionId: randomUUID() }, context),
    ).rejects.toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('rejects mismatched commercial amount and an account different from the reservation owner', async () => {
    const fixture = setup();
    const command = { bookingId, timelineRevisionId, commandId: randomUUID() };
    const commercial = await fixture.commercial.getAccepted(command, context);
    vi.mocked(fixture.commercial.getAccepted).mockResolvedValueOnce({
      ...commercial,
      depositAmountVnd: 301,
    });
    await expect(fixture.service.createDeposit(command, context)).rejects.toMatchObject({
      code: 'PAYMENT_EVIDENCE_CONFLICT',
    });
    const eligibility = await fixture.booking.requireDepositEligibility(command);
    vi.mocked(fixture.booking.requireDepositEligibility).mockResolvedValueOnce({
      ...eligibility,
      coupleAccountId: randomUUID(),
    });
    await expect(fixture.service.createDeposit(command, context)).rejects.toMatchObject({
      code: 'DEPOSIT_NOT_ELIGIBLE',
    });
    expect(fixture.ledger.createAttempt).not.toHaveBeenCalled();
  });

  it('keeps completed replay successful after Booking is no longer payable, without another promotion', async () => {
    const fixture = setup();
    const created = await fixture.service.createDeposit(
      { bookingId, timelineRevisionId, commandId: randomUUID() },
      context,
    );
    fixture.succeed();
    const input = {
      bookingId,
      paymentAttemptId: created.attempt.id,
      settledAt: instant.toISOString(),
    };
    const applied = await fixture.service.applySettledDeposit(input, system);
    vi.mocked(fixture.booking.requireDepositEligibility).mockRejectedValue(
      new Error('already confirmed'),
    );
    expect(await fixture.service.applySettledDeposit(input, system)).toEqual({
      ...applied,
      replayed: true,
    });
    expect(fixture.recorder.recordSuccessfulDeposit).toHaveBeenCalledTimes(1);
    await expect(
      fixture.service.applySettledDeposit({ ...input, settledAt: '2026-10-08T06:00:01Z' }, system),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
  });
  it('derives amount, exact timeline, fifteen-minute expiry and base charge from Booking', async () => {
    const fixture = setup();
    const command = { bookingId, timelineRevisionId, commandId: randomUUID() };
    const result = await fixture.service.createDeposit(command, context);
    expect(result.attempt).toMatchObject({
      amountVnd: 300,
      timelineRevisionId,
      provider: 'VNPAY',
      expiresAt: '2026-10-08T06:15:00.000Z',
    });
    expect(fixture.entries).toHaveLength(1);
    expect(fixture.entries[0]).toMatchObject({ sourceType: 'BASE_BOOKING', amountVnd: 1_000 });
    expect(await fixture.service.createDeposit(command, context)).toEqual({
      ...result,
      replayed: true,
    });
  });

  it('rejects unauthenticated/denied access, stale eligibility and injected client amount', async () => {
    const fixture = setup();
    const command = { bookingId, timelineRevisionId, commandId: randomUUID() };
    await expect(fixture.service.createDeposit(command, system)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      fixture.service.createDeposit({ ...command, amountVnd: 1 } as typeof command, context),
    ).rejects.toThrow();
    vi.mocked(fixture.booking.requireBookingAccess).mockRejectedValueOnce(
      new Error('concealed denial'),
    );
    await expect(fixture.service.createDeposit(command, context)).rejects.toThrow(
      'concealed denial',
    );
    vi.mocked(fixture.booking.requireDepositEligibility).mockResolvedValueOnce({
      eligible: false,
      reasonCode: 'REVISION_SUPERSEDED',
      consultationId: randomUUID(),
      coupleAccountId: accountId,
      bookingRevision: 2,
      depositAmountVnd: 300,
    });
    await expect(fixture.service.createDeposit(command, context)).rejects.toMatchObject({
      code: 'DEPOSIT_NOT_ELIGIBLE',
    });
    expect(fixture.ledger.createAttempt).not.toHaveBeenCalled();
  });

  it('propagates missing reservation and never returns an intent', async () => {
    const fixture = setup();
    vi.mocked(fixture.coordinator.reserve).mockRejectedValueOnce(
      new Error('reservation unavailable'),
    );
    await expect(
      fixture.service.createDeposit(
        { bookingId, timelineRevisionId, commandId: randomUUID() },
        context,
      ),
    ).rejects.toThrow('reservation unavailable');
  });

  it('rejects unproven settlement and untrusted application caller', async () => {
    const fixture = setup();
    const created = await fixture.service.createDeposit(
      { bookingId, timelineRevisionId, commandId: randomUUID() },
      context,
    );
    await expect(
      fixture.service.applySettledDeposit(
        { bookingId, paymentAttemptId: created.attempt.id, settledAt: instant.toISOString() },
        system,
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_EVIDENCE_CONFLICT' });
    await expect(
      fixture.service.applySettledDeposit(
        { bookingId, paymentAttemptId: created.attempt.id, settledAt: instant.toISOString() },
        context,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(fixture.recorder.recordSuccessfulDeposit).not.toHaveBeenCalled();
  });

  it('retains proven money when downstream fails and recovers using the same payment identity', async () => {
    const fixture = setup();
    const created = await fixture.service.createDeposit(
      { bookingId, timelineRevisionId, commandId: randomUUID() },
      context,
    );
    fixture.succeed();
    vi.mocked(fixture.recorder.recordSuccessfulDeposit).mockRejectedValueOnce(
      new Error('promotion unavailable'),
    );
    const input = {
      bookingId,
      paymentAttemptId: created.attempt.id,
      settledAt: instant.toISOString(),
    };
    const pending = await fixture.service.applySettledDeposit(input, system);
    expect(pending.applicationStatus).toBe('PENDING');
    expect(fixture.entries.filter((entry) => entry.kind === 'PAYMENT')).toHaveLength(1);
    const recovered = await fixture.service.applySettledDeposit(input, system);
    expect(recovered).toMatchObject({
      paymentId: pending.paymentId,
      applicationStatus: 'SUCCEEDED',
      replayed: true,
    });
  });
});
