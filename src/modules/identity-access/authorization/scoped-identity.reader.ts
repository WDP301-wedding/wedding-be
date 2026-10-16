import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import type { AccessCredentialState } from '../session/session.repository.js';
import { createAuthenticatedActorResolver } from './authenticated-actor.middleware.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from './authorization.service.js';
import { identityTable, readAccessCredential } from './access-credential.reader.js';

/** Identity-owned adapter: current authority is locked until the owner's shared
 * transaction commits. Outside a scope it is only a preflight read. Lock order is
 * Account -> role -> Session -> credential, matching disable/revocation writers. */
export function createScopedIdentityReaders(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
  now: () => Date = () => new Date(),
) {
  const resolver = createAuthenticatedActorResolver(
    {
      async findActorByAccessTokenHash(tokenHash): Promise<AccessCredentialState | null> {
        const tx = boundary.current();
        const db = tx ?? prisma;
        let locked: { sessionId: string; accountId: string } | undefined;
        if (tx !== undefined) {
          const [reference] = await tx.$queryRaw<
            { id: string; sessionId: string; accountId: string }[]
          >(Prisma.sql`
            SELECT c.id, c."sessionId", s."accountId"
            FROM ${identityTable(prisma, 'AccessCredential')} c
            JOIN ${identityTable(prisma, 'Session')} s ON s.id=c."sessionId"
            WHERE c."tokenHash"=${tokenHash}
          `);
          if (!reference) return null;
          locked = { sessionId: reference.sessionId, accountId: reference.accountId };
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM ${identityTable(prisma, 'Account')} WHERE id=${reference.accountId}::uuid FOR SHARE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM ${identityTable(prisma, 'AccountRole')} WHERE "accountId"=${reference.accountId}::uuid ORDER BY id FOR SHARE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM ${identityTable(prisma, 'Session')} WHERE id=${reference.sessionId}::uuid FOR SHARE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM ${identityTable(prisma, 'AccessCredential')} WHERE id=${reference.id}::uuid FOR SHARE`,
          );
        }
        // Re-read after row locks: a revocation that won the lock is observed here.
        const credential = await readAccessCredential(db, prisma, tokenHash);
        if (credential === null) return null;
        // A reparented token/session cannot authenticate against rows we did not lock.
        if (
          locked !== undefined &&
          (locked.sessionId !== credential.sessionId || locked.accountId !== credential.accountId)
        )
          return null;
        return credential;
      },
    },
    now,
  );
  const access = {
    async requireAccess(input: {
      accountId: string;
      consultationId: string;
      minimum: 'RESTRICTED' | 'FULL';
    }) {
      const tx = boundary.current();
      if (tx !== undefined)
        await tx.$queryRaw`SELECT id FROM "ConsultationAccess" WHERE "accountId"=${input.accountId}::uuid AND "consultationId"=${input.consultationId}::uuid FOR SHARE`;
      return createConsultationAccessReader(
        createPrismaConsultationAccessRepository(tx ?? prisma),
      ).requireAccess(input);
    },
  };
  return { resolver, access };
}
