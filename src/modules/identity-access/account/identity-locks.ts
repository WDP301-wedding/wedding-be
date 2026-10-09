import { Prisma } from '../../../generated/prisma/client.js';

export function createIdentityLocks(schema = 'public') {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u.test(schema))
    throw new TypeError('Invalid identity database schema.');
  const account = Prisma.raw(`"${schema}"."Account"`);
  const session = Prisma.raw(`"${schema}"."Session"`);
  return {
    async account(tx: Prisma.TransactionClient, id: string) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM ${account} WHERE "id" = ${id}::uuid FOR UPDATE`,
      );
    },
    async session(tx: Prisma.TransactionClient, id: string) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM ${session} WHERE "id" = ${id}::uuid FOR UPDATE`,
      );
    },
  };
}
