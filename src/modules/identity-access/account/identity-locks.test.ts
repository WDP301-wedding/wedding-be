import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../../generated/prisma/client.js';
import { createIdentityLocks } from './identity-locks.js';

describe('identity transaction locks', () => {
  it.each(['', 'public; DROP TABLE "Account"', 'bad"schema', '9schema', 'a'.repeat(64)])(
    'rejects unsafe schema %j before constructing a query',
    (schema) => {
      expect(() => createIdentityLocks(schema)).toThrow('Invalid identity database schema.');
    },
  );

  it.each([undefined, 'tenant_2'])(
    'locks the account and session in schema %s with parameterized IDs',
    async (schema) => {
      const queryRaw = vi.fn<(query: Prisma.Sql) => Promise<unknown>>().mockResolvedValue([]);
      const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;
      const locks = createIdentityLocks(schema);
      const id = '00000000-0000-4000-8000-000000000001';

      await locks.account(tx, id);
      await locks.session(tx, id);

      expect(queryRaw).toHaveBeenCalledTimes(2);
      for (const [index, table] of ['Account', 'Session'].entries()) {
        const query = queryRaw.mock.calls[index]![0];
        expect(query.text).toBe(
          `SELECT "id" FROM "${schema ?? 'public'}"."${table}" WHERE "id" = $1::uuid FOR UPDATE`,
        );
        expect(query.values).toEqual([id]);
      }
    },
  );
});
