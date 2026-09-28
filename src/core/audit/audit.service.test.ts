import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { AuditLogRecord, NewAuditLogRecord } from './audit.types.js';
import type { AuditRepository } from './audit.repository.js';
import {
  AuditMetadataValidationError,
  createAuditService,
  defineAuditEvent,
} from './audit.service.js';

class InMemoryAuditRepository implements AuditRepository {
  readonly records: AuditLogRecord[] = [];

  append(record: NewAuditLogRecord): Promise<AuditLogRecord> {
    const stored = { id: randomUUID(), ...record };
    this.records.push(stored);
    return Promise.resolve(stored);
  }
}

const bookingStatusChanged = defineAuditEvent({
  action: 'booking.status.changed',
  entityType: 'booking',
  metadata: {
    fromStatus: z.enum(['DRAFT', 'CONFIRMED']),
    toStatus: z.enum(['DRAFT', 'CONFIRMED']),
    reasonCode: z.string().optional(),
  },
});

describe('audit service', () => {
  it('appends actor, action, entity, request context, timestamp, and allowlisted metadata', async () => {
    const repository = new InMemoryAuditRepository();
    const occurredAt = new Date('2026-09-28T10:00:00.000Z');
    const service = createAuditService(repository, () => occurredAt);
    const requestId = randomUUID();
    const actorId = randomUUID();
    const entityId = randomUUID();

    const result = await service.record(bookingStatusChanged, {
      context: { requestId, actor: { type: 'USER', id: actorId } },
      entityId,
      metadata: {
        fromStatus: 'DRAFT',
        toStatus: 'CONFIRMED',
        reasonCode: 'timeline-approved',
      },
    });

    expect(z.uuid().safeParse(result.id).success).toBe(true);
    expect(result).toEqual({
      id: result.id,
      occurredAt,
      requestId,
      actorType: 'USER',
      actorId,
      action: 'booking.status.changed',
      entityType: 'booking',
      entityId,
      metadata: {
        fromStatus: 'DRAFT',
        toStatus: 'CONFIRMED',
        reasonCode: 'timeline-approved',
      },
    });
    expect(repository.records).toEqual([result]);
  });

  it('records system activity without inventing an actor or entity ID', async () => {
    const repository = new InMemoryAuditRepository();
    const occurredAt = new Date('2026-09-28T10:00:00.000Z');
    const service = createAuditService(repository, () => occurredAt);

    const result = await service.record(bookingStatusChanged, {
      context: { requestId: randomUUID(), actor: { type: 'SYSTEM' } },
      metadata: { fromStatus: 'DRAFT', toStatus: 'CONFIRMED' },
    });

    expect(result.actorType).toBe('SYSTEM');
    expect(result.actorId).toBeNull();
    expect(result.entityId).toBeNull();
  });

  it.each([
    ['password', 'must-not-be-persisted'],
    ['email', 'couple@example.com'],
    ['refreshToken', 'must-not-be-persisted'],
  ])('rejects non-allowlisted %s metadata before persistence', async (field, value) => {
    const repository = new InMemoryAuditRepository();
    const service = createAuditService(repository);
    const metadata = {
      fromStatus: 'DRAFT',
      toStatus: 'CONFIRMED',
      [field]: value,
    } as {
      fromStatus: 'DRAFT';
      toStatus: 'CONFIRMED';
    };

    await expect(
      service.record(bookingStatusChanged, {
        context: { requestId: randomUUID(), actor: { type: 'SYSTEM' } },
        metadata,
      }),
    ).rejects.toBeInstanceOf(AuditMetadataValidationError);
    expect(repository.records).toEqual([]);
  });

  it('rejects invalid allowlisted metadata before persistence', async () => {
    const repository = new InMemoryAuditRepository();
    const service = createAuditService(repository);

    await expect(
      service.record(bookingStatusChanged, {
        context: { requestId: randomUUID(), actor: { type: 'SYSTEM' } },
        metadata: {
          fromStatus: 'DRAFT',
          toStatus: 'CANCELLED' as 'CONFIRMED',
        },
      }),
    ).rejects.toBeInstanceOf(AuditMetadataValidationError);
    expect(repository.records).toEqual([]);
  });
});

type Assert<T extends true> = T;
type IsEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

type AuditRepositoryIsAppendOnly = Assert<IsEqual<keyof AuditRepository, 'append'>>;
const auditRepositoryIsAppendOnly: AuditRepositoryIsAppendOnly = true;
void auditRepositoryIsAppendOnly;
