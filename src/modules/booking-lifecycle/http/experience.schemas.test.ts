import { afterEach, describe, expect, it, vi } from 'vitest';
import { consultationRequestBodySchema, intakeRecordSchema } from './experience.schemas.js';
import {
  profileWriteSchema,
  passwordChangeSchema,
} from '../../identity-access/account/settings.schemas.js';

describe('post-booking external boundaries', () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ['2026-10-08T16:59:59Z', '2026-10-10'],
    ['2026-10-08T17:00:00Z', '2026-10-11'],
    ['2026-12-30T17:00:00Z', '2027-01-02'],
    ['2028-02-27T17:00:00Z', '2028-03-01'],
  ])('requires the day after tomorrow in Vietnam at %s', (now, minimumDate) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    const request = {
      submissionId: 'a23e9870-4a25-4f96-8c69-67e426a581c7',
      displayName: 'Lan',
      email: 'lan@example.com',
      phone: '',
      preferredDate: minimumDate,
      expectedGuests: null,
      message: '',
    };
    expect(consultationRequestBodySchema.safeParse(request).success).toBe(true);
    const tomorrow = new Date(`${minimumDate}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() - 1);
    for (const preferredDate of [tomorrow.toISOString().slice(0, 10), '2020-01-01']) {
      const result = consultationRequestBodySchema.safeParse({ ...request, preferredDate });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.path).toEqual(['preferredDate']);
    }
    expect(
      consultationRequestBodySchema.safeParse({ ...request, preferredDate: null }).success,
    ).toBe(true);
  });

  it('keeps historical intake dates readable', () => {
    expect(
      intakeRecordSchema.safeParse({
        id: 'a23e9870-4a25-4f96-8c69-67e426a581c7',
        displayName: 'Lan',
        email: 'lan@example.com',
        phone: '',
        preferredDate: '2020-01-01',
        expectedGuests: null,
        message: '',
        status: 'NEW',
        consultationId: null,
        consultationRevision: null,
        createdAt: '2020-01-01T00:00:00Z',
        brideName: null,
        groomName: null,
      }).success,
    ).toBe(true);
  });

  it('accepts bounded intake without silently creating booking/account authority', () => {
    const request = {
      submissionId: 'a23e9870-4a25-4f96-8c69-67e426a581c7',
      displayName: 'Lan',
      email: 'lan@example.com',
      phone: '',
      preferredDate: null,
      expectedGuests: null,
      message: '',
    };
    expect(consultationRequestBodySchema.safeParse(request).success).toBe(true);
    expect(consultationRequestBodySchema.safeParse({ ...request, role: 'MANAGER' }).success).toBe(
      false,
    );
    expect(
      consultationRequestBodySchema.safeParse({ ...request, expectedGuests: -1 }).success,
    ).toBe(false);
    expect(
      consultationRequestBodySchema.safeParse({ ...request, preferredDate: '2026-02-30' }).success,
    ).toBe(false);
  });
  it('rejects identity changes outside the authenticated name/password commands', () => {
    expect(
      profileWriteSchema.safeParse({ displayName: '  Lan  ', expectedRevision: 1 }).data
        ?.displayName,
    ).toBe('Lan');
    expect(
      profileWriteSchema.safeParse({ displayName: 'Lan', expectedRevision: 1, roles: ['MANAGER'] })
        .success,
    ).toBe(false);
    expect(
      passwordChangeSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success,
    ).toBe(false);
    expect(
      passwordChangeSchema.safeParse({
        currentPassword: 'old',
        newPassword: 'new-password-123',
        accountId: 'another',
      }).success,
    ).toBe(false);
  });
});
