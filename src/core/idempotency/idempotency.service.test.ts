import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  IdempotencyRecord,
  IdempotencyRepository,
  NewIdempotencyClaim,
  RepositoryClaimResult,
  TransitionIdempotencyRecord,
} from './idempotency.repository.js';
import {
  createIdempotencyService,
  DEFAULT_IDEMPOTENCY_RETENTION_MS,
  IdempotencyInputError,
  IdempotencyTransitionError,
  PAYMENT_IDEMPOTENCY_RETENTION_MS,
} from './idempotency.service.js';

class InMemoryIdempotencyRepository implements IdempotencyRepository {
  readonly records = new Map<string, IdempotencyRecord>();

  claim(claim: NewIdempotencyClaim): Promise<RepositoryClaimResult> {
    const key = `${claim.namespace}\u0000${claim.idempotencyKey}`;
    const existing = this.records.get(key);

    if (existing !== undefined) {
      return Promise.resolve({ outcome: 'EXISTING', record: existing });
    }

    const record: IdempotencyRecord = {
      id: randomUUID(),
      ...claim,
      status: 'IN_PROGRESS',
      responseStatus: null,
      responseBody: null,
      resourceType: null,
      resourceId: null,
      createdAt: claim.lockedAt,
      updatedAt: claim.lockedAt,
    };
    this.records.set(key, record);

    return Promise.resolve({ outcome: 'CLAIMED', record });
  }

  transition(input: TransitionIdempotencyRecord): Promise<IdempotencyRecord | null> {
    const entry = [...this.records.entries()].find(([, record]) => record.id === input.id);
    const record = entry?.[1];

    if (entry === undefined || record?.status !== 'IN_PROGRESS') {
      return Promise.resolve(null);
    }

    const transitioned: IdempotencyRecord = {
      ...record,
      status: input.status,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      updatedAt: new Date(record.updatedAt.getTime() + 1),
    };
    this.records.set(entry[0], transitioned);

    return Promise.resolve(transitioned);
  }
}

