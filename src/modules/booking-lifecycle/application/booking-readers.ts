import { z } from 'zod';
import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import type { BookingPhase } from '../domain/booking-policy.js';
import type { DepositEligibility, BookingDepositRepository } from './deposit.service.js';

export type BookingAccessContext = Readonly<{
  consultationId: string;
  bookingId: string;
  phase: BookingPhase;
}>;

export interface BookingAccessContextRepository {
  getAccessContext(bookingId: string): Promise<BookingAccessContext>;
  requireConfirmedEventContext(bookingId: string): Promise<
    Readonly<{
      consultationId: string;
      bookingId: string;
      hallId: string;
      shiftCode: 'LUNCH' | 'DINNER';
      eventDate: string;
      effectiveTimelineRevisionId: string;
      planningHeadcount: number;
    }>
  >;
}

export interface BookingLifecycleReader {
  requireBookingAccess(input: {
    bookingId: string;
    accountId: string;
    minimum: 'RESTRICTED' | 'FULL';
  }): Promise<BookingAccessContext>;
  requireDepositEligibility(input: {
    bookingId: string;
    timelineRevisionId: string;
  }): Promise<DepositEligibility>;
  requireConfirmedEventContext(
    bookingId: string,
  ): ReturnType<BookingAccessContextRepository['requireConfirmedEventContext']>;
}

export function createBookingLifecycleReader(
  options: Readonly<{
    repository: BookingAccessContextRepository;
    access: ConsultationAccessReader;
    deposits: Pick<BookingDepositRepository, 'requireDepositEligibility'>;
  }>,
): BookingLifecycleReader {
  return Object.freeze({
    async requireBookingAccess(
      input: Parameters<BookingLifecycleReader['requireBookingAccess']>[0],
    ) {
      const context = await options.repository.getAccessContext(input.bookingId);
      await options.access.requireAccess({
        accountId: input.accountId,
        consultationId: context.consultationId,
        minimum: input.minimum,
      });
      return immutable(context);
    },

    requireDepositEligibility(
      input: Parameters<BookingLifecycleReader['requireDepositEligibility']>[0],
    ) {
      return options.deposits.requireDepositEligibility(input);
    },

    requireConfirmedEventContext(bookingId: string) {
      return options.repository.requireConfirmedEventContext(bookingId);
    },
  });
}

function immutable<T>(value: T): T {
  return Object.freeze(structuredClone(value));
}

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
export const approvedTimelineSnapshotSchema = z
  .strictObject({
    bookingId: z.uuid(),
    timelineRevisionId: z.uuid(),
    revisionNumber: z.number().int().positive(),
    eventDate: z.iso.date(),
    hallName: z.string().min(1).max(120),
    shiftCode: z.enum(['LUNCH', 'DINNER']),
    shiftStartTime: time,
    shiftEndTime: time,
    items: z
      .array(
        z.strictObject({
          itemId: z.uuid(),
          order: z.number().int().nonnegative(),
          startTime: time,
          title: z.string().min(1).max(120),
          description: z.string().max(2000).nullable(),
        }),
      )
      .min(1)
      .max(100),
    approvedByManagerAt: z.iso.datetime(),
    approvedByCoupleAt: z.iso.datetime(),
    isEffective: z.boolean(),
  })
  .refine(
    (snapshot) =>
      snapshot.shiftEndTime > snapshot.shiftStartTime &&
      new Set(snapshot.items.map((item) => item.itemId)).size === snapshot.items.length &&
      new Set(snapshot.items.map((item) => item.order)).size === snapshot.items.length &&
      snapshot.items.every(
        (item, index) =>
          item.startTime >= snapshot.shiftStartTime &&
          item.startTime <= snapshot.shiftEndTime &&
          (index === 0 || item.order > snapshot.items[index - 1]!.order),
      ),
    'Approved items must be unique, ordered and within the snapshotted shift.',
  );

export type BookingMediaPrerequisiteReader = Pick<
  BookingLifecycleReader,
  'requireBookingAccess' | 'requireConfirmedEventContext'
>;
export type {
  TimelineSnapshot as ApprovedTimelineSnapshot,
  BookingTimelineSnapshotReader,
} from './booking-snapshots.js';
