import { z } from 'zod';

import type { AuditRepository } from './audit.repository.js';
import type { AuditLogRecord, AuditRequestContext } from './audit.types.js';

export interface AuditEventDefinition<TSchema extends z.ZodType = z.ZodType> {
  readonly action: string;
  readonly entityType: string;
  readonly metadataSchema: TSchema;
}

export interface RecordAuditInput<TMetadata> {
  readonly context: AuditRequestContext;
  readonly entityId?: string;
  readonly metadata: TMetadata;
}

export interface AuditService {
  record<TSchema extends z.ZodType>(
    event: AuditEventDefinition<TSchema>,
    input: RecordAuditInput<z.input<TSchema>>,
  ): Promise<AuditLogRecord>;
}

export class AuditMetadataValidationError extends Error {
  override readonly name = 'AuditMetadataValidationError';

  constructor() {
    super('Audit metadata did not match the event allowlist.');
  }
}

export class AuditAttributionValidationError extends Error {
  override readonly name = 'AuditAttributionValidationError';

  constructor() {
    super('Audit request, actor, or entity attribution is invalid.');
  }
}

const auditAttributionSchema = z.strictObject({
  requestId: z.uuid(),
  actor: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('SYSTEM') }),
    z.strictObject({ type: z.enum(['USER', 'GUEST_LINK']), id: z.uuid() }),
  ]),
  entityId: z.uuid().optional(),
});

const auditMetadataSchema = z.record(z.string(), z.json());

export function defineAuditEvent<
  const TAction extends string,
  const TEntityType extends string,
  const TShape extends z.ZodRawShape,
>(definition: {
  readonly action: TAction;
  readonly entityType: TEntityType;
  readonly metadata: TShape;
}): AuditEventDefinition<z.ZodObject<TShape>> {
  return {
    action: definition.action,
    entityType: definition.entityType,
    metadataSchema: z.strictObject(definition.metadata),
  };
}

export function createAuditService(
  repository: AuditRepository,
  now: () => Date = () => new Date(),
): AuditService {
  return {
    async record(event, input) {
      const attribution = auditAttributionSchema.safeParse({
        requestId: input.context.requestId,
        actor: input.context.actor,
        entityId: input.entityId,
      });

      if (!attribution.success) {
        throw new AuditAttributionValidationError();
      }

      const parsedMetadata = event.metadataSchema.safeParse(input.metadata);
      if (!parsedMetadata.success) {
        throw new AuditMetadataValidationError();
      }

      const jsonMetadata = auditMetadataSchema.safeParse(parsedMetadata.data);
      if (!jsonMetadata.success) {
        throw new AuditMetadataValidationError();
      }

      const { actor } = attribution.data;

      return repository.append({
        occurredAt: now(),
        requestId: attribution.data.requestId,
        actorType: actor.type,
        actorId: actor.type === 'SYSTEM' ? null : actor.id,
        action: event.action,
        entityType: event.entityType,
        entityId: attribution.data.entityId ?? null,
        metadata: jsonMetadata.data,
      });
    },
  };
}
