import type { NotificationInput } from './notification-policy.js';
import { notificationData, parse } from './notification-policy.js';

const titles: Record<NotificationInput['purpose'], string> = {
  WORKSPACE_INVITATION: 'Lời mời truy cập',
  PASSWORD_OTP: 'Mã xác thực',
  ACCESS_PROMOTED: 'Quyền truy cập đã được cập nhật',
  TIMELINE_REVIEW: 'Lịch trình cần được xem xét',
  TIMELINE_CHANGED: 'Lịch trình đã được cập nhật',
  DEPOSIT_ELIGIBLE: 'Booking đủ điều kiện đặt cọc',
  PAYMENT: 'Đã ghi nhận thanh toán',
  REFUND: 'Đã ghi nhận hoàn tiền',
  CONTRACT: 'Hợp đồng đã được cập nhật',
  APPENDIX: 'Phụ lục đã được cập nhật',
  FINAL_INVOICE: 'Nghĩa vụ thanh toán đã được cập nhật',
  PRINT: 'Yêu cầu in thiệp đã được cập nhật',
  GUEST_INVITATION: 'Bạn nhận được lời mời dự tiệc',
  PUBLICATION_CHANGED: 'Thiệp công khai đã được cập nhật',
  GUEST_PLAN: 'Kế hoạch số người đã được cập nhật',
  CANCELLATION_NOTICE: 'Booking đã bị hủy',
  MEDIA_CUTOFF: 'Sắp đến hạn cập nhật media',
  D3_REMINDER: 'Sự kiện diễn ra sau ba ngày',
  COMPLETION_NOTICE: 'Booking đã hoàn tất',
};
export function notificationTemplate(purpose: NotificationInput['purpose'], value: unknown) {
  const data = parse(notificationData, value);
  const contextPrefix = data.eventTitle
    ? `[${data.eventTitle}] `
    : data.hallName
      ? `[${data.hallName}] `
      : '';
  const dateSuffix = data.eventDate ? ` (Ngày: ${data.eventDate})` : '';
  const subject = `${contextPrefix}${titles[purpose]}${dateSuffix}`;
  return {
    subject,
    text:
      `${subject}. Đăng nhập để xem thông tin và thực hiện thao tác cần thiết.` +
      (data.totalVnd === undefined ? '' : ` Số tiền: ${data.totalVnd} VND.`) +
      (data.referenceId === undefined ? '' : ` Mã tham chiếu: ${data.referenceId}.`),
    data,
  };
}
export const mandatoryEmail = new Set<NotificationInput['purpose']>([
  'WORKSPACE_INVITATION',
  'PASSWORD_OTP',
  'PAYMENT',
  'REFUND',
  'FINAL_INVOICE',
  'GUEST_INVITATION',
]);

/** Credential and financial transactional messages retain their email-only transport. */
export function notificationChannels(
  purpose: NotificationInput['purpose'],
  androidEnabled: boolean,
) {
  return androidEnabled && !mandatoryEmail.has(purpose)
    ? (['EMAIL', 'IN_APP', 'ANDROID'] as const)
    : (['EMAIL', 'IN_APP'] as const);
}
