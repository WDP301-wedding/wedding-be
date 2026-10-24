import { z } from 'zod';
import { notificationData, parse, type NotificationInput } from './notification-policy.js';

type Owner = NotificationInput['owner'];
type Purpose = NotificationInput['purpose'];
type Audience = 'COUPLE' | 'MANAGER' | 'BOTH';
const envelope = z.object({
  eventId: z.uuid().toLowerCase(),
  eventType: z.string(),
  eventVersion: z.literal(1),
  bookingId: z.uuid().toLowerCase(),
  occurredAt: z.iso.datetime(),
  payload: z.unknown(),
});
const base = z.object({ bookingId: z.uuid().toLowerCase() });
const revision = z.int().positive();
const handlers: Record<
  Owner,
  Readonly<Record<string, Readonly<{ purpose: Purpose; reference?: string; audience?: Audience }>>>
> = {
  'identity-access': {
    'identity.consultation-access-promoted': { purpose: 'ACCESS_PROMOTED', reference: 'accessId' },
  },
  'booking-lifecycle': {
    'booking.timeline-review-requested': {
      purpose: 'TIMELINE_REVIEW',
      reference: 'timelineRevisionId',
    },
    'booking.timeline-approved': { purpose: 'TIMELINE_CHANGED', reference: 'timelineRevisionId' },
    'booking.timeline-superseded': {
      purpose: 'TIMELINE_CHANGED',
      reference: 'successorRevisionId',
    },
    'booking.timeline-approval-withdrawn': {
      purpose: 'TIMELINE_CHANGED',
      reference: 'timelineRevisionId',
    },
    'booking.deposit-eligible': { purpose: 'DEPOSIT_ELIGIBLE', reference: 'timelineRevisionId' },
    'booking.cancelled': { purpose: 'CANCELLATION_NOTICE' },
    'booking.completed': { purpose: 'COMPLETION_NOTICE' },
    'booking.contract-submitted': { purpose: 'CONTRACT', reference: 'contractRevisionId' },
    'booking.contract-approved': { purpose: 'CONTRACT', reference: 'contractRevisionId' },
    'booking.contract-withdrawn': { purpose: 'CONTRACT', reference: 'contractRevisionId' },
    'booking.appendix-submitted': { purpose: 'APPENDIX', reference: 'appendixRevisionId' },
    'booking.appendix-approved': { purpose: 'APPENDIX', reference: 'appendixRevisionId' },
    'booking.appendix-withdrawn': { purpose: 'APPENDIX', reference: 'appendixRevisionId' },
  },
  'payments-billing': {
    'billing.payment-succeeded': { purpose: 'PAYMENT', reference: 'paymentId' },
    'billing.refund-recorded': { purpose: 'REFUND', reference: 'refundId' },
    'billing.receivable-charge-accepted': { purpose: 'PRINT', reference: 'sourceRevisionId' },
    'billing.commercial-obligation-recorded': {
      purpose: 'FINAL_INVOICE',
      reference: 'sourceRevisionId',
    },
    'billing.final-invoice-issued': { purpose: 'FINAL_INVOICE', reference: 'invoiceRevisionId' },
  },
  'invitation-studio': {
    'invitation.publication-changed': {
      purpose: 'PUBLICATION_CHANGED',
      reference: 'publishedRevisionId',
    },
    'invitation.unpublished': { purpose: 'PUBLICATION_CHANGED', reference: 'publishedRevisionId' },
    'invitation.print-quotation-issued': {
      purpose: 'PRINT',
      reference: 'printOrderId',
      audience: 'COUPLE',
    },
    'invitation.print-order-approved': { purpose: 'PRINT', reference: 'printOrderId' },
    'invitation.print-order-ready': { purpose: 'PRINT', reference: 'printOrderId' },
  },
  'guest-management': {
    'guest.plan-changed': { purpose: 'GUEST_PLAN', reference: 'planRevisionId' },
  },
};
export function notificationEventTypes(owner: Owner) {
  return Object.keys(handlers[owner]);
}

/** Validate the owner envelope and copy only explicitly allowed immutable references. */
export function notificationEvent(owner: Owner, value: unknown) {
  const e = parse(envelope, value);
  const handler = handlers[owner][e.eventType];
  if (!handler) return null;
  const payload = parse(base, e.payload);
  if (payload.bookingId !== e.bookingId) throw new Error('NOTIFICATION_EVENT_SCOPE_INVALID');
  const facts = parse(z.record(z.string(), z.unknown()), e.payload);
  const referenceId = handler.reference
    ? parse(z.uuid().toLowerCase(), facts[handler.reference])
    : e.bookingId;
  let audience: Audience = handler.audience ?? 'BOTH';
  if (e.eventType === 'booking.timeline-review-requested') {
    const review = parse(
      z.object({
        party: z.enum(['MANAGER', 'COUPLE']),
        requestedBy: z.uuid().toLowerCase(),
        requestedAt: z.iso.datetime(),
        bookingRevision: revision,
      }),
      facts,
    );
    audience = review.party === 'MANAGER' ? 'COUPLE' : 'MANAGER';
  }
  const rawRevision = facts['bookingRevision'] ?? facts['planRevision'];
  const rawTotal = facts['amountVnd'] ?? facts['totalVnd'];
  const rawHall = facts['hallName'];
  const rawTitle = facts['eventTitle'] ?? facts['alias'];
  const rawDate = facts['eventDate'];
  const data = parse(notificationData, {
    referenceId,
    ...(rawRevision === undefined ? {} : { revision: parse(revision, rawRevision) }),
    ...(rawTotal === undefined ? {} : { totalVnd: parse(z.int().nonnegative(), rawTotal) }),
    ...(typeof rawHall === 'string' ? { hallName: rawHall } : {}),
    ...(typeof rawTitle === 'string' ? { eventTitle: rawTitle } : {}),
    ...(typeof rawDate === 'string' ? { eventDate: rawDate } : {}),
  });
  return { ...e, purpose: handler.purpose, audience, data };
}
