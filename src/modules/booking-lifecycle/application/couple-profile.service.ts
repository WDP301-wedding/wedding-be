import { z } from 'zod';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient, type Consultation } from '../../../generated/prisma/client.js';
import { prismaSchema } from '../../../core/database/prisma.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { coupleNameSchema, coupleProfileFields } from '../domain/couple-profile.js';

export const profileWriteSchema = z
  .strictObject({
    expectedRevision: z.int().positive(),
    ...coupleProfileFields,
  })
  .refine((input) => input.brideName !== undefined || input.groomName !== undefined);
export const coupleProfileResponseSchema = z.strictObject({
  data: z.strictObject({
    consultationId: z.uuid(),
    displayName: z.string(),
    revision: z.int().positive(),
    brideName: coupleNameSchema.nullable(),
    groomName: coupleNameSchema.nullable(),
  }),
});

export function createCoupleProfileService(prisma: PrismaClient) {
  const schema = Prisma.raw(`"${prismaSchema(prisma).replaceAll('"', '""')}"`);
  async function authorized(
    tx: Prisma.TransactionClient,
    consultationId: string,
    actor: AuthenticatedActor,
  ) {
    const row = await tx.consultation.findUnique({ where: { id: consultationId } });
    if (row === null) throw new NotFoundError();
    const manager = actor.roles.includes('MANAGER') && row.managerAccountId === actor.accountId;
    if (!manager) {
      const grant = await tx.consultationAccess.findUnique({
        where: {
          accountId_consultationId: { accountId: actor.accountId, consultationId },
        },
      });
      if (grant === null || (actor.roles.includes('STAFF') && !actor.roles.includes('COUPLE')))
        throw new NotFoundError();
    }
    return row;
  }
  type ProfileRow = Pick<
    Consultation,
    'id' | 'displayName' | 'revision' | 'brideName' | 'groomName'
  >;
  const view = (row: ProfileRow) =>
    Object.freeze({
      consultationId: row.id,
      displayName: row.displayName,
      revision: row.revision,
      brideName: row.brideName,
      groomName: row.groomName,
    });
  return Object.freeze({
    async read(id: string, actor: AuthenticatedActor) {
      // One statement reads the profile and its access grant consistently, without
      // interactive transaction admission's separate two-second default timeout.
      const [row] = await prisma.$queryRaw<ProfileRow[]>(Prisma.sql`
        SELECT c.id, c."displayName", c.revision, c."brideName", c."groomName"
        FROM ${schema}."Consultation" c
        WHERE c.id=${id}::uuid AND (
          (${actor.roles.includes('MANAGER')} AND c."managerAccountId"=${actor.accountId}::uuid)
          OR (${!actor.roles.includes('STAFF') || actor.roles.includes('COUPLE')} AND EXISTS (
            SELECT 1 FROM ${schema}."ConsultationAccess" a
            WHERE a."consultationId"=c.id AND a."accountId"=${actor.accountId}::uuid
          ))
        )
      `);
      if (row === undefined) throw new NotFoundError();
      return view(row);
    },
    update: (id: string, value: unknown, actor: AuthenticatedActor, requestId: string) => {
      const input = profileWriteSchema.parse(value);
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Consultation" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const prior = await authorized(tx, id, actor);
        if (prior.revision !== input.expectedRevision)
          throw new AppError({
            status: 409,
            code: 'STALE_CONSULTATION_REVISION',
            message: 'The consultation changed after it was loaded.',
          });
        const names = {
          ...(input.brideName === undefined ? {} : { brideName: input.brideName }),
          ...(input.groomName === undefined ? {} : { groomName: input.groomName }),
        };
        const row = await tx.consultation.update({
          where: { id },
          data: { ...names, revision: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            requestId,
            actorType: 'USER',
            actorId: actor.accountId,
            action: 'booking.couple-profile-updated',
            entityType: 'consultation',
            entityId: id,
            metadata: {
              predecessorRevision: prior.revision,
              revision: row.revision,
              changedFields: Object.keys(names),
            },
          },
        });
        return view(row);
      });
    },
  });
}
