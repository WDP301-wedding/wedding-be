import { Router } from 'express';
import { createGeneralRateLimit } from '../../../core/http/rate-limit.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import { z } from 'zod';
import type { Redis } from 'ioredis';
import type { createStaffInvitationAcceptance } from './staff-invitation.service.js';
import {
  staffInvitationDetailsInput,
  staffInvitationAcceptInput,
  staffInvitationDetailsSchema,
  staffInvitationAcceptedSchema,
} from './staff-invitation.schemas.js';

export function createStaffInvitationRouter(
  service: ReturnType<typeof createStaffInvitationAcceptance>,
  redis?: Redis | null,
) {
  const router = Router();
  router.use(
    ['/auth/staff-invitation-details', '/auth/staff-invitation-acceptances'],
    (_req, res, next) => {
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      next();
    },
  );
  const limit = createGeneralRateLimit(
    { maxRequests: 10, windowMs: 15 * 60_000 },
    redis,
    'staff-invitation',
  );
  for (const [path, body, output, accept] of [
    [
      '/auth/staff-invitation-details',
      staffInvitationDetailsInput,
      staffInvitationDetailsSchema,
      false,
    ],
    [
      '/auth/staff-invitation-acceptances',
      staffInvitationAcceptInput,
      staffInvitationAcceptedSchema,
      true,
    ],
  ] as const) {
    router.post(
      path,
      limit,
      validateRequest({ body, query: z.strictObject({}) }),
      async (req, res) => {
        res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        const input = validatedRequest(res, { body }).body;
        const result = accept
          ? await service.accept(
              input.invitationToken,
              (input as z.infer<typeof staffInvitationAcceptInput>).password,
              req.requestId,
            )
          : await service.details(input.invitationToken);
        res.json(z.strictObject({ data: output }).parse({ data: result }));
      },
    );
  }
  return router;
}