describe('idempotency service', () => {
  it('claims a new intent as IN_PROGRESS with the default retention window', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const lockedAt = new Date('2026-09-29T01:00:00.000Z');
    const service = createIdempotencyService(repository, () => lockedAt);

    const result = await service.claim({
      namespace: 'user:user-1:POST:/api/v1/bookings:v1',
      idempotencyKey: 'booking-intent-1',
      payload: { hallId: 'hall-1', guestCount: 120 },
    });

    expect(result).toMatchObject({
      outcome: 'CLAIMED',
      record: {
        namespace: 'user:user-1:POST:/api/v1/bookings:v1',
        idempotencyKey: 'booking-intent-1',
        requestHash: '7345392fe5bcdc045f62e116b8f5a67d8f3afaaabc06df19892a207e496f1e2b',
        status: 'IN_PROGRESS',
        lockedAt,
        expiresAt: new Date(lockedAt.getTime() + DEFAULT_IDEMPOTENCY_RETENTION_MS),
      },
    });
  });

  it('returns IN_PROGRESS when the same key and canonical payload are already claimed', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const service = createIdempotencyService(repository);
    const input = {
      namespace: 'user:user-1:POST:/api/v1/bookings:v1',
      idempotencyKey: 'booking-intent-1',
      payload: { hallId: 'hall-1', guestCount: 120 },
    };

    const first = await service.claim(input);
    const duplicate = await service.claim({
      ...input,
      payload: { guestCount: 120, hallId: 'hall-1' },
    });

    expect(first.outcome).toBe('CLAIMED');
    expect(duplicate).toEqual({ outcome: 'IN_PROGRESS', record: first.record });
    expect(repository.records).toHaveLength(1);
  });

  it('returns MISMATCH when a key is reused for a different payload', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const service = createIdempotencyService(repository);
    const input = {
      namespace: 'user:user-1:POST:/api/v1/bookings:v1',
      idempotencyKey: 'booking-intent-1',
    };

    const first = await service.claim({ ...input, payload: { guestCount: 120 } });
    const mismatch = await service.claim({ ...input, payload: { guestCount: 121 } });

    expect(mismatch).toEqual({ outcome: 'MISMATCH', record: first.record });
    expect(repository.records).toHaveLength(1);
  });

  it.each(['SUCCEEDED', 'FAILED'] as const)(
    'returns a stored %s outcome for a completed duplicate',
    async (status) => {
      const repository = new InMemoryIdempotencyRepository();
      const service = createIdempotencyService(repository);
      const input = {
        namespace: 'user:user-1:POST:/api/v1/bookings:v1',
        idempotencyKey: `booking-intent-${status}`,
        payload: { guestCount: 120 },
      };
      const first = await service.claim(input);

      const completed =
        status === 'SUCCEEDED'
          ? await service.markSucceeded({
              claimId: first.record.id,
              responseStatus: 201,
              responseBody: { data: { id: randomUUID() } },
            })
          : await service.markFailed({
              claimId: first.record.id,
              responseStatus: 422,
              responseBody: { error: { code: 'BOOKING_REJECTED' } },
            });

      await expect(service.claim(input)).resolves.toEqual({ outcome: status, record: completed });
    },
  );

  it('supports the minimum payment retention window explicitly', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const lockedAt = new Date('2026-09-29T01:00:00.000Z');
    const service = createIdempotencyService(repository, () => lockedAt);

    const result = await service.claim({
      namespace: 'user:user-1:POST:/api/v1/payments:v1',
      idempotencyKey: 'payment-intent-1',
      payload: { amountMinor: 5_000_000 },
      retentionMs: PAYMENT_IDEMPOTENCY_RETENTION_MS,
    });

    expect(result.record.expiresAt).toEqual(
      new Date(lockedAt.getTime() + PAYMENT_IDEMPOTENCY_RETENTION_MS),
    );
  });

  it.each([
    ['an empty key', ''],
    ['a control character', 'intent\n1'],
    ['a non-ASCII character', 'ý-định-1'],
    ['more than 128 characters', 'a'.repeat(129)],
  ])('rejects %s before persistence', async (_label, idempotencyKey) => {
    const repository = new InMemoryIdempotencyRepository();
    const service = createIdempotencyService(repository);

    await expect(
      service.claim({ namespace: 'booking:create:v1', idempotencyKey, payload: {} }),
    ).rejects.toBeInstanceOf(IdempotencyInputError);
    expect(repository.records).toHaveLength(0);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    'rejects an invalid retention duration of %s',
    async (retentionMs) => {
      const repository = new InMemoryIdempotencyRepository();
      const service = createIdempotencyService(repository);

      await expect(
        service.claim({
          namespace: 'booking:create:v1',
          idempotencyKey: 'booking-intent-1',
          payload: {},
          retentionMs,
        }),
      ).rejects.toBeInstanceOf(IdempotencyInputError);
      expect(repository.records).toHaveLength(0);
    },
  );

  it('persists a successful result and canonical resource reference', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const service = createIdempotencyService(repository);
    const claim = await service.claim({
      namespace: 'booking:create:v1',
      idempotencyKey: 'booking-intent-1',
      payload: {},
    });
    const resourceId = randomUUID();

    const result = await service.markSucceeded({
      claimId: claim.record.id,
      responseStatus: 201,
      responseBody: { data: { id: resourceId } },
      resource: { type: 'booking', id: resourceId },
    });

    expect(result).toMatchObject({
      id: claim.record.id,
      status: 'SUCCEEDED',
      responseStatus: 201,
      responseBody: { data: { id: resourceId } },
      resourceType: 'booking',
      resourceId,
    });
  });

  it('persists a deterministic failure without inventing a resource reference', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const service = createIdempotencyService(repository);
    const claim = await service.claim({
      namespace: 'booking:create:v1',
      idempotencyKey: 'booking-intent-1',
      payload: {},
    });

    const result = await service.markFailed({
      claimId: claim.record.id,
      responseStatus: 422,
      responseBody: { error: { code: 'BOOKING_REJECTED' } },
    });

    expect(result).toMatchObject({
      status: 'FAILED',
      responseStatus: 422,
      responseBody: { error: { code: 'BOOKING_REJECTED' } },
      resourceType: null,
      resourceId: null,
    });
  });

  it('rejects a second terminal transition so completed records are immutable', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const service = createIdempotencyService(repository);
    const claim = await service.claim({
      namespace: 'booking:create:v1',
      idempotencyKey: 'booking-intent-1',
      payload: {},
    });
    await service.markSucceeded({
      claimId: claim.record.id,
      responseStatus: 201,
      responseBody: { data: { id: randomUUID() } },
    });

    await expect(
      service.markFailed({
        claimId: claim.record.id,
        responseStatus: 500,
        responseBody: { error: { code: 'UNEXPECTED_ERROR' } },
      }),
    ).rejects.toBeInstanceOf(IdempotencyTransitionError);
  });

  it('rejects invalid terminal response data before persistence', async () => {
    const repository = new InMemoryIdempotencyRepository();
    const service = createIdempotencyService(repository);
    const claim = await service.claim({
      namespace: 'booking:create:v1',
      idempotencyKey: 'booking-intent-1',
      payload: {},
    });

    await expect(
      service.markSucceeded({
        claimId: claim.record.id,
        responseStatus: 700,
        responseBody: { data: undefined } as never,
      }),
    ).rejects.toBeInstanceOf(IdempotencyInputError);
    expect(repository.records.values().next().value).toMatchObject({ status: 'IN_PROGRESS' });
  });
});
