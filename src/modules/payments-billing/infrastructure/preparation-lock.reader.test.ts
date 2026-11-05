import { describe, expect, it, vi } from 'vitest';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createPreparationLockReader } from './preparation-lock.reader.js';

function fixture() {
  const db = {
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        phase: 'CONFIRMED',
        finalInvoices: {
          currentRevision: { totalVnd: { equals: (value: number) => value === 1000 } },
        },
      }),
    },
    billingPaymentAttempt: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn(),
  };
  const boundary = { current: () => db } as unknown as PrismaBookingBoundary;
  const reader = createPreparationLockReader({} as PrismaClient, boundary);
  const totals = (payment: number) => [
    {
      baseChargesVnd: 1000,
      printChargesVnd: 0,
      creditAdjustmentsVnd: 0,
      settledPaymentsVnd: payment,
      completedRefundsVnd: 0,
    },
  ];
  return { db, reader, totals };
}

describe('preparation lock', () => {
  it('locks a confirmed booking only after a finalized invoice and exact settled ledger agree', async () => {
    const { db, reader, totals } = fixture();
    db.$queryRaw.mockResolvedValueOnce(totals(300));
    await expect(reader.requireEditable('booking')).resolves.toBeUndefined();
    db.$queryRaw.mockResolvedValueOnce(totals(1200));
    await expect(reader.requireEditable('booking')).resolves.toBeUndefined();
    db.$queryRaw.mockResolvedValue(totals(1000));
    db.billingPaymentAttempt.findFirst.mockResolvedValueOnce({ id: 'unapplied' });
    await expect(reader.requireEditable('booking')).resolves.toBeUndefined();
    await expect(reader.requireEditable('booking')).rejects.toMatchObject({
      status: 409,
      code: 'PREPARATION_READ_ONLY',
    });
  });

  it('locks on completion even without an invoice and leaves deposits editable', async () => {
    const { db, reader } = fixture();
    db.booking.findUnique.mockResolvedValueOnce({ phase: 'CONFIRMED', finalInvoices: null });
    await expect(reader.read('booking')).resolves.toBeNull();
    db.booking.findUnique.mockResolvedValueOnce({ phase: 'COMPLETED', finalInvoices: null });
    await expect(reader.read('booking')).resolves.toBe('EVENT_COMPLETED');
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
