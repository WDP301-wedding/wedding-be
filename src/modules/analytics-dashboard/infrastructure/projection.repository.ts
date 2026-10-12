import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import {
  checkpointsSchema,
  type ProjectionStore,
  type ProjectionReadFilter,
} from '../application/projection.js';
import { reportingOwners } from '../../../core/reporting/reporting-feed.js';

export function createProjectionRepository(prisma: PrismaClient): ProjectionStore {
  return {
    async load(scope, bounded = false, filter) {
      return prisma.$transaction(
        async (tx) => {
          const head = await tx.analyticsHead.findUnique({ where: { scope } });
          if (!head) return null;
          const generation = await tx.analyticsGeneration.findUniqueOrThrow({
            where: { id: head.generationId },
          });
          const rows =
            bounded && filter
              ? await readFiltered(tx, head.generationId, filter)
              : await tx.analyticsProjection.findMany({
                  where: { generationId: head.generationId },
                  ...(bounded ? { take: 60001 } : {}),
                  orderBy: [{ owner: 'asc' }, { recordId: 'asc' }],
                });
          if (bounded && rows.length > 60000)
            throw new AppError({
              status: 422,
              code: 'ANALYTICS_QUERY_TOO_BROAD',
              message: 'The report exceeds its bounded projection budget.',
            });
          return {
            generationId: generation.id,
            checkpoints: checkpointsSchema.parse(generation.checkpoints),
            rows: rows.map((r) => ({
              recordId: r.recordId,
              sequence: r.sequence,
              changedAt: generation.createdAt.toISOString(),
              owner: reportingOwners.find((o) => o === r.owner)!,
              value: r.value,
            })),
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
    async publish(scope, expectedGeneration, projection) {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'analytics/' + scope}))`;
          const head = await tx.analyticsHead.findUnique({ where: { scope } });
          if ((head?.generationId ?? null) !== expectedGeneration)
            throw new AppError({
              status: 409,
              code: 'ANALYTICS_REFRESH_CONFLICT',
              message: 'The projection changed during refresh. Retry.',
            });
          const id = randomUUID();
          await tx.analyticsGeneration.create({
            data: { id, scope, checkpoints: projection.checkpoints },
          });
          for (let offset = 0; offset < projection.rows.length; offset += 500) {
            await tx.analyticsProjection.createMany({
              data: projection.rows.slice(offset, offset + 500).map((r) => ({
                generationId: id,
                owner: r.owner,
                recordId: r.recordId,
                sequence: r.sequence,
                value: r.value as Prisma.InputJsonValue,
              })),
            });
          }
          await tx.analyticsHead.upsert({
            where: { scope },
            create: { scope, generationId: id },
            update: { generationId: id },
          });
          // Readers pin a generation only inside a repeatable-read transaction; MVCC preserves their view.
          await tx.analyticsProjection.deleteMany({
            where: {
              generationId: {
                in: (
                  await tx.analyticsGeneration.findMany({
                    where: { scope, id: { not: id } },
                    select: { id: true },
                  })
                ).map((g) => g.id),
              },
            },
          });
          await tx.analyticsGeneration.deleteMany({ where: { scope, id: { not: id } } });
          return id;
        },
        { timeout: 60000 },
      );
    },
  };
}
async function readFiltered(
  tx: Prisma.TransactionClient,
  generationId: string,
  q: ProjectionReadFilter,
) {
  const hall = q.hallId ?? null,
    phase = q.phase ?? null,
    menu = q.menuPackageId ?? null;
  return tx.$queryRaw<
    Array<{ owner: string; recordId: string; sequence: number; value: Prisma.JsonValue }>
  >(Prisma.sql`
    WITH candidates AS (
      SELECT b."recordId" FROM "AnalyticsProjection" b
      WHERE b."generationId"=${generationId}::uuid AND b.owner='booking'
        AND (${hall}::text IS NULL OR b.value->>'hallId'=${hall}) AND (
          (b.value->>'eventDate' BETWEEN ${q.dateFrom} AND ${q.dateTo}
           AND ${q.includeUtilization} AND b.value->>'phase' IN ('CONFIRMED','COMPLETED')) OR (
          (${phase}::text IS NULL OR b.value->>'phase'=${phase}) AND
          (${menu}::text IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(b.value->'commercialLines') l
             WHERE l->>'category'='MENU' AND l->>'sourceId'=${menu}) OR
             (b.value->'commercialLines'='[]'::jsonb AND b.value->>'menuPackageId'=${menu})) AND (
            b.value->>'eventDate' BETWEEN ${q.dateFrom} AND ${q.dateTo} OR
            (${q.includeCash} AND EXISTS (SELECT 1 FROM "AnalyticsProjection" c,
              LATERAL jsonb_array_elements(c.value->'ledger') e
              WHERE c."generationId"=b."generationId" AND c.owner='billing' AND c."recordId"=b."recordId"
                AND e->>'kind' IN ('PAYMENT','REFUND')
                AND (e->>'occurredAt')::timestamptz >= ${q.cashFrom}::timestamptz
                AND (e->>'occurredAt')::timestamptz < ${q.cashTo}::timestamptz))))
        )
    ), prior_venue AS (
      SELECT "recordId" FROM "AnalyticsProjection" WHERE "generationId"=${generationId}::uuid AND owner='venue'
        AND (value->>'observedAt')::timestamptz <= ${q.cashFrom}::timestamptz
        ORDER BY (value->>'observedAt')::timestamptz DESC,sequence DESC LIMIT 1
    )
    SELECT p.owner,p."recordId",p.sequence,p.value FROM "AnalyticsProjection" p
    WHERE p."generationId"=${generationId}::uuid AND p.owner=ANY(${[...q.owners]}::text[]) AND (
      (p.owner='venue' AND ((p.value->>'observedAt')::timestamptz >= ${q.cashFrom}::timestamptz
        AND (p.value->>'observedAt')::timestamptz < ${q.cashTo}::timestamptz
        OR p."recordId" IN (SELECT "recordId" FROM prior_venue))) OR
      (p.owner<>'venue' AND p.value->>'bookingId' IN (SELECT "recordId" FROM candidates))
    ) ORDER BY p.owner,p."recordId" LIMIT 60001
  `);
}
