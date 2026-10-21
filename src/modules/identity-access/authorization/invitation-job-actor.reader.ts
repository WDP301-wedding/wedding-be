import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { PrismaBookingBoundary } from '../../../core/database/booking-boundary.js';
import { AuthenticationRequiredError } from './authenticated-actor.middleware.js';
import { identityTable } from './access-credential.reader.js';

/** Internal durable-job authority. Session IDs are loaded from server-owned rows,
 * never accepted as authentication from an HTTP payload. No bearer is retained. */
export function createInvitationJobActorReader(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
  now: () => Date,
) {
  return async (accountId: string, sessionId: string) => {
    const tx = boundary.current();
    if (tx) {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${identityTable(prisma, 'Account')} WHERE id=${accountId}::uuid FOR SHARE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${identityTable(prisma, 'AccountRole')} WHERE "accountId"=${accountId}::uuid ORDER BY id FOR SHARE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM ${identityTable(prisma, 'Session')} WHERE id=${sessionId}::uuid FOR SHARE`,
      );
    }
    const session = await (tx ?? prisma).session.findUnique({
      where: { id: sessionId },
      include: { account: { include: { roles: true } } },
    });
    if (
      !session ||
      session.accountId !== accountId ||
      session.status !== 'ACTIVE' ||
      session.account.status !== 'ACTIVE' ||
      session.idleExpiresAt <= now() ||
      session.absoluteExpiresAt <= now()
    )
      throw new AuthenticationRequiredError();
    return { accountId, roles: session.account.roles.map((r) => r.role) };
  };
}
