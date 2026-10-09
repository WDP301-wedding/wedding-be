/* eslint-disable @typescript-eslint/unbound-method -- Vitest intentionally inspects method spies. */
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceInvitationIssuer } from '../../identity-access/workspace-invitation/workspace-invitation.service.js';
import { createBookingIdentityAdapter } from './booking-identity.adapter.js';

describe('BookingIdentityAdapter', () => {
  it('issues a restricted workspace through the identity provider', async () => {
    const issuer = {
      issue: vi.fn().mockResolvedValue({
        invitationId: '00000000-0000-4000-8000-000000000001',
        invitationToken: 'secret-token',
        sequence: 1,
        expiresAt: new Date('2026-10-08T00:00:00.000Z'),
      }),
    } as unknown as WorkspaceInvitationIssuer;

    await expect(
      createBookingIdentityAdapter(issuer).issueRestrictedWorkspace({
        invitationIntentId: '00000000-0000-4000-8000-000000000002',
        consultationId: '00000000-0000-4000-8000-000000000003',
        recipientEmail: 'couple@example.com',
        issuedByAccountId: '00000000-0000-4000-8000-000000000004',
        requestId: '00000000-0000-4000-8000-000000000005',
      }),
    ).resolves.toEqual({ invitationId: '00000000-0000-4000-8000-000000000001' });

    expect(issuer.issue).toHaveBeenCalledWith({
      invitationIntentId: '00000000-0000-4000-8000-000000000002',
      consultationId: '00000000-0000-4000-8000-000000000003',
      recipientEmail: 'couple@example.com',
      issuedByAccountId: '00000000-0000-4000-8000-000000000004',
      requestId: '00000000-0000-4000-8000-000000000005',
    });
  });

  it('keeps provider failures observable so the durable intent can be retried', async () => {
    const failure = new Error('provider unavailable');
    const issuer = {
      issue: vi.fn().mockRejectedValue(failure),
    } as unknown as WorkspaceInvitationIssuer;

    await expect(
      createBookingIdentityAdapter(issuer).issueRestrictedWorkspace({
        invitationIntentId: '00000000-0000-4000-8000-000000000002',
        consultationId: '00000000-0000-4000-8000-000000000003',
        recipientEmail: 'couple@example.com',
        issuedByAccountId: '00000000-0000-4000-8000-000000000004',
        requestId: '00000000-0000-4000-8000-000000000005',
      }),
    ).rejects.toBe(failure);
  });
});
