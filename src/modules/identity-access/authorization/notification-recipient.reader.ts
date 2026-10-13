import type { PrismaClient, Prisma } from '../../../generated/prisma/client.js';
export const NOTIFICATION_RECIPIENT_VERSION = 'identity-notification-recipient@1.0.0';
/** Minimal active destination. This adapter owns Identity's session/account facts. */
export function createNotificationRecipientReader(
  prisma: PrismaClient | Prisma.TransactionClient,
  now: () => Date = () => new Date(),
) {
  return {
    async email(accountId: string) {
      const row = await prisma.account.findFirst({
        where: {
          id: accountId,
          status: 'ACTIVE',
          roles: { some: { role: { in: ['COUPLE', 'MANAGER'] } } },
        },
        select: { emailNormalized: true },
      });
      return row?.emailNormalized ?? null;
    },
    async manager(accountId: string) {
      return (
        (await prisma.account.count({
          where: { id: accountId, status: 'ACTIVE', roles: { some: { role: 'MANAGER' } } },
        })) === 1
      );
    },
    async android(accountId: string, sessionId: string) {
      return (
        (await prisma.session.count({
          where: {
            id: sessionId,
            accountId,
            clientKind: 'ANDROID',
            status: 'ACTIVE',
            idleExpiresAt: { gt: now() },
            absoluteExpiresAt: { gt: now() },
            account: { status: 'ACTIVE', roles: { some: { role: { in: ['COUPLE', 'MANAGER'] } } } },
          },
        })) === 1
      );
    },
  };
}
