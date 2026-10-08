import { randomUUID } from 'node:crypto';

import { AppError } from '../../../core/errors/app-error.js';
import { bookingEventMetadata } from '../../../core/integration-events/booking-event.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { AcquiredSlotHold, SlotHoldRepository } from '../application/slot-hold.service.js';
import { createSlotHold, slotKey } from '../domain/slot-hold.policy.js';
import { BookingLifecycleNotFoundError } from './consultation.repository.js';

type BookingSlotConflictCode =
  'SLOT_NOT_AVAILABLE' | 'STALE_BOOKING_REVISION' | 'BOOKING_SLOT_MISMATCH';

const messages: Readonly<Record<BookingSlotConflictCode, string>> = {
  SLOT_NOT_AVAILABLE: 'The selected event slot is not available.',
  STALE_BOOKING_REVISION: 'The booking changed after it was loaded.',
  BOOKING_SLOT_MISMATCH: 'The requested slot does not match the booking proposal.',
};

export class BookingSlotConflictError extends AppError {
  constructor(code: BookingSlotConflictCode) {
    super({ status: 409, code, message: messages[code] });
  }
}

export function createPrismaSlotHoldRepository(
  prisma: PrismaClient,
  createId: () => string = randomUUID,
): SlotHoldRepository {
  return Object.freeze({
    async inspect(input: Parameters<SlotHoldRepository['inspect']>[0]) {
      const confirmed = await prisma.booking.findFirst({
        where: {
          hallId: input.hallId,
          eventDate: localDate(input.eventDate),
          shiftCode: input.shiftCode,
          phase: { in: ['CONFIRMED', 'COMPLETED'] },
        },
        select: { id: true },
      });
      if (confirmed !== null) return Object.freeze({ available: false, activeHold: null });
      const active = await prisma.bookingSlotHold.findFirst({
        where: {
          hallId: input.hallId,
          eventDate: localDate(input.eventDate),
          shiftCode: input.shiftCode,
          status: 'ACTIVE',
          OR: [
            { expiresAt: { gt: input.databaseNow } },
            { depositIntentPin: { in: ['ACTIVE', 'UNKNOWN'] } },
          ],
        },
        select: { id: true, expiresAt: true },
      });
      if (active === null) return Object.freeze({ available: true, activeHold: null });
      return immutable({
        available: false,
        activeHold: { holdId: active.id, expiresAt: active.expiresAt },
      });
    },

    async acquire(input: Parameters<SlotHoldRepository['acquire']>[0]) {
      try {
        return await prisma.$transaction(
          async (transaction) => {
            await transaction.$executeRaw(
              Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${slotKey(input)}))`,
            );
            const booking = await transaction.booking.findUnique({
              where: { id: input.bookingId },
              select: {
                id: true,
                hallId: true,
                eventDate: true,
                shiftCode: true,
                revision: true,
                phase: true,
                consultation: { select: { managerAccountId: true } },
              },
            });
            if (
              booking === null ||
              booking.consultation.managerAccountId !== input.managerAccountId
            ) {
              throw new BookingLifecycleNotFoundError();
            }
            const confirmed = await transaction.booking.findFirst({
              where: {
                hallId: input.hallId,
                eventDate: localDate(input.eventDate),
                shiftCode: input.shiftCode,
                phase: { in: ['CONFIRMED', 'COMPLETED'] },
              },
              select: { id: true },
            });
            if (confirmed !== null) throw new BookingSlotConflictError('SLOT_NOT_AVAILABLE');
            if (booking.phase === 'CANCELLED')
              throw new AppError({
                status: 409,
                code: 'INVALID_BOOKING_TRANSITION',
                message: 'A cancelled booking cannot acquire a hold.',
              });
            if (
              booking.hallId !== input.hallId ||
              isoLocalDate(booking.eventDate) !== input.eventDate ||
              booking.shiftCode !== input.shiftCode
            ) {
              throw new BookingSlotConflictError('BOOKING_SLOT_MISMATCH');
            }

            const current = await transaction.bookingSlotHold.findFirst({
              where: {
                hallId: input.hallId,
                eventDate: localDate(input.eventDate),
                shiftCode: input.shiftCode,
                status: 'ACTIVE',
              },
              select: {
                id: true,
                bookingId: true,
                expiresAt: true,
                depositIntentPin: true,
              },
            });
            if (
              current?.bookingId === input.bookingId &&
              (current.expiresAt.getTime() > input.acquiredAt.getTime() ||
                current.depositIntentPin === 'ACTIVE' ||
                current.depositIntentPin === 'UNKNOWN')
            ) {
              return immutable({
                holdId: current.id,
                bookingId: input.bookingId,
                expiresAt: current.expiresAt,
                bookingRevision: booking.revision,
                replayed: true,
              });
            }
            if (current !== null) {
              const elapsed = current.expiresAt.getTime() <= input.acquiredAt.getTime();
              const pinned =
                current.depositIntentPin === 'ACTIVE' || current.depositIntentPin === 'UNKNOWN';
              if (!elapsed || pinned) throw new BookingSlotConflictError('SLOT_NOT_AVAILABLE');
              await transaction.bookingSlotHold.updateMany({
                where: {
                  id: current.id,
                  status: 'ACTIVE',
                  depositIntentPin: { notIn: ['ACTIVE', 'UNKNOWN'] },
                },
                data: { status: 'EXPIRED', terminalAt: input.acquiredAt },
              });
            }
            if (booking.revision !== input.expectedRevision) {
              throw new BookingSlotConflictError('STALE_BOOKING_REVISION');
            }

            const hold = createSlotHold(input);
            await transaction.bookingSlotHold.create({
              data: {
                id: hold.holdId,
                bookingId: hold.bookingId,
                hallId: hold.hallId,
                eventDate: localDate(hold.eventDate),
                shiftCode: hold.shiftCode,
                status: hold.status,
                depositIntentPin: 'NONE',
                expiresAt: hold.expiresAt,
                acquiredByAccountId: input.managerAccountId,
                createdAt: input.acquiredAt,
              },
            });
            const updated = await transaction.booking.updateMany({
              where: { id: input.bookingId, revision: input.expectedRevision },
              data: { revision: { increment: 1 } },
            });
            if (updated.count !== 1) {
              throw new BookingSlotConflictError('STALE_BOOKING_REVISION');
            }
            const bookingRevision = input.expectedRevision + 1;
            await transaction.auditLog.create({
              data: {
                occurredAt: input.acquiredAt,
                requestId: input.requestId,
                actorType: 'USER',
                actorId: input.managerAccountId,
                action: 'booking.slot-held',
                entityType: 'booking',
                entityId: input.bookingId,
                metadata: { holdId: input.holdId, expiresAt: hold.expiresAt.toISOString() },
              },
            });
            await transaction.bookingOutboxEvent.create({
              data: {
                ...bookingEventMetadata(input),
                id: createId(),
                eventType: 'booking.slot-held',
                aggregateId: input.bookingId,
                aggregateRevision: bookingRevision,
                occurredAt: input.acquiredAt,
                payload: {
                  bookingId: input.bookingId,
                  holdId: input.holdId,
                  expiresAt: hold.expiresAt.toISOString(),
                },
              },
            });
            return immutable({
              holdId: hold.holdId,
              bookingId: hold.bookingId,
              expiresAt: hold.expiresAt,
              bookingRevision,
              replayed: false,
            } satisfies AcquiredSlotHold);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error: unknown) {
        if (isPrismaCode(error, 'P2002')) {
          throw new BookingSlotConflictError('SLOT_NOT_AVAILABLE');
        }
        throw error;
      }
    },
  });
}

function localDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isoLocalDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as Readonly<{ code?: unknown }>).code === code
  );
}

function immutable<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
