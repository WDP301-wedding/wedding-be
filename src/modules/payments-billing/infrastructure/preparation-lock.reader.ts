import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { AppError } from '../../../core/errors/app-error.js';
import { readReceivables } from './billing-persistence.queries.js';

export function createPreparationLockReader(prisma: PrismaClient, boundary: PrismaBookingBoundary) {
  async function read(bookingId: string) {
    const db = boundary.current(bookingId) ?? prisma;
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        phase: true,
        finalInvoices: { select: { currentRevision: { select: { totalVnd: true } } } },
      },
    });
    if (booking?.phase === 'COMPLETED') return 'EVENT_COMPLETED';
    const invoice = booking?.finalInvoices?.currentRevision;
    if (booking?.phase !== 'CONFIRMED' || !invoice) return null;
    const totals = await readReceivables(db, bookingId);
    if (
      !invoice.totalVnd.equals(totals.acceptedChargesVnd) ||
      totals.netPaidVnd !== totals.acceptedChargesVnd
    )
      return null;
    const unresolved = await db.billingPaymentAttempt.findFirst({
      where: {
        bookingId,
        purpose: 'BALANCE',
        OR: [
          { state: { in: ['CREATED', 'PENDING', 'UNKNOWN'] } },
          { state: 'SUCCEEDED', paymentEntries: { none: {} } },
        ],
      },
      select: { id: true },
    });
    return unresolved ? null : 'FINAL_BALANCE_SETTLED';
  }
  return {
    read,
    async requireEditable(this: void, bookingId: string) {
      if (await read(bookingId))
        throw new AppError({
          status: 409,
          code: 'PREPARATION_READ_ONLY',
          message: 'Wedding preparation is read-only.',
        });
    },
  };
}
