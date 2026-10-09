import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { approvedTimelineSnapshotSchema } from './booking-readers.js';

const fixture = () => ({
  bookingId: randomUUID(),
  timelineRevisionId: randomUUID(),
  revisionNumber: 1,
  eventDate: '2026-10-15',
  hallName: 'Approved hall',
  shiftCode: 'LUNCH',
  shiftStartTime: '11:00',
  shiftEndTime: '14:00',
  items: [
    {
      itemId: randomUUID(),
      order: 0,
      startTime: '11:00',
      title: 'x'.repeat(120),
      description: 'x'.repeat(2000),
    },
    { itemId: randomUUID(), order: 1, startTime: '13:00', title: 'Second', description: null },
  ],
  approvedByManagerAt: '2026-10-08T00:00:00Z',
  approvedByCoupleAt: '2026-10-08T01:00:00Z',
  isEffective: true,
});

describe('approved owner timeline DTO conforms to SPEC-03 bounds/baseline21.2', () => {
  it('accepts exact 120-character title/2000-character description and ordered items at shift boundaries', () => {
    const input = fixture();
    input.items[1]!.startTime = '14:00';
    expect(approvedTimelineSnapshotSchema.parse(input)).toEqual(input);
  });
  it.each([
    'empty',
    'oversize-title',
    'oversize-description',
    'outside-start',
    'outside-end',
    'duplicate-id',
    'duplicate-order',
    'unordered',
    'reversed-shift',
    'unknown-field',
  ])('rejects %s approved snapshot', (defect) => {
    const input = fixture();
    switch (defect) {
      case 'empty':
        input.items = [];
        break;
      case 'oversize-title':
        input.items[0]!.title += 'x';
        break;
      case 'oversize-description':
        input.items[0]!.description += 'x';
        break;
      case 'outside-start':
        input.items[0]!.startTime = '10:59';
        break;
      case 'outside-end':
        input.items[1]!.startTime = '14:01';
        break;
      case 'duplicate-id':
        input.items[1]!.itemId = input.items[0]!.itemId;
        break;
      case 'duplicate-order':
        input.items[1]!.order = input.items[0]!.order;
        break;
      case 'unordered':
        input.items.reverse();
        break;
      case 'reversed-shift':
        input.shiftEndTime = '10:00';
        break;
      case 'unknown-field':
        Object.assign(input, { originalUrl: 'https://untrusted.example' });
        break;
    }
    expect(approvedTimelineSnapshotSchema.safeParse(input).success).toBe(false);
  });
});
