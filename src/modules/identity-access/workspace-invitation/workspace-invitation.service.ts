import { normalizeEmail } from '../account/account.service.js';
import { issueOpaqueToken } from '../crypto/token.js';
import type { IdentityNotificationPort } from '../identity-notification.port.js';
import type { WorkspaceInvitationRepository } from './workspace-invitation.repository.js';

export interface WorkspaceInvitationIssuer {
  issue(input: InvitationIssueInput): Promise<IssuedWorkspaceInvitation>;
  reissue(input: InvitationIssueInput): Promise<IssuedWorkspaceInvitation>;
  revoke(input: InvitationRevokeInput): Promise<Readonly<{ revoked: boolean }>>;
}

export type InvitationIssueInput = Readonly<{
  consultationId: string;
  recipientEmail: string;
  issuedByAccountId: string;
  requestId: string;
}>;

export type InvitationRevokeInput = Readonly<{
  invitationId: string;
  actorAccountId: string;
  requestId: string;
}>;

export type IssuedWorkspaceInvitation = Readonly<{
  invitationId: string;
  invitationToken: string;
  sequence: number;
  expiresAt: Date;
}>;

export function createWorkspaceInvitationService(
  options: Readonly<{
    repository: WorkspaceInvitationRepository;
    notificationPort: IdentityNotificationPort;
    tokenEntropyBytes: number;
    lifetimeSeconds: number;
    reissueLimit: number;
    reissueWindowSeconds: number;
    now?: () => Date;
  }>,
): WorkspaceInvitationIssuer {
  const now = options.now ?? (() => new Date());

  async function persistAndNotify(
    operation: 'issue' | 'reissue',
    input: InvitationIssueInput,
  ): Promise<IssuedWorkspaceInvitation> {
    const createdAt = now();
    const email = normalizeEmail(input.recipientEmail);
    const token = issueOpaqueToken('invitation', options.tokenEntropyBytes);
    const expiresAt = addSeconds(createdAt, options.lifetimeSeconds);
    const stored = await options.repository[operation]({
      consultationId: input.consultationId,
      recipientEmailNormalized: email.normalized,
      issuedByAccountId: input.issuedByAccountId,
      tokenHash: token.tokenHash,
      expiresAt,
      now: createdAt,
      requestId: input.requestId,
      reissueLimit: options.reissueLimit,
      reissueWindowSeconds: options.reissueWindowSeconds,
    });
    await options.notificationPort.sendWorkspaceInvitation({
      invitationId: stored.invitationId,
      recipientEmail: email.display,
      invitationToken: token.token,
    });
    return Object.freeze({
      invitationId: stored.invitationId,
      invitationToken: token.token,
      sequence: stored.sequence,
      expiresAt,
    });
  }

  return Object.freeze({
    issue(input: InvitationIssueInput) {
      return persistAndNotify('issue', input);
    },
    reissue(input: InvitationIssueInput) {
      return persistAndNotify('reissue', input);
    },
    async revoke(input: InvitationRevokeInput) {
      return Object.freeze({
        revoked: await options.repository.revoke({ ...input, now: now() }),
      });
    },
  });
}

function addSeconds(date: Date, seconds: number): Date {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isFinite(date.getTime())) {
    throw new RangeError('Invalid invitation lifetime.');
  }
  return new Date(date.getTime() + seconds * 1_000);
}
