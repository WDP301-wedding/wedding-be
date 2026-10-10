import { describe, expect, it } from 'vitest';
import { createConsultationBodySchema } from '../http/booking-lifecycle.schemas.js';
import { coupleNameSchema } from './couple-profile.js';

describe('couple profile names', () => {
  it('normalizes NFC before validating length and retains legacy labels without inference', () => {
    expect(coupleNameSchema.parse('  A\u0301nh  ')).toBe('Ánh');
    expect(coupleNameSchema.parse('A\u0301'.repeat(120))).toHaveLength(120);
    const input = { intendedEmail: 'test@example.com', displayName: 'An và Minh' };
    expect(createConsultationBodySchema.parse(input)).toEqual(input);
  });
  it('rejects empty/oversized names and unknown authority fields', () => {
    for (const name of [' ', 'a'.repeat(121)])
      expect(coupleNameSchema.safeParse(name).success).toBe(false);
    expect(
      createConsultationBodySchema.safeParse({
        intendedEmail: 'test@example.com',
        displayName: 'label',
        approved: true,
      }).success,
    ).toBe(false);
  });
});
