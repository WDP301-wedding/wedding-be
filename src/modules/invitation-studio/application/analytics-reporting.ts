import { z } from 'zod';
export const printAnalyticsSchema = z.strictObject({
  bookingId: z.uuid(),
  printOrderId: z.uuid(),
  status: z.enum([
    'REQUESTED',
    'QUOTED',
    'APPROVED',
    'IN_PRODUCTION',
    'READY_FOR_HANDOVER',
    'HANDED_OVER',
    'CANCELLED',
  ]),
  commercialRevisionId: z.uuid().nullable(),
  receivableChargeId: z.uuid().nullable(),
  acceptedAmountVnd: z.int().nonnegative(),
  approvedAt: z.iso.datetime({ offset: true }).nullable(),
  updatedAt: z.iso.datetime({ offset: true }),
});
