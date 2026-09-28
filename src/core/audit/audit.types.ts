export type AuditActorType = 'SYSTEM' | 'USER' | 'GUEST_LINK';

export type AuditActor =
  Readonly<{ type: 'SYSTEM' }> | Readonly<{ type: 'USER' | 'GUEST_LINK'; id: string }>;

export interface AuditRequestContext {
  readonly requestId: string;
  readonly actor: AuditActor;
}

export type AuditMetadataValue =
  | boolean
  | number
  | string
  | null
  | readonly AuditMetadataValue[]
  | Readonly<{ [key: string]: AuditMetadataValue }>;

export type AuditMetadata = Readonly<Record<string, AuditMetadataValue>>;

export interface NewAuditLogRecord {
  readonly occurredAt: Date;
  readonly requestId: string;
  readonly actorType: AuditActorType;
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly metadata: AuditMetadata;
}

export interface AuditLogRecord extends NewAuditLogRecord {
  readonly id: string;
}
