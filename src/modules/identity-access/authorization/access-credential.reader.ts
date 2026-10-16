import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { prismaSchema } from '../../../core/database/prisma.js';
import type { AccessCredentialState } from '../session/session.repository.js';

/** Schema comes from the constructed client, never request input. Quoting also
 * supports schema-isolated migration tests without falling back to public. */
export function identityTable(
  prisma: PrismaClient,
  table: 'Account' | 'AccountRole' | 'Session' | 'AccessCredential',
): Prisma.Sql {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return Prisma.raw(`${quote(prismaSchema(prisma))}.${quote(table)}`);
}

export async function readAccessCredential(
  db: PrismaClient | Prisma.TransactionClient,
  owner: PrismaClient,
  tokenHash: string,
): Promise<AccessCredentialState | null> {
  const rows = await db.$queryRaw<AccessCredentialState[]>(Prisma.sql`
    SELECT s."accountId", s.id AS "sessionId", a."displayEmail",
      c.status AS "credentialStatus", c."expiresAt" AS "credentialExpiresAt",
      s.status AS "sessionStatus", s."idleExpiresAt", s."absoluteExpiresAt",
      a.status AS "accountStatus",
      ARRAY(SELECT r.role::text FROM ${identityTable(owner, 'AccountRole')} r
        WHERE r."accountId" = a.id ORDER BY r.id) AS roles
    FROM ${identityTable(owner, 'AccessCredential')} c
    JOIN ${identityTable(owner, 'Session')} s ON s.id = c."sessionId"
    JOIN ${identityTable(owner, 'Account')} a ON a.id = s."accountId"
    WHERE c."tokenHash" = ${tokenHash}
  `);
  const state = rows[0];
  return state ? Object.freeze({ ...state, roles: Object.freeze(state.roles) }) : null;
}
