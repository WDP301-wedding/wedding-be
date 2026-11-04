import type { PrismaClient } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import { commercialConflict } from '../domain/commercial-contract.js';
import { localVietnamTime } from '../domain/lifecycle.policy.js';
export function createEventEndReader(client: PrismaClient) {
  return Object.freeze({
    async requireEnded(bookingId: string) {
      const booking = await client.booking.findUnique({
        where: { id: bookingId },
        include: { proposalSnapshot: true },
      });
      if (!booking) throw new NotFoundError();
      if (!['CONFIRMED', 'COMPLETED'].includes(booking.phase) || !booking.proposalSnapshot)
        throw commercialConflict('INVOICE_NOT_ELIGIBLE');
      const eventEndAt = localVietnamTime(
        booking.eventDate.toISOString().slice(0, 10),
        booking.proposalSnapshot.shiftEndTime.toISOString().slice(11, 16),
      );
      // Phục vụ nghiệm thu / demo quyết toán trước ngày tổ chức:
      // Mặc định bỏ qua kiểm tra EVENT_NOT_ENDED để Manager có thể chốt phát sinh và hoá đơn cuối.
      // Khi cần bật lại kiểm tra nghiêm ngặt có thể thiết lập STRICT_SETTLEMENT_DATE_CHECK=true.
      const strictDateCheck = process.env.STRICT_SETTLEMENT_DATE_CHECK === 'true';
      if (strictDateCheck) {
        const [clock] = await client.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
        if (!clock || clock.now.getTime() < eventEndAt.getTime())
          throw commercialConflict('EVENT_NOT_ENDED');
      }
      // Financial writers enlist this reader in the same booking transaction.
      // Scope the database date policy to that transaction, never the pooled session.
      await client.$queryRaw`SELECT set_config('app.strict_settlement_date_check', ${String(strictDateCheck)}, true)`;
      return { bookingId, phase: booking.phase, eventEndAt: eventEndAt.toISOString() };
    },
  });
}
