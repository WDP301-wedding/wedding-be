import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createCommercialConversionGuard } from './commercial-conversion.guard.js';
describe('legacy commercial conversion guard', () => {
  it.each([
    [null, null, true],
    [{ id: 'charge' }, null, false],
    [null, { id: 'attempt' }, false],
    [{ id: 'charge' }, { id: 'attempt' }, false],
  ])('preserves existing monetary evidence', async (prior, attempt, allowed) => {
    const ledger = vi.fn().mockResolvedValue(prior),
      payment = vi.fn().mockResolvedValue(attempt);
    const client = {
      billingLedgerEntry: { findFirst: ledger },
      billingPaymentAttempt: { findFirst: payment },
    } as unknown as PrismaClient;
    const command = createCommercialConversionGuard(client).requireConvertible('booking');
    if (allowed) await expect(command).resolves.toBeUndefined();
    else
      await expect(command).rejects.toMatchObject({
        status: 409,
        code: 'LEGACY_COMMERCIAL_CONVERSION_BLOCKED',
      });
    expect(ledger).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking',
        sourceType: { in: ['BASE_BOOKING', 'PRINT_ORDER', 'CONTRACT'] },
      },
      select: { id: true },
    });
    expect(payment).toHaveBeenCalledWith({
      where: {
        bookingId: 'booking',
        purpose: 'DEPOSIT',
        state: { in: ['CREATED', 'PENDING', 'UNKNOWN', 'SUCCEEDED'] },
      },
      select: { id: true },
    });
  });
});
