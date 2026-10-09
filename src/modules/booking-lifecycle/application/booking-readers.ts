import { z } from 'zod';
import type { ContractContext } from '../../../core/database/booking-boundary.js';

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

/** Exact baseline6.3 subset required by media. Deposit eligibility/writers belong
 * to SPEC-03/04 and are not falsely published by this read-side hand-off. */
export interface BookingMediaPrerequisiteReader {
  requireBookingAccess(input: {
    bookingId: string;
    accountId: string;
    minimum: 'RESTRICTED' | 'FULL';
  }): Promise<{
    consultationId: string;
    bookingId: string;
    phase: 'DRAFT' | 'AWAITING_DEPOSIT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  }>;
  requireConfirmedEventContext(bookingId: string): Promise<{
    consultationId: string;
    bookingId: string;
    hallId: string;
    shiftCode: 'LUNCH' | 'DINNER';
    eventDate: string;
    effectiveTimelineRevisionId: string;
    planningHeadcount: number;
  }>;
}
export interface ApprovedTimelineSnapshot {
  readonly bookingId: string;
  readonly timelineRevisionId: string;
  readonly revisionNumber: number;
  readonly eventDate: string;
  readonly hallName: string;
  readonly shiftCode: 'LUNCH' | 'DINNER';
  readonly shiftStartTime: string;
  readonly shiftEndTime: string;
  readonly items: readonly Readonly<{
    itemId: string;
    order: number;
    startTime: string;
    title: string;
    description: string | null;
  }>[];
  readonly approvedByManagerAt: string;
  readonly approvedByCoupleAt: string;
  readonly isEffective: boolean;
}
export interface BookingTimelineSnapshotReader {
  resolveApprovedRevision(
    input: Readonly<{ bookingId: string; timelineRevisionId: string }>,
    context: ContractContext,
  ): Promise<Readonly<ApprovedTimelineSnapshot>>;
}
