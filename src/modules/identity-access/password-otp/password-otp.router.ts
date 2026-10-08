import { Router } from 'express';
import { createGeneralRateLimit } from '../../../core/http/rate-limit.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../authorization/authenticated-actor.middleware.js';
import type { PasswordOtpService } from './password-otp.service.js';
import {
  changeOtpRequestSchema,
  otpCompletionSchema,
  otpCompletionResponseSchema,
  otpRequestResponseSchema,
  resetOtpRequestSchema,
} from './password-otp.schemas.js';

export function createPasswordOtpRouter(
  service: PasswordOtpService,
  resolver: AuthenticatedActorResolver,
) {
  const router = Router();
  const authenticate = createAuthenticatedActorMiddleware(resolver);
  const limited = createGeneralRateLimit({ maxRequests: 30, windowMs: 15 * 60_000 });
  router.post(
    '/auth/password-otp-requests',
    limited,
    validateRequest({ body: resetOtpRequestSchema }),
    async (request, response) => {
      const { body } = validatedRequest(response, { body: resetOtpRequestSchema });
      const result = await service.request({
        ...body,
        clientIp: request.ip ?? request.socket.remoteAddress ?? '',
        requestId: request.requestId,
      });
      response
        .status(202)
        .set('Cache-Control', 'no-store')
        .json(otpRequestResponseSchema.parse({ data: result }));
    },
  );
  router.post(
    '/auth/password-otp-completions',
    limited,
    validateRequest({ body: otpCompletionSchema }),
    async (request, response) => {
      const { body } = validatedRequest(response, { body: otpCompletionSchema });
      const result = await service.complete({
        ...body,
        clientIp: request.ip ?? request.socket.remoteAddress ?? '',
        requestId: request.requestId,
      });
      response.clearCookie('__Host-wedding-refresh', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      });
      response
        .set('Cache-Control', 'no-store')
        .json(otpCompletionResponseSchema.parse({ data: result }));
    },
  );
  router.post(
    '/auth/password-change-otp-requests',
    limited,
    authenticate,
    validateRequest({ body: changeOtpRequestSchema }),
    async (request, response) => {
      const { body } = validatedRequest(response, { body: changeOtpRequestSchema });
      const result = await service.request({
        ...body,
        actor: response.locals.actor as AuthenticatedActor,
        clientIp: request.ip ?? request.socket.remoteAddress ?? '',
        requestId: request.requestId,
      });
      response
        .status(202)
        .set('Cache-Control', 'no-store')
        .json(otpRequestResponseSchema.parse({ data: result }));
    },
  );
  return router;
}
