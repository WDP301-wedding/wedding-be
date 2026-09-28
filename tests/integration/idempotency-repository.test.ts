import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  createPrismaIdempotencyRepository,
  type NewIdempotencyClaim,
} from '../../src/core/idempotency/idempotency.repository.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const describeWithDatabase =
  databaseUrl === undefined || databaseUrl === '' ? describe.skip : describe;
const testDatabaseUrl = databaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';

describeWithDatabase('idempotency repository persistence', () => {
  const prisma = createPrismaClient(testDatabaseUrl);
  const repository = createPrismaIdempotencyRepository(prisma);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('selects exactly one winner in every repeated concurrent claim race', async () => {
    const runPrefix = `idempotency-concurrency-${randomUUID()}`;
    const lockedAt = new Date();
    const expiresAt = new Date(lockedAt.getTime() + 60_000);

    try {
      for (let round = 0; round < 20; round += 1) {
        const claim: NewIdempotencyClaim = {
          namespace: `${runPrefix}-${round}`,
          idempotencyKey: 'same-intent',
          requestHash: 'a'.repeat(64),
          lockedAt,
          expiresAt,
        };
        const results = await Promise.all(
          Array.from({ length: 12 }, () => repository.claim(claim)),
        );
        const winners = results.filter(({ outcome }) => outcome === 'CLAIMED');
        const recordIds = new Set(results.map(({ record }) => record.id));

        expect(winners).toHaveLength(1);
        expect(recordIds.size).toBe(1);
        await expect(
          prisma.idempotencyRecord.count({ where: { namespace: claim.namespace } }),
        ).resolves.toBe(1);
      }
    } finally {
      await prisma.idempotencyRecord.deleteMany({
        where: { namespace: { startsWith: runPrefix } },
      });
    }
  });

  it('allows exactly one terminal state transition and preserves retention timestamps', async () => {
    const namespace = `idempotency-transition-${randomUUID()}`;
    const lockedAt = new Date('2026-09-29T01:00:00.000Z');
    const expiresAt = new Date('2027-03-28T01:00:00.000Z');
    const claim = await repository.claim({
      namespace,
      idempotencyKey: 'payment-intent-1',
      requestHash: 'b'.repeat(64),
      lockedAt,
      expiresAt,
    });

    try {
      const resourceId = randomUUID();
      const transitions = await Promise.all([
        repository.transition({
          id: claim.record.id,
          status: 'SUCCEEDED',
          responseStatus: 201,
          responseBody: { data: { id: resourceId } },
          resourceType: 'payment',
          resourceId,
        }),
        repository.transition({
          id: claim.record.id,
          status: 'FAILED',
          responseStatus: 422,
          responseBody: { error: { code: 'PAYMENT_REJECTED' } },
          resourceType: null,
          resourceId: null,
        }),
      ]);
      const stored = await prisma.idempotencyRecord.findUniqueOrThrow({
        where: { id: claim.record.id },
      });

      expect(transitions.filter((record) => record !== null)).toHaveLength(1);
      expect(stored.status).toBe(transitions.find((record) => record !== null)?.status);
      expect(stored.lockedAt).toEqual(lockedAt);
      expect(stored.expiresAt).toEqual(expiresAt);
    } finally {
      await prisma.idempotencyRecord.deleteMany({ where: { namespace } });
    }
  });
});
