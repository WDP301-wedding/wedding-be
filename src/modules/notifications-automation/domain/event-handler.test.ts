import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { notificationEvent } from './event-handler.js';

const bookingId = randomUUID();
function event(eventType: string, payload: unknown, eventVersion = 1) {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion,
    bookingId,
    occurredAt: '2026-10-12T00:00:00.000Z',
    payload,
  };
}
describe('explicit notification producer handlers', () => {
  it('matches equivalent UUID case from owner payloads without accepting a different booking', () => {
    const referenceId = 'abcdef01-2345-4abc-8def-0123456789ab';
    const result = notificationEvent(
      'guest-management',
      event('guest.plan-changed', {
        bookingId: bookingId.toUpperCase(),
        planRevisionId: referenceId.toUpperCase(),
        planRevision: 2,
      }),
    );
    expect(result).toMatchObject({ bookingId, data: { referenceId, revision: 2 } });
  });
  it('targets the other reviewing party and keeps only immutable references', () => {
    const timelineRevisionId = randomUUID();
    const result = notificationEvent(
      'booking-lifecycle',
      event('booking.timeline-review-requested', {
        bookingId,
        timelineRevisionId,
        bookingRevision: 4,
        party: 'MANAGER',
        requestedBy: randomUUID(),
        requestedAt: '2026-10-12T00:00:00.000Z',
      }),
    );
    expect(result).toMatchObject({
      purpose: 'TIMELINE_REVIEW',
      audience: 'COUPLE',
      data: { referenceId: timelineRevisionId, revision: 4 },
    });
    expect(result!.data).not.toHaveProperty('requestedBy');
  });
  it('rejects wrong booking/version/source and unsupported facts without guessing', () => {
    const payload = { bookingId, timelineRevisionId: randomUUID(), bookingRevision: 4 };
    expect(() =>
      notificationEvent('booking-lifecycle', event('booking.deposit-eligible', payload, 2)),
    ).toThrow();
    expect(() =>
      notificationEvent(
        'booking-lifecycle',
        event('booking.deposit-eligible', { ...payload, bookingId: randomUUID() }),
      ),
    ).toThrow();
    expect(
      notificationEvent(
        'guest-management',
        event('guest.workspace-changed', { ...payload, listedGuestCount: 20 }),
      ),
    ).toBeNull();
    expect(
      notificationEvent('identity-access', event('billing.payment-succeeded', payload)),
    ).toBeNull();
  });
  it('maps settlement, commercial, printing and explicit plan facts without protected content', () => {
    const referenceId = randomUUID();
    for (const [owner, type, payload, purpose] of [
      [
        'payments-billing',
        'billing.payment-succeeded',
        { paymentId: referenceId, amountVnd: 123 },
        'PAYMENT',
      ],
      [
        'payments-billing',
        'billing.final-invoice-issued',
        { invoiceRevisionId: referenceId, totalVnd: 123 },
        'FINAL_INVOICE',
      ],
      [
        'booking-lifecycle',
        'booking.contract-approved',
        { contractRevisionId: referenceId, state: 'AWAITING_APPROVAL' },
        'CONTRACT',
      ],
      ['invitation-studio', 'invitation.print-order-ready', { printOrderId: referenceId }, 'PRINT'],
      [
        'guest-management',
        'guest.plan-changed',
        { planRevisionId: referenceId, planRevision: 2, sourceSequence: 2 },
        'GUEST_PLAN',
      ],
    ] as const) {
      expect(notificationEvent(owner, event(type, { bookingId, ...payload }))).toMatchObject({
        purpose,
        data: { referenceId },
      });
    }
  });
});
