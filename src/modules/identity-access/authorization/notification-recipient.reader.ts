import { z } from 'zod';
import type { PrismaClient } from '../../../generated/prisma/client.js';

/** Identity owns current contact/role/session eligibility; consumers get minimal facts. */
export function createNotificationIdentityReader(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
) {
  return {
    async account(accountId: string) {
      const row = await prisma.account.findUnique({
        where: { id: z.uuid().parse(accountId) },
        select: { id: true, status: true, displayEmail: true, roles: { select: { role: true } } },
      });
      if (!row || row.status !== 'ACTIVE') return null;
      return { accountId: row.id, email: row.displayEmail, roles: row.roles.map((r) => r.role) };
    },
    async androidSession(accountId: string, sessionId: string) {
      const row = await prisma.session.findUnique({
        where: { id: z.uuid().parse(sessionId) },
        select: {
          accountId: true,
          clientKind: true,
          status: true,
          idleExpiresAt: true,
          absoluteExpiresAt: true,
          account: { select: { status: true } },
        },
      });
      return Boolean(
        row &&
        row.accountId === accountId &&
        row.clientKind === 'ANDROID' &&
        row.status === 'ACTIVE' &&
        row.account.status === 'ACTIVE' &&
        row.idleExpiresAt > now() &&
        row.absoluteExpiresAt > now(),
      );
    },
  };
}
