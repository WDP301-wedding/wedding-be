import { describe, expect, it } from 'vitest';
import {
  conflict,
  deliveryInput,
  failureOutcome,
  forbidden,
  parse,
  preferencesInput,
  RETRY_MS,
} from './notification-policy.js';
describe('notification policy', () => {
  it('rejects authority and guessed recipient fields', () => {
    expect(() =>
      parse(preferencesInput, {
        expectedRevision: 0,
        reminderEmail: true,
        reminderPush: false,
        accountId: 'override',
      }),
    ).toThrow();
    expect(() => parse(deliveryInput, { expectedRevision: 0, phone: '+84912345678' })).toThrow();
    expect(
      parse(deliveryInput, { expectedRevision: 0, intendedEmail: 'guest@example.test' })
        .intendedEmail,
    ).toBe('guest@example.test');
    expect(conflict().status).toBe(409);
    expect(conflict('REPLAY').code).toBe('REPLAY');
    expect(forbidden().status).toBe(403);
  });
  it('treats ambiguous effects as unknown and bounds retries', () => {
    for (const code of [undefined, 'PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR'])
      expect(failureOutcome(code)).toBe('UNKNOWN');
    expect(failureOutcome('NOTIFICATION_RETRYABLE')).toBe('RETRYABLE_FAILED');
    expect(failureOutcome('NOTIFICATION_PERMANENT')).toBe('DEAD_LETTER');
    expect(RETRY_MS).toEqual([60000, 300000, 1800000, 7200000, 43200000]);
  });
});
