import { z } from 'zod';
import { AppError } from '../../../core/errors/app-error.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import {
  billingReportRowSchema,
  sourceQuerySchema,
  type BillingReportingReader,
} from '../application/payments-billing.providers.js';

const cursorSchema = z.strictObject({
  afterSequence: z.int().nonnegative(),
  throughSequence: z.int().nonnegative(),
  sequence: z.int().nonnegative(),
});
export function createBillingReportingReader(prisma: PrismaClient): BillingReportingReader {
  return Object.freeze<BillingReportingReader>({
    async readPage(query, context) {
      const actor =
        context.actorAccountId === null
          ? null
          : await prisma.account.findUnique({
              where: { id: context.actorAccountId },
              select: { status: true, roles: { select: { role: true } } },
            });
      if (
        context.authority !== 'AUTHENTICATED' ||
        actor?.status !== 'ACTIVE' ||
        !actor.roles.some(({ role }) => role === 'MANAGER')
      )
        throw new AppError({
          status: 403,
          code: 'FORBIDDEN',
          message: 'Reporting requires an active Manager.',
        });
      const input = sourceQuerySchema.parse(query);
      const counter = await prisma.billingReportingSequence.findUniqueOrThrow({
        where: { owner: 'billing' },
      });
      const throughSequence = input.throughSequence ?? counter.value;
      let sequence = input.afterSequence;
      if (throughSequence > counter.value || throughSequence < sequence) throw invalidCursor();
      if (input.cursor !== undefined) {
        let cursor: z.infer<typeof cursorSchema>;
        try {
          cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')),
          );
        } catch {
          throw invalidCursor();
        }
        if (
          cursor.afterSequence !== input.afterSequence ||
          cursor.throughSequence !== throughSequence ||
          cursor.sequence < sequence ||
          cursor.sequence > throughSequence
        )
          throw invalidCursor();
        sequence = cursor.sequence;
      }
      const rows = await prisma.billingReportingSnapshot.findMany({
        where: { sequence: { gt: sequence, lte: throughSequence } },
        orderBy: { sequence: 'asc' },
        take: input.limit + 1,
      });
      const page = rows.slice(0, input.limit);
      return Object.freeze({
        throughSequence,
        nextCursor:
          rows.length <= input.limit
            ? null
            : Buffer.from(
                JSON.stringify({
                  afterSequence: input.afterSequence,
                  throughSequence,
                  sequence: page.at(-1)!.sequence,
                }),
              ).toString('base64url'),
        rows: Object.freeze(
          page.map((row) =>
            Object.freeze({
              recordId: row.bookingId,
              sequence: row.sequence,
              changedAt: row.changedAt.toISOString(),
              value: billingReportRowSchema.parse(row.value),
            }),
          ),
        ),
      });
    },
  });
}
function invalidCursor() {
  return new AppError({
    status: 422,
    code: 'VALIDATION_ERROR',
    message: 'The reporting cursor does not match its query fence.',
  });
}
