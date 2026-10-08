import { describe, expect, it } from 'vitest';
import { bookingEventEnvelope, bookingEventMetadata } from './booking-event.js';

describe('booking integration event envelope', () => {
  it('persists a command correlation and optional upstream cause', () => {
    expect(bookingEventMetadata({ requestId: 'request' })).toEqual({
      eventVersion: 1,
      correlationId: 'request',
      causationId: null,
    });
    expect(bookingEventMetadata({ requestId: 'request', causationId: 'cause' })).toEqual({
      eventVersion: 1,
      correlationId: 'request',
      causationId: 'cause',
    });
  });
  it('reconstructs the frozen producer envelope without changing durable delivery identity', () => {
    const row = {
      id: 'event',
      eventType: 'booking.completed',
      eventVersion: 1,
      aggregateId: 'booking',
      occurredAt: new Date('2026-10-08T00:00:00Z'),
      correlationId: 'request',
      causationId: null,
      payload: { bookingId: 'booking' },
    };
    const envelope = bookingEventEnvelope(row);
    expect(envelope).toEqual({
      eventId: 'event',
      eventType: 'booking.completed',
      eventVersion: 1,
      aggregateId: 'booking',
      occurredAt: '2026-10-08T00:00:00.000Z',
      producerModule: 'booking-lifecycle',
      aggregateType: 'booking',
      correlationId: 'request',
      causationId: null,
      payload: row.payload,
    });
    expect(bookingEventEnvelope(row)).toEqual(envelope);
    expect(Object.isFrozen(envelope)).toBe(true);
  });
});
