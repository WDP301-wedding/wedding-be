import type { WorkspaceInvitationIssuer } from '../../identity-access/workspace-invitation/workspace-invitation.service.js';
import type { BookingIdentityPort } from './consultation.service.js';

export function createBookingIdentityAdapter(
  invitations: WorkspaceInvitationIssuer,
): BookingIdentityPort {
  return Object.freeze({
    async issueRestrictedWorkspace(
      input: Parameters<BookingIdentityPort['issueRestrictedWorkspace']>[0],
    ) {
      const invitation = await invitations.issue({
        consultationId: input.consultationId,
        recipientEmail: input.recipientEmail,
        issuedByAccountId: input.issuedByAccountId,
        requestId: input.requestId,
      });
      return Object.freeze({ invitationId: invitation.invitationId });
    },
  });
}
