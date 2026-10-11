import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import {
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../../core/errors/app-error.js';
import {
  groupWriteSchema,
  groupPatchSchema,
  guestWriteSchema,
  guestPatchSchema,
  planWriteSchema,
  importPreviewSchema,
  importCommitSchema,
  linkIssueSchema,
  unavailable,
} from '../domain/guest-policy.js';
import { listQuerySchema } from '../application/guest-readers.js';
import type { createGuestServices } from '../infrastructure/guest.composition.js';
import {
  bookingParams,
  groupParams,
  guestParams,
  groupSchema,
  guestSchema,
  planSchema,
  previewSchema,
  importResultSchema,
  privateListSchema,
  issuedLinkSchema,
  exchangeBodySchema,
  sessionSchema,
  invitationViewSchema,
  responseSchema,
} from './guest.schemas.js';

export function createGuestRouter(services: ReturnType<typeof createGuestServices>) {
  const router = Router(),
    authenticate = createAuthenticatedActorMiddleware(services.identity.resolver);
  router.use((request, response, next) => {
    if (
      /^\/bookings\/[^/]+\/(guest-groups|guests|guest-plan)(\/|$)/u.test(request.path) ||
      request.path.startsWith('/guest/')
    )
      response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  const context = (request: Request, response: Response) => ({
    actorId: (response.locals.actor as AuthenticatedActor).accountId,
    requestId: request.requestId,
    accessToken: request.get('authorization')!.slice(7),
  });
  const key = (request: Request) => {
    const raw = request.get('idempotency-key');
    if (raw === undefined) throw new IdempotencyKeyRequiredError();
    const result = idempotencyKeySchema.safeParse(raw);
    if (!result.success) throw new InvalidIdempotencyKeyError();
    return result.data;
  };
  const groups = '/bookings/:bookingId/guest-groups',
    guests = '/bookings/:bookingId/guests',
    plan = '/bookings/:bookingId/guest-plan';
  router.get(groups, authenticate, validateRequest({ params: bookingParams }), async (req, res) => {
    const { params } = validatedRequest(res, { params: bookingParams });
    res.json(
      responseSchema(z.array(groupSchema)).parse({
        data: await services.guests.groups(params.bookingId, context(req, res)),
      }),
    );
  });
  router.post(
    groups,
    authenticate,
    validateRequest({ params: bookingParams, body: groupWriteSchema }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: bookingParams,
        body: groupWriteSchema,
      });
      res.status(201).json(
        responseSchema(groupSchema).parse({
          data: await services.guests.createGroup(
            params.bookingId,
            body,
            key(req),
            context(req, res),
          ),
        }),
      );
    },
  );
  router.patch(
    `${groups}/:groupId`,
    authenticate,
    validateRequest({ params: groupParams, body: groupPatchSchema }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: groupParams,
        body: groupPatchSchema,
      });
      res.json(
        responseSchema(groupSchema).parse({
          data: await services.guests.updateGroup(
            params.bookingId,
            params.groupId,
            body,
            key(req),
            context(req, res),
          ),
        }),
      );
    },
  );
  router.get(
    guests,
    authenticate,
    validateRequest({ params: bookingParams, query: listQuerySchema }),
    async (req, res) => {
      const { params, query } = validatedRequest(res, {
        params: bookingParams,
        query: listQuerySchema,
      });
      res.json(
        responseSchema(privateListSchema).parse({
          data: await services.readers.list(params.bookingId, query, context(req, res)),
        }),
      );
    },
  );
  router.post(
    guests,
    authenticate,
    validateRequest({ params: bookingParams, body: guestWriteSchema }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: bookingParams,
        body: guestWriteSchema,
      });
      res.status(201).json(
        responseSchema(guestSchema).parse({
          data: await services.guests.createGuest(
            params.bookingId,
            body,
            key(req),
            context(req, res),
          ),
        }),
      );
    },
  );
  router.patch(
    `${guests}/:guestId`,
    authenticate,
    validateRequest({ params: guestParams, body: guestPatchSchema }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: guestParams,
        body: guestPatchSchema,
      });
      res.json(
        responseSchema(guestSchema).parse({
          data: await services.guests.updateGuest(
            params.bookingId,
            params.guestId,
            body,
            key(req),
            context(req, res),
          ),
        }),
      );
    },
  );
  router.post(
    `${guests}/import-previews`,
    authenticate,
    validateRequest({ params: bookingParams, body: importPreviewSchema }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: bookingParams,
        body: importPreviewSchema,
      });
      res.json(
        responseSchema(previewSchema).parse({
          data: await services.guests.preview(params.bookingId, body, key(req), context(req, res)),
        }),
      );
    },
  );
  router.post(
    `${guests}/imports`,
    authenticate,
    validateRequest({ params: bookingParams, body: importCommitSchema }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: bookingParams,
        body: importCommitSchema,
      });
      res.json(
        responseSchema(importResultSchema).parse({
          data: await services.guests.import(params.bookingId, body, key(req), context(req, res)),
        }),
      );
    },
  );
  router.get(plan, authenticate, validateRequest({ params: bookingParams }), async (req, res) => {
    const { params } = validatedRequest(res, { params: bookingParams });
    res.json(
      responseSchema(planSchema).parse({
        data: await services.guests.plan(params.bookingId, context(req, res)),
      }),
    );
  });
  router.patch(
    plan,
    authenticate,
    validateRequest({ params: bookingParams, body: planWriteSchema }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: bookingParams,
        body: planWriteSchema,
      });
      res.json(
        responseSchema(planSchema).parse({
          data: await services.guests.updatePlan(
            params.bookingId,
            body,
            key(req),
            context(req, res),
          ),
        }),
      );
    },
  );
  router.post(
    `${guests}/:guestId/personalized-invitations`,
    authenticate,
    validateRequest({ params: guestParams, body: linkIssueSchema }),
    async (req, res) => {
      const { params, body } = validatedRequest(res, {
        params: guestParams,
        body: linkIssueSchema,
      });
      res.status(201).json(
        responseSchema(issuedLinkSchema).parse({
          data: await services.links.issue(
            params.bookingId,
            params.guestId,
            body,
            key(req),
            context(req, res),
          ),
        }),
      );
    },
  );
  router.post(
    '/guest/invitation-sessions',
    validateRequest({ body: exchangeBodySchema }),
    async (req, res) => {
      const { body } = validatedRequest(res, { body: exchangeBodySchema });
      res.json(
        responseSchema(sessionSchema).parse({
          data: await services.links.exchange(
            body.credential,
            req.ip ?? req.socket.remoteAddress ?? 'unknown',
          ),
        }),
      );
    },
  );
  router.get('/guest/invitation', async (req, res) => {
    const bearer = req.get('authorization');
    if (bearer === undefined || !bearer.startsWith('Bearer ')) throw unavailable();
    res.json(
      responseSchema(invitationViewSchema).parse({
        data: await services.links.view(bearer.slice(7)),
      }),
    );
  });
  return router;
}
