import { z } from 'zod';
import { publicInvitationSchema } from '../../invitation-studio/domain/public-invitation.js';
import { id } from '../domain/guest-policy.js';
export const bookingParams = z.strictObject({ bookingId: id });
export const groupParams = bookingParams.extend({ groupId: id });
export const guestParams = bookingParams.extend({ guestId: id });
export const groupSchema = z.strictObject({
  guestGroupId: z.uuid(),
  bookingId: z.uuid(),
  name: z.string().min(1).max(80),
  color: z.string().regex(/^#[A-F0-9]{6}$/u),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  revision: z.int().positive(),
});
export const guestSchema = z.strictObject({
  guestId: z.uuid(),
  bookingId: z.uuid(),
  guestGroupId: z.uuid(),
  name: z.string().min(1).max(120),
  phone: z.string().nullable(),
  operationalNote: z.string().max(500).nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  revision: z.int().positive(),
});
export const planSchema = z.strictObject({
  bookingId: z.uuid(),
  sourceGuestPlanRevisionId: z.uuid(),
  sourceSequence: z.int().nonnegative(),
  planningHeadcount: z.int().min(0).max(10000),
  revision: z.int().positive(),
});
export const previewSchema = z.strictObject({
  previewId: z.uuid(),
  digest: z.string().length(64),
  listSequence: z.int().positive(),
  createdCount: z.int().nonnegative(),
  updatedCount: z.int().nonnegative(),
  unchangedCount: z.int().nonnegative(),
  expiresAt: z.iso.datetime(),
});
export const importResultSchema = z.strictObject({
  createdCount: z.int().nonnegative(),
  updatedCount: z.int().nonnegative(),
  unchangedCount: z.int().nonnegative(),
});
export const privateListSchema = z.strictObject({
  items: z.array(guestSchema).max(50),
  sourceSequence: z.int().positive(),
  nextCursor: z.string().nullable(),
});
export const issuedLinkSchema = z.strictObject({
  credentialId: z.uuid(),
  revision: z.int().positive(),
  credential: z.string().regex(/^wgc_[A-Za-z0-9_-]{43}$/u),
  fragment: z.string(),
  expiresAt: z.iso.datetime(),
});
export const exchangeBodySchema = z.strictObject({ credential: z.string().min(1).max(256) });
export const sessionSchema = z.strictObject({
  capability: z.string().regex(/^wgs_[A-Za-z0-9_-]{43}$/u),
  expiresAt: z.iso.datetime(),
});
export const invitationViewSchema = z.strictObject({
  recipientGreeting: z.string().min(1).max(120),
  invitation: publicInvitationSchema,
});
export const responseSchema = <T extends z.ZodType>(schema: T) => z.strictObject({ data: schema });
