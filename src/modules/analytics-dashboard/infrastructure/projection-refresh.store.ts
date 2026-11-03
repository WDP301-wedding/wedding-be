import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import { prismaSchema } from '../../../core/database/prisma.js';
import type { ProjectionRefresh, Checkpoint } from '../application/projection.js';

const conflict = () =>
  new AppError({
    status: 409,
    code: 'ANALYTICS_REFRESH_CONFLICT',
    message: 'The projection changed during refresh. Retry.',
  });

/** Private staging generations are invisible to readers until an atomic head swap.
 * Copy/merge stays in PostgreSQL; application memory holds only one source page.
 */
export async function openProjectionRefresh(
  prisma: PrismaClient,
  scope: string,
  expected: string | null,
  rebuild: boolean,
): Promise<ProjectionRefresh> {
  const schema = Prisma.raw('"' + prismaSchema(prisma).replaceAll('"', '""') + '"');
  const id = randomUUID();
  const deadline = Date.now() + 15 * 60 * 1000;
  let committed = false;
  const assertActive = () => {
    if (committed || Date.now() > deadline) throw conflict();
  };
  const verify = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'analytics/' + scope}))`;
    const head = await tx.analyticsHead.findUnique({ where: { scope } });
    if ((head?.generationId ?? null) !== expected) throw conflict();
  };
  await prisma.$transaction(
    async (tx) => {
      await verify(tx);
      // Reclaim abandoned stages only after their maximum lifetime, never an active head.
      const abandoned = await tx.analyticsGeneration.findMany({
        where: {
          scope,
          createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          ...(expected ? { id: { not: expected } } : {}),
        },
        select: { id: true },
        take: 100,
      });
      if (abandoned.length) {
        const ids = abandoned.map((row) => row.id);
        await tx.analyticsProjection.deleteMany({ where: { generationId: { in: ids } } });
        await tx.analyticsGeneration.deleteMany({ where: { id: { in: ids } } });
      }
      await tx.analyticsGeneration.create({ data: { id, scope, checkpoints: [] } });
      if (expected && !rebuild)
        await tx.$executeRaw(Prisma.sql`
      INSERT INTO ${schema}."AnalyticsProjection" ("generationId",owner,"recordId",sequence,value)
      SELECT ${id}::uuid,owner,"recordId",sequence,value FROM ${schema}."AnalyticsProjection" WHERE "generationId"=${expected}::uuid
    `);
    },
    { timeout: 60000 },
  );
  return {
    async stage(owner, rows) {
      assertActive();
      if (!rows.length) return;
      if (rows.some((row) => row.owner !== owner)) throw new Error('Projection owner mismatch.');
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO ${schema}."AnalyticsProjection" AS existing ("generationId",owner,"recordId",sequence,value)
        SELECT ${id}::uuid,${owner},r."recordId",r.sequence,r.value
        FROM (SELECT DISTINCT ON ("recordId") "recordId",sequence,value
          FROM jsonb_to_recordset(${JSON.stringify(rows.map((row) => ({ recordId: row.recordId, sequence: row.sequence, value: row.value })))}::jsonb)
            AS input("recordId" text,sequence integer,value jsonb)
          ORDER BY "recordId",sequence DESC) r
        ON CONFLICT ("generationId",owner,"recordId") DO UPDATE SET sequence=EXCLUDED.sequence,value=EXCLUDED.value
        WHERE existing.sequence < EXCLUDED.sequence
      `);
    },
    async resetOwner(owner) {
      await prisma.$transaction(
        async (tx) => {
          await tx.analyticsProjection.deleteMany({ where: { generationId: id, owner } });
          if (expected && !rebuild)
            await tx.$executeRaw(Prisma.sql`
          INSERT INTO ${schema}."AnalyticsProjection" ("generationId",owner,"recordId",sequence,value)
          SELECT ${id}::uuid,owner,"recordId",sequence,value FROM ${schema}."AnalyticsProjection"
          WHERE "generationId"=${expected}::uuid AND owner=${owner}
        `);
        },
        { timeout: 60000 },
      );
    },
    async commit(checkpoints: readonly Checkpoint[]) {
      assertActive();
      await prisma.$transaction(
        async (tx) => {
          await verify(tx);
          await tx.analyticsGeneration.update({
            where: { id },
            data: { checkpoints: [...checkpoints] },
          });
          await tx.analyticsHead.upsert({
            where: { scope },
            create: { scope, generationId: id },
            update: { generationId: id },
          });
          // Delete only the replaced generation, never another refresh's private stage.
          if (expected) {
            await tx.analyticsProjection.deleteMany({ where: { generationId: expected } });
            await tx.analyticsGeneration.delete({ where: { id: expected } });
          }
        },
        { timeout: 60000 },
      );
      committed = true;
      return id;
    },
    async abort() {
      if (committed) return;
      await prisma.$transaction(
        async (tx) => {
          // Commit acknowledgement can be lost. Serialize with activation and
          // check the head before deleting even our own staging rows.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'analytics/' + scope}))`;
          const head = await tx.analyticsHead.findUnique({ where: { scope } });
          if (head?.generationId === id) {
            committed = true;
            return;
          }
          await tx.analyticsProjection.deleteMany({ where: { generationId: id } });
          await tx.analyticsGeneration.deleteMany({ where: { id } });
        },
        { timeout: 60000 },
      );
    },
  };
}
