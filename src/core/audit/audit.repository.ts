import type { PrismaClient } from '../../generated/prisma/client.js';

import type { AuditLogRecord, NewAuditLogRecord } from './audit.types.js';

export interface AuditRepository {
  append(record: NewAuditLogRecord): Promise<AuditLogRecord>;
}

export function createPrismaAuditRepository(
  prisma: Pick<PrismaClient, 'auditLog'>,
): AuditRepository {
  return {
    async append(record) {
      const stored = await prisma.auditLog.create({ data: record });

      return { id: stored.id, ...record };
    },
  };
}
