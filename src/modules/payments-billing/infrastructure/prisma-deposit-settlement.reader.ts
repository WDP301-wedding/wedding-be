import { z } from 'zod';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import type { DepositSettlementReader } from '../application/deposit-settlement.reader.js';

type ProofSnapshot = { paymentId: string; amountVnd: number; settledAt: number };

export function createPrismaDepositSettlementReader(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
): DepositSettlementReader {
  // Monetary proof is append-only through Booking's settlement writer; promotion
  // updates only fields this reader does not expose. Reuse validated proof only
  // within one shared booking transaction, never across requests or writer scopes.
  const snapshots = new WeakMap<Prisma.TransactionClient, Map<string, ProofSnapshot>>();
  return {
    async requireDepositSettlement(bookingId) {
      bookingId = z.uuid().parse(bookingId).toLowerCase();
      const tx = boundary.current(bookingId);
      const reusable = tx !== undefined && boundary.isReadScope();
      const cached = reusable ? snapshots.get(tx)?.get(bookingId) : undefined;
      if (cached !== undefined) return { ...cached, settledAt: new Date(cached.settledAt) };
      const row = await (tx ?? prisma).bookingDepositSettlement.findUnique({
        where: { bookingId },
      });
      if (row === null) throw new NotFoundError();
      const amountVnd = row.amountVnd.toNumber();
      if (
        !Number.isSafeInteger(amountVnd) ||
        amountVnd <= 0 ||
        !Number.isFinite(row.settledAt.getTime())
      )
        throw new ValidationError();
      const snapshot = { paymentId: row.paymentId, amountVnd, settledAt: row.settledAt.getTime() };
      if (reusable) {
        const values = snapshots.get(tx) ?? new Map<string, ProofSnapshot>();
        values.set(bookingId, snapshot);
        snapshots.set(tx, values);
      }
      return { ...snapshot, settledAt: new Date(snapshot.settledAt) };
    },
  };
}
