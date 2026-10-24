import { z } from 'zod';
import { id } from './seating-policy.js';
export const optionsSchema = z.strictObject({
  planningHeadcount: z.int().nonnegative(),
  bookingRevision: z.int().positive(),
  items: z.array(
    z.strictObject({
      layoutTemplateVersionId: id,
      name: z.string(),
      minGuests: z.int().positive(),
      maxGuests: z.int().positive(),
      totalSeatCapacity: z.int().positive(),
      description: z.string().optional(),
      tables: z
        .array(
          z.strictObject({
            layoutTableId: id,
            tableLabel: z.string(),
            shape: z.enum(['ROUND', 'RECTANGLE']),
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
            rotationDegrees: z.number(),
            seatCapacity: z.int().positive(),
          }),
        )
        .optional(),
      compatible: z.boolean(),
      warning: z
        .enum(['HEADCOUNT_OUTSIDE_LAYOUT_RANGE', 'EXCEPTION_EXCEEDS_PHYSICAL_CAPACITY'])
        .nullable(),
    }),
  ),
});

export type SeatingLayoutOptions = z.output<typeof optionsSchema>;
