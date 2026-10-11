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
      const [clock] = await client.$queryRaw<{ now: Date }[]>`SELECT CURRENT_TIMESTAMP AS now`;
      if (!clock || clock.now.getTime() < eventEndAt.getTime())
        throw commercialConflict('EVENT_NOT_ENDED');
      return { bookingId, phase: booking.phase, eventEndAt: eventEndAt.toISOString() };
    },
  });
}
