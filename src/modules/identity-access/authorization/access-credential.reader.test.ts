import { describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '../../../core/database/prisma.js';
import { readAccessCredential } from './access-credential.reader.js';

describe('Identity joined credential reader', () => {
  it('quotes the configured schema and binds credential hashes as parameters', async () => {
    const client = createPrismaClient(
      'postgresql://unused@localhost/unused?schema=isolated%22test',
    );
    const query = vi.spyOn(client, '$queryRaw').mockResolvedValue([]);
    try {
      expect(await readAccessCredential(client, client, 'private-credential-hash')).toBeNull();
      const statement = query.mock.calls[0]![0] as { sql: string; values: unknown[] };
      expect(statement.sql).toContain('"isolated""test"."AccessCredential"');
      expect(statement.sql).not.toContain('private-credential-hash');
      expect(statement.values).toEqual(['private-credential-hash']);
    } finally {
      await client.$disconnect();
    }
  });
});
