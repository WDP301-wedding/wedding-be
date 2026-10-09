import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import type { AccessCredentialState } from '../session/session.repository.js';
import { createAuthenticatedActorResolver } from './authenticated-actor.middleware.js';
import {
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
} from './authorization.service.js';

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
          const reference = await tx.accessCredential.findUnique({
            where: { tokenHash },
            select: { id: true, session: { select: { id: true, accountId: true } } },
          });
          if (reference === null) return null;
          locked = { sessionId: reference.session.id, accountId: reference.session.accountId };
          await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${reference.session.accountId}::uuid FOR SHARE`;
          await tx.$queryRaw`SELECT id FROM "AccountRole" WHERE "accountId"=${reference.session.accountId}::uuid ORDER BY id FOR SHARE`;
          await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${reference.session.id}::uuid FOR SHARE`;
          await tx.$queryRaw`SELECT id FROM "AccessCredential" WHERE id=${reference.id}::uuid FOR SHARE`;
        }
        // Re-read after row locks: a revocation that won the lock is observed here.
        const credential = await db.accessCredential.findUnique({
          where: { tokenHash },
          include: { session: { include: { account: { include: { roles: true } } } } },
        });
        if (credential === null) return null;
        const { session } = credential;
        // A reparented token/session cannot authenticate against rows we did not lock.
        if (
          locked !== undefined &&
          (locked.sessionId !== session.id || locked.accountId !== session.accountId)
        )
          return null;
        return {
          accountId: session.accountId,
          sessionId: session.id,
          displayEmail: session.account.displayEmail,
          credentialStatus: credential.status,
          credentialExpiresAt: credential.expiresAt,
          sessionStatus: session.status,
          idleExpiresAt: session.idleExpiresAt,
          absoluteExpiresAt: session.absoluteExpiresAt,
          accountStatus: session.account.status,
          roles: session.account.roles.map(({ role }) => role),
        };
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
