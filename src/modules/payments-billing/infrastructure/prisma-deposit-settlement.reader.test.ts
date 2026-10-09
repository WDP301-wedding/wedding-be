import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { createPrismaDepositSettlementReader } from './prisma-deposit-settlement.reader.js';

describe('settlement reader rejects corrupt persisted evidence', () => {
  it.each([
    { amount: 0, time: new Date(), evidence: 'verified' },
    { amount: -1, time: new Date(), evidence: 'verified' },
    { amount: 1.5, time: new Date(), evidence: 'verified' },
    { amount: Number.MAX_SAFE_INTEGER + 1, time: new Date(), evidence: 'verified' },
    { amount: 100, time: new Date(Number.NaN), evidence: 'verified' },
    { amount: 100, time: new Date(), evidence: '' },
  ])('fails closed for $amount/$evidence', async ({ amount, time, evidence }) => {
    // Simulate corrupt owner storage, not an accepted financial settlement.
    const prisma = {
      depositSettlement: {
        findUnique: vi.fn().mockResolvedValue({
          paymentId: randomUUID(),
          amountVnd: { toNumber: () => amount },
          settledAt: time,
          evidenceReference: evidence,
        }),
      },
    } as unknown as PrismaClient;
    const boundary = { current: () => undefined } as unknown as PrismaBookingBoundary;
    await expect(
      createPrismaDepositSettlementReader(prisma, boundary).requireDepositSettlement(randomUUID()),
    ).rejects.toMatchObject({ status: 422 });
  });
});
