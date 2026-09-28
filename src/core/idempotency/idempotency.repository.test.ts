import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

import {
  createPrismaIdempotencyRepository,
  type IdempotencyRecord,
  type NewIdempotencyClaim,
} from './idempotency.repository.js';

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('database error', {
    code,
    clientVersion: 'test',
  });
}

function storedRecord(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  const now = new Date('2026-09-29T01:00:00.000Z');

  return {
    id: randomUUID(),
    namespace: 'booking:create:v1',
    idempotencyKey: 'booking-intent-1',
    requestHash: 'a'.repeat(64),
    status: 'IN_PROGRESS',
    responseStatus: null,
    responseBody: null,
    resourceType: null,
    resourceId: null,
    lockedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function prismaWithDelegate(delegate: object): Pick<PrismaClient, 'idempotencyRecord'> {
  return { idempotencyRecord: delegate } as unknown as Pick<PrismaClient, 'idempotencyRecord'>;
}

describe('Prisma idempotency repository', () => {
  it('claims by inserting IN_PROGRESS once without a preceding read', async () => {
    const claim: NewIdempotencyClaim = {
      namespace: 'booking:create:v1',
      idempotencyKey: 'booking-intent-1',
      requestHash: 'a'.repeat(64),
      lockedAt: new Date('2026-09-29T01:00:00.000Z'),
      expiresAt: new Date('2026-10-29T01:00:00.000Z'),
    };
    const stored = storedRecord(claim);
    const create = vi.fn().mockResolvedValue(stored);
    const findUnique = vi.fn();
    const repository = createPrismaIdempotencyRepository(
      prismaWithDelegate({ create, findUnique, update: vi.fn() }),
    );

    await expect(repository.claim(claim)).resolves.toEqual({
      outcome: 'CLAIMED',
      record: stored,
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        ...claim,
        status: 'IN_PROGRESS',
        responseStatus: null,
        responseBody: Prisma.DbNull,
        resourceType: null,
        resourceId: null,
      },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('loads the winning row after the unique constraint rejects a duplicate claim', async () => {
    const claim: NewIdempotencyClaim = {
      namespace: 'booking:create:v1',
      idempotencyKey: 'booking-intent-1',
      requestHash: 'a'.repeat(64),
      lockedAt: new Date('2026-09-29T01:00:00.000Z'),
      expiresAt: new Date('2026-10-29T01:00:00.000Z'),
    };
    const winner = storedRecord(claim);
    const create = vi.fn().mockRejectedValue(knownRequestError('P2002'));
    const findUnique = vi.fn().mockResolvedValue(winner);
    const repository = createPrismaIdempotencyRepository(
      prismaWithDelegate({ create, findUnique, update: vi.fn() }),
    );

    await expect(repository.claim(claim)).resolves.toEqual({
      outcome: 'EXISTING',
      record: winner,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        namespace_idempotencyKey: {
          namespace: claim.namespace,
          idempotencyKey: claim.idempotencyKey,
        },
      },
    });
  });

  it.each([
    ['a non-unique database error', knownRequestError('P2003'), storedRecord()],
    ['a unique error without a matching row', knownRequestError('P2002'), null],
  ])('does not hide %s', async (_label, error, existing) => {
    const claim: NewIdempotencyClaim = {
      namespace: 'booking:create:v1',
      idempotencyKey: 'booking-intent-1',
      requestHash: 'a'.repeat(64),
      lockedAt: new Date('2026-09-29T01:00:00.000Z'),
      expiresAt: new Date('2026-10-29T01:00:00.000Z'),
    };
    const create = vi.fn().mockRejectedValue(error);
    const findUnique = vi.fn().mockResolvedValue(existing);
    const repository = createPrismaIdempotencyRepository(
      prismaWithDelegate({ create, findUnique, update: vi.fn() }),
    );

    await expect(repository.claim(claim)).rejects.toBe(error);
  });

  it('atomically transitions only an IN_PROGRESS row', async () => {
    const completed = storedRecord({
      status: 'SUCCEEDED',
      responseStatus: 201,
      responseBody: { data: { id: randomUUID() } },
    });
    const update = vi.fn().mockResolvedValue(completed);
    const repository = createPrismaIdempotencyRepository(
      prismaWithDelegate({ create: vi.fn(), findUnique: vi.fn(), update }),
    );

    await expect(
      repository.transition({
        id: completed.id,
        status: 'SUCCEEDED',
        responseStatus: 201,
        responseBody: completed.responseBody,
        resourceType: null,
        resourceId: null,
      }),
    ).resolves.toEqual(completed);
    expect(update).toHaveBeenCalledWith({
      where: { id: completed.id, status: 'IN_PROGRESS' },
      data: {
        status: 'SUCCEEDED',
        responseStatus: 201,
        responseBody: completed.responseBody,
        resourceType: null,
        resourceId: null,
      },
    });
  });

  it('returns null when a record is missing or already terminal', async () => {
    const update = vi.fn().mockRejectedValue(knownRequestError('P2025'));
    const repository = createPrismaIdempotencyRepository(
      prismaWithDelegate({ create: vi.fn(), findUnique: vi.fn(), update }),
    );

    await expect(
      repository.transition({
        id: randomUUID(),
        status: 'FAILED',
        responseStatus: 422,
        responseBody: { error: { code: 'BOOKING_REJECTED' } },
        resourceType: null,
        resourceId: null,
      }),
    ).resolves.toBeNull();
  });

  it('propagates unexpected transition errors', async () => {
    const error = knownRequestError('P2003');
    const update = vi.fn().mockRejectedValue(error);
    const repository = createPrismaIdempotencyRepository(
      prismaWithDelegate({ create: vi.fn(), findUnique: vi.fn(), update }),
    );

    await expect(
      repository.transition({
        id: randomUUID(),
        status: 'FAILED',
        responseStatus: 422,
        responseBody: null,
        resourceType: null,
        resourceId: null,
      }),
    ).rejects.toBe(error);
  });
});
