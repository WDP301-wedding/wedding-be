import { z } from 'zod';
import { mode } from '../domain/staff-policy.js';
import { staffInvitationSummarySchema } from '../../identity-access/staff-invitation/staff-invitation.schemas.js';
export const settingsSchema = z.strictObject({
  bookingId: z.uuid(),
  checkInMode: mode,
  revision: z.int().positive(),
  locked: z.boolean(),
});
export const assignmentSchema = z.strictObject({
  assignmentId: z.uuid(),
  bookingId: z.uuid(),
  staffAccountId: z.uuid(),
  staffLabel: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'REVOKED']),
  revision: z.int().positive(),
});
export const provisionSchema = z.strictObject({
  accountId: z.uuid(),
  credentialSetupRequired: z.boolean(),
  invitation: staffInvitationSummarySchema.optional(),
});
export const operationalSchema = z.strictObject({ accountId: z.uuid(), enabled: z.boolean() });
export const recordSchema = z.strictObject({
  checkInRecordId: z.uuid(),
  bookingId: z.uuid(),
  guestId: z.uuid(),
  action: z.enum(['CHECK_IN', 'UNDO']),
  ledgerRevision: z.int().positive(),
  originalCheckInRecordId: z.uuid().nullable(),
  guestGroupId: z.uuid(),
  groupNameSnapshot: z.string().min(1).max(80),
  groupColorSnapshot: z.string().regex(/^#[A-F0-9]{6}$/u),
  actorAccountId: z.uuid(),
  eventTime: z.iso.datetime(),
  recordedAt: z.iso.datetime(),
  reason: z.string().min(10).max(500).nullable(),
  overrideReason: z.string().min(10).max(500).nullable(),
});
export const historySchema = z.strictObject({
  items: z.array(recordSchema).max(50),
  nextAfterRevision: z.int().positive().nullable(),
});
export const searchSchema = z.strictObject({
  sourceSequence: z.int().nonnegative(),
  nextCursor: z.string().nullable(),
  guidanceStatus: z.enum(['ABSENT', 'DRAFT', 'CONFIRMED', 'REQUIRES_REVIEW']),
  seatingPlanRevisionId: z.uuid().nullable(),
  items: z
    .array(
      z.strictObject({
        guestId: z.uuid(),
        guestGroupId: z.uuid(),
        name: z.string().min(1).max(120),
        phoneLast4: z.string().max(4).nullable(),
        groupName: z.string().min(1).max(80),
        groupColor: z.string().regex(/^#[A-F0-9]{6}$/u),
        checkedIn: z.boolean(),
        checkInRecordId: z.uuid().nullable().optional(),
        ledgerRevision: z.int().nonnegative(),
        warning: z.literal('GUEST_GROUP_CHANGED').nullable(),
        tableLabels: z.array(z.string()),
      }),
    )
    .max(50),
});
