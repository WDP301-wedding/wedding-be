import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { createPrismaDepositSettlementReader } from './prisma-deposit-settlement.reader.js';

describe('settlement reader rejects corrupt persisted evidence', () => {
  it.each([
    { amount: 0, time: new Date(), evidence: 'verified' },
    { amount: -1, time: new Date(), evidence: 'verified' },
    { amount: 1.5, time: new Date(), evidence: 'verified' },
    { amount: Number.MAX_SAFE_INTEGER + 1, time: new Date(), evidence: 'verified' },
    { amount: 100, time: new Date(Number.NaN), evidence: 'verified' },
  ])('fails closed for $amount/$evidence', async ({ amount, time, evidence }) => {
    // Simulate corrupt owner storage, not an accepted financial settlement.
    const prisma = {
      bookingDepositSettlement: {
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

describe('settlement evidence in a scoped read', () => {
  function fixture() {
    const bookingId = randomUUID();
    const paymentId = randomUUID();
    const findUnique = vi.fn().mockResolvedValue({
      paymentId,
      amountVnd: { toNumber: () => 100 },
      settledAt: new Date('2026-10-19T00:00:00Z'),
    });
    const prisma = {
      bookingDepositSettlement: { findUnique },
      $transaction: (work: (tx: object) => Promise<unknown>) =>
        work({
          $executeRaw: vi.fn().mockResolvedValue(1),
          bookingDepositSettlement: { findUnique },
        }),
    } as unknown as PrismaClient;
    const boundary = new PrismaBookingBoundary(prisma);
    const reader = createPrismaDepositSettlementReader(prisma, boundary);
    const input = {
      bookingId,
      context: {
        requestId: randomUUID(),
        causationId: randomUUID(),
        actorAccountId: randomUUID(),
        authority: 'AUTHENTICATED' as const,
      },
    };
    return { bookingId, findUnique, reader, boundary, input };
  }
  it('reuses validated evidence only inside the same read transaction and protects its Date value', async () => {
    const f = fixture();
    await f.boundary.runRead(f.input, async () => {
      const first = await f.reader.requireDepositSettlement(f.bookingId);
      first.settledAt.setUTCFullYear(1999);
      expect(await f.reader.requireDepositSettlement(f.bookingId)).toMatchObject({
        amountVnd: 100,
        settledAt: new Date('2026-10-19T00:00:00Z'),
      });
    });
    expect(f.findUnique).toHaveBeenCalledTimes(1);
    await f.boundary.runRead(f.input, () => f.reader.requireDepositSettlement(f.bookingId));
    expect(f.findUnique).toHaveBeenCalledTimes(2);
  });
  it('keeps write scopes and unscoped reads fresh', async () => {
    const f = fixture();
    await f.boundary.run(f.input, async () => {
      await f.reader.requireDepositSettlement(f.bookingId);
      await f.reader.requireDepositSettlement(f.bookingId);
    });
    await f.reader.requireDepositSettlement(f.bookingId);
    await f.reader.requireDepositSettlement(f.bookingId);
    expect(f.findUnique).toHaveBeenCalledTimes(4);
  });
  it('does not cache missing or invalid evidence', async () => {
    const f = fixture();
    f.findUnique.mockResolvedValueOnce(null);
    await f.boundary.runRead(f.input, async () => {
      await expect(f.reader.requireDepositSettlement(f.bookingId)).rejects.toMatchObject({
        status: 404,
      });
      await expect(f.reader.requireDepositSettlement(f.bookingId)).resolves.toMatchObject({
        amountVnd: 100,
      });
    });
    expect(f.findUnique).toHaveBeenCalledTimes(2);
  });
});
