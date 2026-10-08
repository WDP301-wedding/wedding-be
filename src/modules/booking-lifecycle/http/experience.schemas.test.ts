import { describe, expect, it } from 'vitest';
import { consultationRequestBodySchema } from './experience.schemas.js';
import {
  profileWriteSchema,
  passwordChangeSchema,
} from '../../identity-access/account/settings.schemas.js';

describe('post-booking external boundaries', () => {
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
