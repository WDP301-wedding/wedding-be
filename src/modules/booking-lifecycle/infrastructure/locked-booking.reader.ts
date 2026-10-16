import type { Booking, PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { NotFoundError } from '../../../core/errors/app-error.js';

// Only read scopes reuse a snapshot: their shared advisory/row locks keep it
// stable. Command scopes must observe their own writes. Weak keys expire with tx.
const readSnapshots = new WeakMap<object, Map<string, Booking>>();

export async function readLockedBooking(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
  bookingId: string,
): Promise<Booking> {
  const tx = boundary.current(bookingId);
  const reusable = tx !== undefined && boundary.isReadScope();
  const cached = tx === undefined ? undefined : readSnapshots.get(tx)?.get(bookingId);
  if (reusable && cached !== undefined) return cached;
  // Legacy lifecycle writers also respect the row lock, even without the advisory fence.
  if (tx !== undefined)
    await tx.$queryRaw`SELECT id FROM "Booking" WHERE id=${bookingId}::uuid FOR SHARE`;
  const row = await (tx ?? prisma).booking.findUnique({ where: { id: bookingId } });
  if (row === null) throw new NotFoundError();
  if (reusable) {
    const snapshots = readSnapshots.get(tx) ?? new Map<string, Booking>();
    snapshots.set(bookingId, row);
    readSnapshots.set(tx, snapshots);
  }
  return row;
}
