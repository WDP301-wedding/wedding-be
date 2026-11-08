import { z } from 'zod';
import type { Prisma } from '../../../generated/prisma/client.js';

export const eventOperationsSchema = z.strictObject({
  phase: z.enum(['CONFIRMED', 'COMPLETED']),
  brideName: z.string().nullable(),
  groomName: z.string().nullable(),
  tableCount: z.int().positive(),
  offerings: z
    .array(
      z.strictObject({
        category: z.enum(['MENU', 'SERVICE']),
        name: z.string(),
        description: z.string(),
        unit: z.string(),
        quantity: z.int().positive(),
      }),
    )
    .max(50),
});
export interface EventOperationsReader {
  read(
    tx: Prisma.TransactionClient,
    bookingId: string,
  ): Promise<z.infer<typeof eventOperationsSchema>>;
}
