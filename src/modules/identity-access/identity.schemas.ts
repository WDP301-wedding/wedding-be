import { z } from 'zod';

import { strictWriteSchema } from '../../core/http/validate.js';

export const identityLoginBodySchema = strictWriteSchema({
  email: z.email().max(320),
  password: z.string().min(1).max(512),
});

export const emptyWriteBodySchema = strictWriteSchema({});

export const androidRefreshBodySchema = strictWriteSchema({
  refreshToken: z.string().regex(/^wir_[A-Za-z0-9_-]{43}$/u),
});

export const sessionIdParamsSchema = z.strictObject({ sessionId: z.uuid() });

export const sessionInventoryQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
});

export const passwordResetRequestBodySchema = strictWriteSchema({
  email: z.email().max(320),
});

export const passwordResetCompletionBodySchema = strictWriteSchema({
  resetToken: z.string().regex(/^wip_[A-Za-z0-9_-]{43}$/u),
  newPassword: z.string().min(1).max(128),
});

export const invitationAcceptanceBodySchema = strictWriteSchema({
  invitationToken: z.string().regex(/^wii_[A-Za-z0-9_-]{43}$/u),
  password: z.string().min(1).max(128),
});

export const passwordResetRequestResponseSchema = z.strictObject({
  data: z.strictObject({ accepted: z.literal(true) }),
});

export const passwordResetCompletionResponseSchema = z.strictObject({
  data: z.strictObject({ completed: z.literal(true) }),
});

export const accountSummarySchema = z.strictObject({
  accountId: z.uuid(),
  displayEmail: z.email(),
  roles: z.array(z.enum(['MANAGER', 'STAFF', 'COUPLE'])),
});

export const issuedSessionResponseSchema = z.strictObject({
  data: z.strictObject({
    account: accountSummarySchema,
    sessionId: z.uuid(),
    clientKind: z.enum(['WEB', 'ANDROID']),
    accessToken: z.string().regex(/^wia_[A-Za-z0-9_-]{43}$/u),
    accessExpiresAt: z.iso.datetime(),
    refreshToken: z
      .string()
      .regex(/^wir_[A-Za-z0-9_-]{43}$/u)
      .optional(),
    refreshExpiresAt: z.iso.datetime(),
    absoluteExpiresAt: z.iso.datetime(),
  }),
});

export const refreshedSessionResponseSchema = z.strictObject({
  data: z.strictObject({
    sessionId: z.uuid(),
    clientKind: z.enum(['WEB', 'ANDROID']),
    accessToken: z.string().regex(/^wia_[A-Za-z0-9_-]{43}$/u),
    accessExpiresAt: z.iso.datetime(),
    refreshToken: z
      .string()
      .regex(/^wir_[A-Za-z0-9_-]{43}$/u)
      .optional(),
    refreshExpiresAt: z.iso.datetime(),
  }),
});

export const currentUserResponseSchema = z.strictObject({
  data: z.strictObject({
    accountId: z.uuid(),
    sessionId: z.uuid(),
    displayEmail: z.email(),
    roles: z.array(z.enum(['MANAGER', 'STAFF', 'COUPLE'])),
  }),
});

export const sessionSummarySchema = z.strictObject({
  sessionId: z.uuid(),
  clientKind: z.enum(['WEB', 'ANDROID']),
  status: z.enum(['ACTIVE', 'REVOKED', 'EXPIRED', 'COMPROMISED']),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  idleExpiresAt: z.iso.datetime(),
  absoluteExpiresAt: z.iso.datetime(),
});

export const sessionInventoryResponseSchema = z.strictObject({
  data: z.strictObject({
    sessions: z.array(sessionSummarySchema),
    nextCursor: z.uuid().nullable(),
  }),
});
