import type { Prisma } from '../../../generated/prisma/client.js';
import { hashOpaqueToken } from '../crypto/token.js';
import {
  AuthenticationRequiredError,
  type AuthenticatedActor,
} from './authenticated-actor.middleware.js';
import { AppError } from '../../../core/errors/app-error.js';

/** Identity-owned lock/revalidation gate for the notification transaction. */
export async function lockNotificationActor(
  tx: Prisma.TransactionClient,
  token: string,
  expected: AuthenticatedActor,
  now: Date,
) {
  const tokenHash = hashOpaqueToken(token, 'access');
  const reference = await tx.accessCredential.findUnique({
    where: { tokenHash },
    select: { id: true },
  });
  if (!reference) throw new AuthenticationRequiredError();
  await tx.$queryRaw`SELECT id FROM "Account" WHERE id=${expected.accountId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "AccountRole" WHERE "accountId"=${expected.accountId}::uuid ORDER BY id FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${expected.sessionId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "AccessCredential" WHERE id=${reference.id}::uuid FOR SHARE`;
  const credential = await tx.accessCredential.findUnique({
    where: { tokenHash },
    include: { session: { include: { account: { include: { roles: true } } } } },
  });
  if (
    !credential ||
    credential.status !== 'ACTIVE' ||
    credential.expiresAt <= now ||
    credential.session.id !== expected.sessionId ||
    credential.session.accountId !== expected.accountId ||
    credential.session.status !== 'ACTIVE' ||
    credential.session.idleExpiresAt <= now ||
    credential.session.absoluteExpiresAt <= now ||
    credential.session.account.status !== 'ACTIVE'
  )
    throw new AuthenticationRequiredError();
  return {
    accountId: credential.session.accountId,
    sessionId: credential.session.id,
    roles: credential.session.account.roles.map((r) => r.role),
    clientKind: credential.session.clientKind,
  };
}
export async function requireNotificationRole(
  tx: Prisma.TransactionClient,
  actor: { accountId: string; roles: readonly string[] },
  manager = false,
) {
  if (actor.roles.includes('MANAGER')) return;
  if (!manager && actor.roles.includes('COUPLE')) return;
  if (
    !manager &&
    actor.roles.length === 0 &&
    (await tx.consultationAccess.findFirst({
      where: { accountId: actor.accountId },
      select: { id: true },
    }))
  )
    return;
  throw new AppError({
    status: 403,
    code: 'FORBIDDEN',
    message: 'The current account cannot use this notification scope.',
  });
}
