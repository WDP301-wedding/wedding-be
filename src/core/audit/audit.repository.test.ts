import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '../../generated/prisma/client.js';

import { createPrismaAuditRepository } from './audit.repository.js';
import type { NewAuditLogRecord } from './audit.types.js';

describe('Prisma audit repository', () => {
  it('exposes only append and passes the complete immutable record to Prisma create', async () => {
    const record: NewAuditLogRecord = {
      occurredAt: new Date('2026-09-28T10:00:00.000Z'),
      requestId: randomUUID(),
      actorType: 'USER',
      actorId: randomUUID(),
      action: 'booking.status.changed',
      entityType: 'booking',
      entityId: randomUUID(),
      metadata: { fromStatus: 'DRAFT', toStatus: 'CONFIRMED' },
    };
    const id = randomUUID();
    let persisted: NewAuditLogRecord | undefined;
    const prisma = {
      auditLog: {
        create: ({ data }: { data: NewAuditLogRecord }) => {
          persisted = data;
          return Promise.resolve({ id });
        },
      },
    } as unknown as Pick<PrismaClient, 'auditLog'>;
    const repository = createPrismaAuditRepository(prisma);

    const result = await repository.append(record);

    expect(Object.keys(repository)).toEqual(['append']);
    expect(persisted).toEqual(record);
    expect(result).toEqual({ id, ...record });
  });
});
