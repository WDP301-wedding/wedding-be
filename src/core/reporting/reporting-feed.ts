import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ContractContext } from '../database/booking-boundary.js';
import { AppError, ValidationError } from '../errors/app-error.js';

export const reportingOwners = [
  'booking',
  'billing',
  'invitation',
  'guest',
  'staff',
  'venue',
] as const;
export type ReportingOwner = (typeof reportingOwners)[number];
export const reportingFencesSchema = z.record(z.enum(reportingOwners), z.int().nonnegative());
export type ReportingFences = z.infer<typeof reportingFencesSchema>;
export const feedQuerySchema = z.strictObject({
  afterSequence: z.int().nonnegative(),
  throughSequence: z.int().nonnegative().optional(),
  cursor: z.string().max(1024).optional(),
  limit: z.int().min(1).max(500),
});
export type FeedQuery = z.input<typeof feedQuerySchema>;
export type FeedRow<T> = Readonly<{
  recordId: string;
  sequence: number;
  changedAt: string;
  value: T;
}>;
export type FeedPage<T> = Readonly<{
  throughSequence: number;
  nextCursor: string | null;
  rows: readonly FeedRow<T>[];
}>;
export interface ReportingReader<T = unknown> {
  readPage(query: FeedQuery, context: ContractContext): Promise<FeedPage<T>>;
}
const cursorSchema = z.strictObject({
  owner: z.enum(reportingOwners),
  afterSequence: z.int().nonnegative(),
  throughSequence: z.int().nonnegative(),
  sequence: z.int().nonnegative(),
});

/** Owner adapters publish only their strict DTO; the consumer cannot read domain tables. */
export function createReportingFeed<T>(
  prisma: PrismaClient,
  owner: ReportingOwner,
  schema: z.ZodType<T>,
): ReportingReader<T> {
  return {
    async readPage(query, context) {
      const input = feedQuerySchema.parse(query);
      return prisma.$transaction(
        async (tx) => {
          const actor =
            context.authority === 'AUTHENTICATED' && context.actorAccountId !== null
              ? await tx.account.findUnique({
                  where: { id: context.actorAccountId },
                  select: { status: true, roles: { select: { role: true } } },
                })
              : null;
          if (actor?.status !== 'ACTIVE' || !actor.roles.some((r) => r.role === 'MANAGER'))
            throw new AppError({
              status: 403,
              code: 'FORBIDDEN',
              message: 'Reporting requires an active Manager.',
            });
          const head = await tx.reportingSequence.findUniqueOrThrow({ where: { owner } });
          const fence = input.throughSequence ?? head.value;
          let sequence = input.afterSequence;
          if (fence < sequence || fence > head.value) throw new ValidationError();
          if (input.cursor !== undefined) {
            let cursor;
            try {
              cursor = cursorSchema.parse(
                JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')),
              );
            } catch {
              throw new ValidationError();
            }
            if (
              cursor.owner !== owner ||
              cursor.afterSequence !== sequence ||
              cursor.throughSequence !== fence ||
              cursor.sequence < sequence ||
              cursor.sequence > fence
            )
              throw new ValidationError();
            sequence = cursor.sequence;
          }
          const rows = await tx.reportingFact.findMany({
            where: { owner, sequence: { gt: sequence, lte: fence } },
            orderBy: { sequence: 'asc' },
            take: input.limit + 1,
          });
          const page = rows.slice(0, input.limit);
          return {
            throughSequence: fence,
            nextCursor:
              rows.length > input.limit
                ? Buffer.from(
                    JSON.stringify({
                      owner,
                      afterSequence: input.afterSequence,
                      throughSequence: fence,
                      sequence: page.at(-1)!.sequence,
                    }),
                  ).toString('base64url')
                : null,
            rows: page.map((r) => ({
              recordId: r.recordId,
              sequence: r.sequence,
              changedAt: r.changedAt.toISOString(),
              value: schema.parse(r.value),
            })),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
  };
}
