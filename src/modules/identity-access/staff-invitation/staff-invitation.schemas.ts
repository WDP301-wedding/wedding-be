import { z } from 'zod';

export const staffInvitationToken = z.string().regex(/^wis_[A-Za-z0-9_-]{43}$/u);
export const staffInvitationDetailsInput = z.strictObject({
  invitationToken: staffInvitationToken,
});
export const staffInvitationAcceptInput = staffInvitationDetailsInput.extend({
  password: z.string().min(1).max(128),
});
export const staffInvitationDetailsSchema = z.strictObject({
  maskedEmail: z.string(),
  hasExistingPassword: z.boolean(),
  expiresAt: z.iso.datetime(),
});
export const staffInvitationAcceptedSchema = z.strictObject({
  accepted: z.literal(true),
  email: z.email(),
  requiresLogin: z.literal(true),
});
export const staffInvitationSummarySchema = z.strictObject({
  invitationId: z.uuid(),
  status: z.enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED']),
  deliveryStatus: z.enum(['UNKNOWN', 'ACCEPTED', 'FAILED']),
  expiresAt: z.iso.datetime(),
});
