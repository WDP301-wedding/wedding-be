import { z } from 'zod';

export const bookingLookupQuerySchema = z
  .strictObject({
    q: z.string().trim().min(2).max(120).optional(),
    ids: z
      .string()
      .max(739)
      .refine((value) => {
        const ids = value.split(',');
        return ids.length <= 20 && ids.every((id) => z.uuid().safeParse(id).success);
      })
      .optional(),
  })
  .refine((value) => Boolean(value.q) !== Boolean(value.ids), {
    message: 'Supply either a search term or a batch of booking IDs.',
  });

export const bookingLookupResponseSchema = z.strictObject({
  data: z.array(
    z.strictObject({
      bookingId: z.uuid(),
      bookingCode: z.string().regex(/^HY-\d{6,}$/),
      customerName: z.string(),
      brideName: z.string().nullable().optional(),
      groomName: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      eventDate: z.iso.date(),
      hallName: z.string(),
      shiftCode: z.enum(['LUNCH', 'DINNER']),
      alias: z.string().nullable(),
    }),
  ),
});
