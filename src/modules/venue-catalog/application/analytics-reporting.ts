import { z } from 'zod';
export const availabilitySchema = z.strictObject({
  observedAt: z.iso.datetime({ offset: true }),
  halls: z.array(z.strictObject({ id: z.uuid(), active: z.boolean() })),
  shifts: z.array(z.strictObject({ id: z.enum(['LUNCH', 'DINNER']), active: z.boolean() })),
});
