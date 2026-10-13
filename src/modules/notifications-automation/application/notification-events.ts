import { z } from 'zod';
import { createNotificationRecipientReader } from '../../identity-access/authorization/notification-recipient.reader.js';
import {
  type NotificationRepository,
  type NotificationClient,
} from '../infrastructure/notification.repository.js';

export const handlers = {
  'identity.consultation-access-promoted': {
    title: 'Quyền truy cập sự kiện đã được mở',
    manager: 'OPERATIONS',
    screen: 'BOOKING',
    transactional: true,
  },
  'booking.timeline-review-requested': {
    title: 'Lịch trình cần phê duyệt',
    manager: 'OPERATIONS',
    screen: 'TIMELINE',
    transactional: false,
  },
  'booking.timeline-approved': {
    title: 'Lịch trình đã được phê duyệt',
    manager: 'OPERATIONS',
    screen: 'TIMELINE',
    transactional: false,
  },
  'booking.timeline-superseded': {
    title: 'Lịch trình đã thay đổi',
    manager: 'OPERATIONS',
    screen: 'TIMELINE',
    transactional: false,
  },
  'booking.deposit-eligible': {
    title: 'Hồ sơ đã đủ điều kiện đặt cọc',
    manager: 'FINANCE',
    screen: 'PAYMENTS',
    transactional: false,
  },
  'booking.deposit-recorded': {
    title: 'Đặt cọc đã được ghi nhận',
    manager: 'FINANCE',
    screen: 'PAYMENTS',
    transactional: true,
  },
  'booking.cancellation-requested': {
    title: 'Yêu cầu hủy sự kiện',
    manager: 'OPERATIONS',
    screen: 'BOOKING',
    transactional: false,
  },
  'booking.cancellation-approved': {
    title: 'Yêu cầu hủy đã được duyệt',
    manager: 'OPERATIONS',
    screen: 'BOOKING',
    transactional: false,
  },
  'booking.cancellation-rejected': {
    title: 'Yêu cầu hủy đã được từ chối',
    manager: 'OPERATIONS',
    screen: 'BOOKING',
    transactional: false,
  },
  'booking.cancelled': {
    title: 'Sự kiện đã hủy',
    manager: 'OPERATIONS',
    screen: 'BOOKING',
    transactional: false,
  },
  'booking.completed': {
    title: 'Sự kiện đã hoàn tất',
    manager: 'OPERATIONS',
    screen: 'BOOKING',
    transactional: false,
  },
  'booking.expected-headcount-changed': {
    title: 'Số lượng dự kiến đã thay đổi',
    manager: 'OPERATIONS',
    screen: 'GUESTS',
    transactional: false,
  },
  'booking.contract-approved': {
    title: 'Phê duyệt hợp đồng đã được ghi nhận',
    manager: 'FINANCE',
    screen: 'BOOKING',
    transactional: false,
  },
  'booking.contract-superseded': {
    title: 'Hợp đồng có phiên bản mới',
    manager: 'FINANCE',
    screen: 'BOOKING',
    transactional: false,
  },
  'booking.appendix-approved': {
    title: 'Phê duyệt phụ lục đã được ghi nhận',
    manager: 'FINANCE',
    screen: 'BOOKING',
    transactional: false,
  },
  'billing.payment-succeeded': {
    title: 'Thanh toán đã được xác minh',
    manager: 'FINANCE',
    screen: 'PAYMENTS',
    transactional: true,
  },
  'billing.refund-recorded': {
    title: 'Khoản hoàn trả đã được ghi nhận',
    manager: 'FINANCE',
    screen: 'PAYMENTS',
    transactional: true,
  },
  'billing.receivable-charge-accepted': {
    title: 'Khoản phải thu đã được ghi nhận',
    manager: 'FINANCE',
    screen: 'PAYMENTS',
    transactional: true,
  },
  'billing.commercial-obligation-recorded': {
    title: 'Nghĩa vụ thanh toán đã cập nhật',
    manager: 'FINANCE',
    screen: 'PAYMENTS',
    transactional: true,
  },
  'billing.final-invoice-issued': {
    title: 'Hóa đơn cuối đã được chốt hoặc điều chỉnh',
    manager: 'FINANCE',
    screen: 'PAYMENTS',
    transactional: true,
  },
  'invitation.publication-changed': {
    title: 'Thiệp mời đã được xuất bản',
    manager: 'PRINT',
    screen: 'INVITATION',
    transactional: false,
  },
  'invitation.unpublished': {
    title: 'Thiệp mời đã ngừng công khai',
    manager: 'PRINT',
    screen: 'INVITATION',
    transactional: false,
  },
  'invitation.print-quotation-issued': {
    title: 'Báo giá in thiệp đã được lập',
    manager: 'PRINT',
    screen: 'INVITATION',
    transactional: false,
  },
  'invitation.print-order-approved': {
    title: 'Đơn in thiệp đã được duyệt',
    manager: 'PRINT',
    screen: 'INVITATION',
    transactional: false,
  },
  'invitation.print-order-ready': {
    title: 'Thiệp in đã sẵn sàng',
    manager: 'PRINT',
    screen: 'INVITATION',
    transactional: false,
  },
  'guest.workspace-changed': {
    title: 'Danh sách hoặc kế hoạch khách đã cập nhật',
    manager: 'OPERATIONS',
    screen: 'GUESTS',
    transactional: false,
  },
  D3_REMINDER: {
    title: 'Sự kiện diễn ra sau ba ngày',
    manager: 'OPERATIONS',
    screen: 'BOOKING',
    transactional: false,
  },
  MEDIA_CUTOFF: {
    title: 'Còn 24 giờ để cập nhật nội dung thiệp',
    manager: null,
    screen: 'INVITATION',
    transactional: false,
  },
} as const;
export type Purpose = keyof typeof handlers;
export const eventSchema = z.strictObject({
  eventId: z.uuid(),
  bookingId: z.uuid(),
  eventType: z.string().max(100),
  producer: z.enum(['booking', 'billing', 'invitation', 'guest', 'identity']),
  eventVersion: z.int().nonnegative(),
  sourceSequence: z.int().nonnegative(),
  payload: z.unknown(),
});
export type NotificationEvent = z.infer<typeof eventSchema>;
const basePayload = z.object({
  bookingId: z.uuid(),
  timelineRevisionId: z.uuid().optional(),
  contractRevisionId: z.uuid().optional(),
  appendixRevisionId: z.uuid().optional(),
  invoiceRevisionId: z.uuid().optional(),
  printOrderId: z.uuid().optional(),
  publishedRevisionId: z.uuid().optional(),
});
/** Validate producer-owned references, discard all message/PII payload content. */
export function validEvent(event: NotificationEvent): boolean {
  if (event.eventVersion !== 1 || !event.eventType.startsWith(`${event.producer}.`)) return false;
  let schema: z.ZodType = basePayload;
  if (event.eventType.startsWith('booking.timeline-'))
    schema = basePayload.extend({ timelineRevisionId: z.uuid() });
  if (event.eventType === 'booking.timeline-review-requested')
    schema = basePayload.extend({
      timelineRevisionId: z.uuid(),
      party: z.enum(['MANAGER', 'COUPLE']),
    });
  if (event.eventType.startsWith('booking.contract-'))
    schema = basePayload.extend({ contractRevisionId: z.uuid() });
  if (event.eventType.startsWith('booking.appendix-'))
    schema = basePayload.extend({ appendixRevisionId: z.uuid() });
  if (event.eventType === 'billing.payment-succeeded')
    schema = basePayload.extend({ paymentId: z.uuid(), amountVnd: z.int().nonnegative() });
  if (event.eventType === 'billing.refund-recorded')
    schema = basePayload.extend({ refundId: z.uuid(), amountVnd: z.int().nonnegative() });
  if (event.eventType === 'billing.final-invoice-issued')
    schema = basePayload.extend({ invoiceRevisionId: z.uuid(), totalVnd: z.int().nonnegative() });
  if (event.eventType.startsWith('invitation.print-'))
    schema = basePayload.extend({ printOrderId: z.uuid() });
  if (event.eventType === 'guest.workspace-changed')
    schema = basePayload.extend({
      planningHeadcount: z.int().nonnegative(),
      planSourceSequence: z.int().nonnegative(),
      listedGuestCount: z.int().nonnegative(),
    });
  const parsed = schema.safeParse(event.payload);
  return parsed.success && (parsed.data as { bookingId: string }).bookingId === event.bookingId;
}
export class NotificationEvents {
  constructor(readonly repository: NotificationRepository) {}
  async recipients(
    tx: NotificationClient,
    bookingId: string,
    purpose: Purpose,
    excludeParty?: string,
  ) {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (booking === null) return [];
    const coupled = await tx.consultationAccess.findMany({
      where: { consultationId: booking.consultationId },
      select: { accountId: true },
    });
    const handler = handlers[purpose];
    const managers =
      handler.manager === null
        ? []
        : await tx.notificationRecipient.findMany({
            where: { bookingId, purpose: handler.manager, enabled: true },
          });
    const identity = createNotificationRecipientReader(tx, this.repository.now),
      recipients = new Set<string>();
    if (excludeParty !== 'COUPLE')
      for (const row of coupled)
        if ((await identity.email(row.accountId)) !== null) recipients.add(row.accountId);
    if (excludeParty !== 'MANAGER')
      for (const row of managers)
        if (await identity.manager(row.accountId)) recipients.add(row.accountId);
    return [...recipients];
  }
  async enqueueFor(
    tx: NotificationClient,
    eventId: string,
    bookingId: string,
    purpose: Purpose,
    accountId: string,
    dueAt: Date,
    scheduleRevision?: number,
    referenceId?: string,
  ) {
    const base = {
      eventId,
      bookingId,
      purpose,
      recipientId: accountId,
      accountId,
      scheduledAt: dueAt,
      ...(scheduleRevision === undefined ? {} : { scheduleRevision }),
      ...(referenceId === undefined ? {} : { referenceId }),
    };
    await this.repository.enqueue(tx, { ...base, channel: 'EMAIL' });
    if (!handlers[purpose].transactional) {
      const installations = await tx.notificationInstallation.findMany({
        where: { accountId, active: true },
      });
      const identity = createNotificationRecipientReader(tx, this.repository.now);
      for (const device of installations)
        if (await identity.android(accountId, device.sessionId))
          await this.repository.enqueue(tx, { ...base, channel: 'PUSH', recipientId: device.id });
    }
  }
  async consume(raw: NotificationEvent) {
    const event = eventSchema.parse(raw);
    return this.repository.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notifications:${event.bookingId}`}))`;
      if ((await tx.notificationReceipt.findUnique({ where: { eventId: event.eventId } })) !== null)
        return 'REPLAYED';
      let outcome = 'IGNORED_UNSUPPORTED';
      if (
        Object.hasOwn(handlers, event.eventType) &&
        !['D3_REMINDER', 'MEDIA_CUTOFF'].includes(event.eventType)
      ) {
        if (!validEvent(event)) outcome = 'INVALID_SCHEMA';
        else {
          const key = {
            producer: event.producer,
            bookingId: event.bookingId,
            stream: event.eventType,
          };
          const checkpoint = await tx.notificationCheckpoint.findUnique({
            where: { producer_bookingId_stream: key },
          });
          // Payments are historical immutable facts; late settlement/refund must still
          // notify. Informational revisions reconcile to the newer fact in their stream.
          const transactional = handlers[event.eventType as Purpose].transactional;
          if (
            !transactional &&
            checkpoint !== null &&
            checkpoint.sourceSequence > event.sourceSequence
          )
            outcome = 'IGNORED_STALE';
          else {
            if (!transactional)
              await tx.$executeRaw`UPDATE "NotificationIntent" n SET state='CANCELLED',revision=n.revision+1 FROM "NotificationReceipt" r WHERE n."eventId"=r."eventId" AND n."bookingId"=${event.bookingId}::uuid AND n.purpose=${event.eventType} AND r.producer=${event.producer} AND r."sourceSequence"<${event.sourceSequence} AND n.state IN ('QUEUED','RETRYABLE_FAILED')`;
            const references = z
              .object({
                timelineRevisionId: z.uuid().optional(),
                contractRevisionId: z.uuid().optional(),
                appendixRevisionId: z.uuid().optional(),
                invoiceRevisionId: z.uuid().optional(),
                printOrderId: z.uuid().optional(),
                publishedRevisionId: z.uuid().optional(),
              })
              .parse(event.payload);
            const referenceId =
              references.invoiceRevisionId ??
              references.contractRevisionId ??
              references.appendixRevisionId ??
              references.timelineRevisionId ??
              references.printOrderId ??
              references.publishedRevisionId;
            const party =
              event.eventType === 'booking.timeline-review-requested'
                ? z.object({ party: z.enum(['MANAGER', 'COUPLE']) }).parse(event.payload).party
                : undefined;
            for (const accountId of await this.recipients(
              tx,
              event.bookingId,
              event.eventType as Purpose,
              party,
            ))
              await this.enqueueFor(
                tx,
                event.eventId,
                event.bookingId,
                event.eventType as Purpose,
                accountId,
                this.repository.now(),
                undefined,
                referenceId,
              );
            await tx.notificationCheckpoint.upsert({
              where: { producer_bookingId_stream: key },
              create: { ...key, sourceSequence: event.sourceSequence },
              update: {
                sourceSequence: Math.max(checkpoint?.sourceSequence ?? 0, event.sourceSequence),
              },
            });
            outcome = 'ACCEPTED';
          }
        }
      }
      await tx.notificationReceipt.create({
        data: {
          eventId: event.eventId,
          producer: event.producer,
          bookingId: event.bookingId,
          eventType: event.eventType,
          sourceSequence: event.sourceSequence,
          outcome,
        },
      });
      return outcome;
    });
  }
}
