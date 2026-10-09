import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ServiceUnavailableError } from '../../../core/errors/app-error.js';
import { billingReportRowSchema, sourceQuerySchema } from './payments-billing.providers.js';
import type {
  BillingReader,
  BillingReportingReader,
  BookingChargeAdjustmentRegistrar,
  BookingChargeRegistrar,
  BookingDepositIntentCoordinator,
  BookingDepositRecorder,
  BookingLifecycleReader,
  CoupleAccessPromoter,
} from './payments-billing.providers.js';

const bookingId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const timelineRevisionId = '33333333-3333-4333-8333-333333333333';
const paymentAttemptId = '44444444-4444-4444-8444-444444444444';
const context = {
  requestId: '55555555-5555-4555-8555-555555555555',
  causationId: '66666666-6666-4666-8666-666666666666',
  actorAccountId: accountId,
  authority: 'AUTHENTICATED' as const,
};

describe('SPEC-04 provider contract fixtures', () => {
  it('models own restricted access and concealed unowned booking reads through Booking', async () => {
    const booking: BookingLifecycleReader = {
      requireBookingAccess: vi
        .fn<BookingLifecycleReader['requireBookingAccess']>()
        .mockResolvedValueOnce({ consultationId: bookingId, bookingId, phase: 'AWAITING_DEPOSIT' })
        .mockRejectedValueOnce(new NotFoundError()),
      requireDepositEligibility: vi.fn(),
      requireConfirmedEventContext: vi.fn(),
    };
    await expect(
      booking.requireBookingAccess({ bookingId, accountId, minimum: 'RESTRICTED' }),
    ).resolves.toMatchObject({ phase: 'AWAITING_DEPOSIT' });
    await expect(
      booking.requireBookingAccess({ bookingId, accountId: paymentAttemptId, minimum: 'FULL' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('models eligible, denied, and stale booking eligibility results', async () => {
    const eligibility = vi
      .fn<BookingLifecycleReader['requireDepositEligibility']>()
      .mockResolvedValueOnce({
        eligible: true,
        reasonCode: 'ELIGIBLE',
        consultationId: bookingId,
        coupleAccountId: accountId,
        bookingRevision: 3,
        depositAmountVnd: 30_000,
      })
      .mockResolvedValueOnce({
        eligible: false,
        reasonCode: 'BOOKING_NOT_PAYABLE',
        consultationId: bookingId,
        coupleAccountId: accountId,
        bookingRevision: 3,
        depositAmountVnd: 30_000,
      })
      .mockResolvedValueOnce({
        eligible: false,
        reasonCode: 'REVISION_SUPERSEDED',
        consultationId: bookingId,
        coupleAccountId: accountId,
        bookingRevision: 4,
        depositAmountVnd: 30_000,
      });
    const booking: BookingLifecycleReader = {
      requireBookingAccess: vi.fn(),
      requireDepositEligibility: eligibility,
      requireConfirmedEventContext: vi.fn(),
    };

    await expect(
      booking.requireDepositEligibility({ bookingId, timelineRevisionId }),
    ).resolves.toMatchObject({
      eligible: true,
      reasonCode: 'ELIGIBLE',
    });
    await expect(
      booking.requireDepositEligibility({ bookingId, timelineRevisionId }),
    ).resolves.toMatchObject({
      eligible: false,
      reasonCode: 'BOOKING_NOT_PAYABLE',
    });
    await expect(
      booking.requireDepositEligibility({ bookingId, timelineRevisionId }),
    ).resolves.toMatchObject({
      eligible: false,
      reasonCode: 'REVISION_SUPERSEDED',
      bookingRevision: 4,
    });
  });

  it('models reservation, settlement, promotion, and replay outcomes through owner ports', async () => {
    const coordinator: BookingDepositIntentCoordinator = {
      reserve: vi
        .fn<BookingDepositIntentCoordinator['reserve']>()
        .mockResolvedValue({ paymentAttemptId, bookingRevision: 3, replayed: false })
        .mockResolvedValueOnce({ paymentAttemptId, bookingRevision: 3, replayed: true }),
      recordUnknown: vi.fn<BookingDepositIntentCoordinator['recordUnknown']>(),
      releaseVerifiedFailure: vi.fn<BookingDepositIntentCoordinator['releaseVerifiedFailure']>(),
    };
    const recorder: BookingDepositRecorder = {
      recordSuccessfulDeposit: vi
        .fn<BookingDepositRecorder['recordSuccessfulDeposit']>()
        .mockResolvedValue({ phase: 'CONFIRMED', replayed: true }),
    };
    const promoter: CoupleAccessPromoter = {
      promote: vi
        .fn<CoupleAccessPromoter['promote']>()
        .mockResolvedValueOnce({ level: 'FULL', replayed: false, accessId: bookingId })
        .mockResolvedValue({ level: 'FULL', replayed: true, accessId: bookingId }),
    };
    const reservation = {
      bookingId,
      timelineRevisionId,
      paymentAttemptId,
      expectedBookingRevision: 3,
      amountVnd: 30_000,
      expiresAt: '2026-10-08T12:15:00+07:00',
    };

    await expect(coordinator.reserve(reservation, context)).resolves.toMatchObject({
      replayed: true,
    });
    await expect(coordinator.reserve(reservation, context)).resolves.toMatchObject({
      replayed: false,
    });
    await expect(
      recorder.recordSuccessfulDeposit({
        bookingId,
        timelineRevisionId,
        paymentId: paymentAttemptId,
        amountVnd: 30_000,
        settledAt: new Date('2026-10-08T05:00:00Z'),
      }),
    ).resolves.toMatchObject({ phase: 'CONFIRMED', replayed: true });
    const promotion = {
      accountId,
      consultationId: bookingId,
      sourcePaymentId: paymentAttemptId,
      requestId: context.requestId,
    };
    await expect(promoter.promote(promotion)).resolves.toMatchObject({
      level: 'FULL',
      replayed: false,
    });
    await expect(promoter.promote(promotion)).resolves.toMatchObject({
      level: 'FULL',
      replayed: true,
    });
  });

  it('models unavailable providers without fabricating a successful outcome', async () => {
    const booking: BookingLifecycleReader = {
      requireBookingAccess: vi.fn(),
      requireDepositEligibility: vi.fn().mockRejectedValue(new ServiceUnavailableError()),
      requireConfirmedEventContext: vi.fn(),
    };

    await expect(
      booking.requireDepositEligibility({ bookingId, timelineRevisionId }),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
  });

  it('traces PRN-006 accepted print-source replay and conflict through billing owner ports', async () => {
    const billing: BillingReader = {
      requireDepositSettlement: vi.fn().mockResolvedValue({
        paymentId: paymentAttemptId,
        amountVnd: 30_000,
        settledAt: new Date('2026-10-08T05:00:00Z'),
      }),
      getBookingReceivables: vi.fn().mockResolvedValue({
        acceptedChargesVnd: 100_000,
        paidVnd: 30_000,
        refundedVnd: 0,
        outstandingVnd: 70_000,
      }),
    };
    const acceptedCharges = new Map<
      string,
      Parameters<BookingChargeRegistrar['registerAcceptedCharge']>[0]
    >();
    const chargeRegistrar: BookingChargeRegistrar = {
      registerAcceptedCharge(input) {
        const existing = acceptedCharges.get(input.sourceRevisionId);
        if (existing !== undefined) {
          if (
            existing.bookingId !== input.bookingId ||
            existing.amountVnd !== input.amountVnd ||
            existing.acceptedAt.getTime() !== input.acceptedAt.getTime()
          ) {
            return Promise.reject(
              Object.assign(new Error('Accepted charge source conflicts.'), {
                code: 'RECEIVABLE_SOURCE_CONFLICT',
              }),
            );
          }
          return Promise.resolve({ receivableChargeId: paymentAttemptId, replayed: true });
        }
        acceptedCharges.set(input.sourceRevisionId, input);
        return Promise.resolve({ receivableChargeId: paymentAttemptId, replayed: false });
      },
    };
    const creditRegistrar: BookingChargeAdjustmentRegistrar = {
      registerCredit: vi.fn().mockResolvedValue({ adjustmentId: paymentAttemptId, replayed: true }),
    };
    const reporting: BillingReportingReader = {
      readPage: vi.fn().mockResolvedValue({
        throughSequence: 5,
        nextCursor: null,
        rows: [
          {
            recordId: bookingId,
            sequence: 5,
            changedAt: '2026-10-08T05:00:00.000Z',
            value: {
              bookingId,
              acceptedChargesVnd: 100_000,
              paidVnd: 30_000,
              refundedVnd: 0,
              outstandingVnd: 70_000,
              creditVnd: 0,
              ledger: [
                {
                  ledgerEntryId: paymentAttemptId,
                  kind: 'PAYMENT',
                  amountVnd: 30_000,
                  occurredAt: '2026-10-08T05:00:00.000Z',
                  sourceRevisionId: null,
                },
              ],
            },
          },
        ],
      }),
    };

    await expect(billing.getBookingReceivables(bookingId)).resolves.toEqual({
      acceptedChargesVnd: 100_000,
      paidVnd: 30_000,
      refundedVnd: 0,
      outstandingVnd: 70_000,
    });
    const acceptedCharge = {
      bookingId,
      sourceType: 'PRINT_ORDER' as const,
      sourceRevisionId: timelineRevisionId,
      amountVnd: 30_000,
      acceptedAt: new Date('2026-10-08T05:00:00Z'),
    };
    await expect(chargeRegistrar.registerAcceptedCharge(acceptedCharge)).resolves.toMatchObject({
      replayed: false,
    });
    await expect(chargeRegistrar.registerAcceptedCharge(acceptedCharge)).resolves.toMatchObject({
      replayed: true,
    });
    await expect(
      chargeRegistrar.registerAcceptedCharge({ ...acceptedCharge, amountVnd: 40_000 }),
    ).rejects.toMatchObject({ code: 'RECEIVABLE_SOURCE_CONFLICT' });
    await expect(
      creditRegistrar.registerCredit(
        {
          bookingId,
          receivableChargeId: paymentAttemptId,
          sourceAdjustmentId: timelineRevisionId,
          amountVnd: 10_000,
          reason: 'PRINT_CANCELLED',
          acceptedAt: '2026-10-08T05:00:00.000Z',
        },
        context,
      ),
    ).resolves.toMatchObject({ replayed: true });
    await expect(
      reporting.readPage({ afterSequence: 0, limit: 100 }, context),
    ).resolves.toMatchObject({
      rows: [{ value: { bookingId, acceptedChargesVnd: 100_000, paidVnd: 30_000 } }],
    });
  });
});

describe('SPEC-04 strict reporting schemas', () => {
  const row = {
    bookingId,
    acceptedChargesVnd: 100_000,
    paidVnd: 30_000,
    refundedVnd: 0,
    outstandingVnd: 70_000,
    creditVnd: 0,
    ledger: [
      {
        ledgerEntryId: paymentAttemptId,
        kind: 'CHARGE' as const,
        amountVnd: 100_000,
        occurredAt: '2026-10-08T05:00:00.000Z',
        sourceRevisionId: timelineRevisionId,
      },
    ],
  };

  it('publishes exact readonly row and ledger fields from baseline section 21.5', () => {
    const parsed = billingReportRowSchema.parse(row);
    expect(parsed).toEqual(row);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.ledger)).toBe(true);
    expect(Object.isFrozen(parsed.ledger[0])).toBe(true);
    expect(billingReportRowSchema.safeParse({ ...row, netPaidVnd: 30_000 }).success).toBe(false);
    expect(
      billingReportRowSchema.safeParse({
        ...row,
        ledger: [{ ...row.ledger[0], providerSecret: 'unexpected' }],
      }).success,
    ).toBe(false);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    'rejects unsafe/noninteger report amounts: %s',
    (amount) => {
      expect(billingReportRowSchema.safeParse({ ...row, paidVnd: amount }).success).toBe(false);
    },
  );

  it('rejects malformed ledger identity, timestamp and amount', () => {
    for (const patch of [
      { ledgerEntryId: 'invalid' },
      { occurredAt: '2026-10-08' },
      { sourceRevisionId: undefined },
      { kind: 'PENDING' },
      { amountVnd: 0 },
    ]) {
      expect(
        billingReportRowSchema.safeParse({
          ...row,
          ledger: [{ ...row.ledger[0], ...patch }],
        }).success,
      ).toBe(false);
    }
    expect(
      billingReportRowSchema.safeParse({
        ...row,
        ledger: [{ ...row.ledger[0], sourceRevisionId: null }],
      }).success,
    ).toBe(true);
  });

  it('bounds reporting query size and rejects undeclared fields', () => {
    expect(sourceQuerySchema.parse({ afterSequence: 0, limit: 100 })).toEqual({
      afterSequence: 0,
      limit: 100,
    });
    for (const query of [
      { afterSequence: -1, limit: 100 },
      { afterSequence: 0, limit: 0 },
      { afterSequence: 0, limit: 501 },
      { afterSequence: 0, limit: 100, cursor: 'x'.repeat(513) },
      { afterSequence: 0, limit: 100, actorAccountId: accountId },
    ]) {
      expect(sourceQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});
