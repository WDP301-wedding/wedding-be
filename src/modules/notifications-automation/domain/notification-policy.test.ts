import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { intentInput, retryAt } from './notification-policy.js';

describe('notification foundation boundaries', () => {
  it('accepts only references, rejecting credentials and provider content', () => {
    const input = {
      eventId: randomUUID(),
      owner: 'booking-lifecycle',
      bookingId: randomUUID(),
      recipientId: randomUUID(),
      channel: 'EMAIL',
      purpose: 'CONTRACT',
      templateVersion: 1,
      scheduledAt: '2026-10-12T00:00:00.000Z',
      data: { referenceId: randomUUID(), revision: 2 },
    };
    expect(intentInput.parse(input)).toEqual(input);
    for (const field of ['credential', 'email', 'phone', 'providerBody']) {
      expect(
        intentInput.safeParse({ ...input, data: { ...input.data, [field]: 'private' } }).success,
      ).toBe(false);
    }
    expect(intentInput.safeParse({ ...input, authority: 'SYSTEM' }).success).toBe(false);
    expect(intentInput.safeParse({ ...input, templateVersion: 0 }).success).toBe(false);
  });
  it('bounds retries and never invents another attempt after the retry budget', () => {
    const start = new Date('2026-10-12T00:00:00Z');
    expect([1, 2, 3, 4, 5, 6].map((n) => retryAt(start, n)?.getTime() ?? null)).toEqual([
      start.getTime() + 60_000,
      start.getTime() + 300_000,
      start.getTime() + 1_800_000,
      start.getTime() + 7_200_000,
      start.getTime() + 43_200_000,
      null,
    ]);
    expect(() => retryAt(start, 0)).toThrow();
  });
});
