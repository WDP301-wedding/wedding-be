import type { AuditLogRecord, NewAuditLogRecord } from './audit.types.js';

export interface AuditRepository {
  append(record: NewAuditLogRecord): Promise<AuditLogRecord>;
}
