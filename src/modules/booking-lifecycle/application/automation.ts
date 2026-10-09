import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import type { ContractContext } from './deposit.service.js';

export const dueQuerySchema = z.strictObject({
  kind: z.enum(['D3_REMINDER', 'COMPLETION']),
  dueBefore: z.iso.datetime(),
  cursor: z.string().max(512).optional(),
  limit: z.int().min(1).max(500),
});
export const completeDueSchema = z.strictObject({
  bookingId: z.uuid(),
  expectedBookingRevision: z.int().positive(),
  commandId: z.uuid(),
  now: z.iso.datetime(),
});
export interface BookingAutomationPort {
  listDue(
    input: z.infer<typeof dueQuerySchema>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      nextCursor: string | null;
      items: readonly Readonly<{
        bookingId: string;
        bookingRevision: number;
        dueAt: string;
        coupleAccountId: string;
      }>[];
    }>
  >;
  completeDue(
    input: z.infer<typeof completeDueSchema>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      outcome: 'COMPLETED' | 'REPLAYED' | 'NOT_DUE' | 'SKIPPED_TERMINAL';
    }>
  >;
}

// The composition root supplies the worker-purpose allowlist; HTTP payloads never construct this authority.
export function createBookingAutomationPort(
  repository: BookingAutomationPort,
  authorizeWorker: (context: ContractContext) => Promise<void>,
): BookingAutomationPort {
  async function authorize(context: ContractContext): Promise<void> {
    if (context.authority !== 'SYSTEM' || context.actorAccountId !== null) {
      throw new AppError({
        status: 403,
        code: 'FORBIDDEN',
        message: 'This operation requires an allowlisted booking worker.',
      });
    }
    await authorizeWorker(context);
  }
  return Object.freeze({
    async listDue(
      input: Parameters<BookingAutomationPort['listDue']>[0],
      context: ContractContext,
    ) {
      await authorize(context);
      return repository.listDue(dueQuerySchema.parse(input), context);
    },
    async completeDue(
      input: Parameters<BookingAutomationPort['completeDue']>[0],
      context: ContractContext,
    ) {
      await authorize(context);
      return repository.completeDue(completeDueSchema.parse(input), context);
    },
  });
}
