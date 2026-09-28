import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createPrismaAuditRepository } from '../../src/core/audit/audit.repository.js';
import {
  AuditMetadataValidationError,
  createAuditService,
  defineAuditEvent,
} from '../../src/core/audit/audit.service.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const describeWithDatabase =
  databaseUrl === undefined || databaseUrl === '' ? describe.skip : describe;
const testDatabaseUrl = databaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';

const bookingStatusChanged = defineAuditEvent({
  action: 'booking.status.changed',
  entityType: 'booking',
  metadata: {
    fromStatus: z.enum(['DRAFT', 'CONFIRMED']),
    toStatus: z.enum(['DRAFT', 'CONFIRMED']),
    reasonCode: z.string().optional(),
  },
});

describeWithDatabase('audit persistence', () => {
  const prisma = createPrismaClient(testDatabaseUrl);
  const repository = createPrismaAuditRepository(prisma);
  const service = createAuditService(repository);

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists attributed append-only records with only allowlisted metadata', async () => {
    const requestId = randomUUID();
    const actorId = randomUUID();
    const entityId = randomUUID();

    try {
      const result = await service.record(bookingStatusChanged, {
        context: { requestId, actor: { type: 'USER', id: actorId } },
        entityId,
        metadata: {
          fromStatus: 'DRAFT',
          toStatus: 'CONFIRMED',
          reasonCode: 'timeline-approved',
        },
      });
      const stored = await prisma.auditLog.findUnique({ where: { id: result.id } });

      expect(stored).toMatchObject({
        id: result.id,
        occurredAt: result.occurredAt,
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
      expect(Object.keys((stored?.metadata ?? {}) as object).sort()).toEqual([
        'fromStatus',
        'reasonCode',
        'toStatus',
      ]);
    } finally {
      await prisma.auditLog.deleteMany({ where: { requestId } });
    }
  });

  it('rejects secret and PII fields without writing a row', async () => {
    const requestId = randomUUID();
    const metadata = {
      fromStatus: 'DRAFT',
      toStatus: 'CONFIRMED',
      password: 'must-not-be-persisted',
      email: 'couple@example.com',
    } as {
      fromStatus: 'DRAFT';
      toStatus: 'CONFIRMED';
    };

    await expect(
      service.record(bookingStatusChanged, {
        context: { requestId, actor: { type: 'SYSTEM' } },
        metadata,
      }),
    ).rejects.toBeInstanceOf(AuditMetadataValidationError);
    await expect(prisma.auditLog.count({ where: { requestId } })).resolves.toBe(0);
  });
});
