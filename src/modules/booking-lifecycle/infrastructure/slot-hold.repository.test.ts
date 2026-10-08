/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { describe, expect, it, vi } from 'vitest';

import type { SlotHoldRepository } from '../application/slot-hold.service.js';
import {
  BookingSlotConflictError,
  createPrismaSlotHoldRepository,
} from './slot-hold.repository.js';

const input = Object.freeze({
  holdId: '00000000-0000-4000-8000-000000000001',
  bookingId: '00000000-0000-4000-8000-000000000002',
  hallId: '00000000-0000-4000-8000-000000000003',
  eventDate: '2026-12-20',
  shiftCode: 'DINNER' as const,
  managerAccountId: '00000000-0000-4000-8000-000000000004',
  expectedRevision: 1,
  requestId: '00000000-0000-4000-8000-000000000005',
  acquiredAt: new Date('2026-10-07T10:00:00.000Z'),
});

describe('PrismaSlotHoldRepository', () => {
  it('keeps a confirmed slot unavailable after its temporary hold is consumed', async () => {
    const transaction = transactionFixture();
    transaction.booking.findFirst.mockResolvedValue({ id: 'confirmed-booking' });
    const repository = createPrismaSlotHoldRepository(client(transaction));
    await expect(
      repository.inspect({
        hallId: input.hallId,
        eventDate: input.eventDate,
        shiftCode: input.shiftCode,
        databaseNow: input.acquiredAt,
      }),
    ).resolves.toMatchObject({ available: false });
    await expect(repository.acquire(input)).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
    expect(transaction.bookingSlotHold.create).not.toHaveBeenCalled();
  });
  it('allocates the slot and commits revision, audit, and outbox together', async () => {
    const transaction = transactionFixture();
    const repository = createPrismaSlotHoldRepository(client(transaction));

    await expect(repository.acquire(input)).resolves.toEqual({
      holdId: input.holdId,
      bookingId: input.bookingId,
      expiresAt: new Date('2026-10-07T10:15:00.000Z'),
      bookingRevision: 2,
      replayed: false,
    });

    expect(transaction.bookingSlotHold.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: input.holdId,
        expiresAt: new Date('2026-10-07T10:15:00.000Z'),
        status: 'ACTIVE',
      }),
    });
    expect(transaction.booking.updateMany).toHaveBeenCalledWith({
      where: { id: input.bookingId, revision: 1 },
      data: { revision: { increment: 1 } },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.bookingOutboxEvent.create).toHaveBeenCalledOnce();
  });

  it('expires an elapsed unpinned hold before allocating the next contender', async () => {
    const transaction = transactionFixture();
    transaction.bookingSlotHold.findFirst.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000099',
      bookingId: '00000000-0000-4000-8000-000000000098',
      expiresAt: new Date('2026-10-07T09:59:00.000Z'),
      depositIntentPin: 'NONE',
    });

    await createPrismaSlotHoldRepository(client(transaction)).acquire(input);

    expect(transaction.bookingSlotHold.updateMany).toHaveBeenCalledWith({
      where: {
        id: '00000000-0000-4000-8000-000000000099',
        status: 'ACTIVE',
        depositIntentPin: { notIn: ['ACTIVE', 'UNKNOWN'] },
      },
      data: { status: 'EXPIRED', terminalAt: input.acquiredAt },
    });
  });

  it.each(['ACTIVE', 'UNKNOWN'] as const)(
    'refuses a contender when an elapsed slot is pinned by a %s deposit intent',
    async (depositIntentPin) => {
      const transaction = transactionFixture();
      transaction.bookingSlotHold.findFirst.mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000099',
        bookingId: '00000000-0000-4000-8000-000000000098',
        expiresAt: new Date('2026-10-07T09:59:00.000Z'),
        depositIntentPin,
      });

      await expect(
        createPrismaSlotHoldRepository(client(transaction)).acquire(input),
      ).rejects.toMatchObject({ code: 'SLOT_NOT_AVAILABLE' });
      expect(transaction.bookingSlotHold.create).not.toHaveBeenCalled();
    },
  );

  it('reports an elapsed unpinned hold as available without exposing its owner', async () => {
    const transaction = transactionFixture();
    transaction.bookingSlotHold.findFirst.mockResolvedValue(null);
    const repository: SlotHoldRepository = createPrismaSlotHoldRepository(client(transaction));

    await expect(
      repository.inspect({
        hallId: input.hallId,
        eventDate: input.eventDate,
        shiftCode: input.shiftCode,
        databaseNow: input.acquiredAt,
      }),
    ).resolves.toEqual({ available: true, activeHold: null });
  });

  it('maps a database uniqueness loser to stable slot conflict', async () => {
    const transaction = transactionFixture();
    transaction.bookingSlotHold.create.mockRejectedValue(
      Object.assign(new Error('unique'), { code: 'P2002', name: 'PrismaClientKnownRequestError' }),
    );

    await expect(
      createPrismaSlotHoldRepository(client(transaction)).acquire(input),
    ).rejects.toBeInstanceOf(BookingSlotConflictError);
  });
});

function transactionFixture() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    booking: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({
        id: input.bookingId,
        hallId: input.hallId,
        eventDate: new Date('2026-12-20T00:00:00.000Z'),
        shiftCode: input.shiftCode,
        revision: 1,
        consultation: { managerAccountId: input.managerAccountId },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    bookingSlotHold: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    bookingOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

function client(transaction: object) {
  return {
    booking: (transaction as ReturnType<typeof transactionFixture>).booking,
    bookingSlotHold: (transaction as ReturnType<typeof transactionFixture>).bookingSlotHold,
    $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as never;
}
