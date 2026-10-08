type EventContext = Readonly<{ requestId: string; causationId?: string | null }>;

export function bookingEventMetadata(context: EventContext) {
  return {
    eventVersion: 1,
    correlationId: context.requestId,
    causationId: context.causationId ?? null,
  } as const;
}

export function bookingEventEnvelope<T>(
  row: Readonly<{
    id: string;
    eventType: string;
    eventVersion: number;
    aggregateId: string;
    occurredAt: Date;
    correlationId: string;
    causationId: string | null;
    payload: T;
  }>,
) {
  return Object.freeze({
    eventId: row.id,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    occurredAt: row.occurredAt.toISOString(),
    producerModule: 'booking-lifecycle',
    aggregateType: 'booking',
    aggregateId: row.aggregateId,
    correlationId: row.correlationId,
    causationId: row.causationId,
    payload: row.payload,
  });
}
