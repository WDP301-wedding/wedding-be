import type { PrismaClient } from '../../../generated/prisma/client.js';
import type {
  ContractContext,
  PrismaBookingBoundary,
} from '../../../core/database/booking-boundary.js';
import {
  AuthenticationRequiredError,
  type AuthenticatedActorResolver,
} from './authenticated-actor.middleware.js';

/** Session client kind is owner-resolved authority, never an HTTP client claim. */
export function createInvitationEditorReader(
  prisma: PrismaClient,
  boundary: PrismaBookingBoundary,
  resolver: AuthenticatedActorResolver,
) {
  return {
    async resolveContext(context: ContractContext) {
      if (context.actorAccountId === null) throw new AuthenticationRequiredError();
      const tx = boundary.enlist(context);
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${context.actorAccountId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT "accountId" FROM "AccountRole" WHERE "accountId"=${context.actorAccountId}::uuid ORDER BY role FOR SHARE`;
      const row = await tx.account.findUnique({
        where: { id: context.actorAccountId },
        include: { roles: true },
      });
      if (row === null || row.status !== 'ACTIVE') throw new AuthenticationRequiredError();
      return { accountId: row.id, roles: row.roles.map((role) => role.role) };
    },
    async resolve(accessToken: string, context?: ContractContext) {
      const actor = await resolver.resolve(accessToken);
      const tx = context === undefined ? prisma : boundary.enlist(context);
      const session = await tx.session.findUnique({
        where: { id: actor.sessionId },
        select: { clientKind: true, accountId: true },
      });
      if (session === null || session.accountId !== actor.accountId)
        throw new AuthenticationRequiredError();
      return { ...actor, clientKind: session.clientKind };
    },
  };
}
