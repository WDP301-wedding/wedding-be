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
import type { NotificationService } from '../application/notification.service.js';
import {
  preferencesInput,
  installationInput,
  revisionInput,
  requeueInput,
  resolutionInput,
  registryInput,
  pageInput,
  operationsInput,
  deliveryInput,
} from '../domain/notification-policy.js';
import {
  preferenceSchema,
  installationSchema,
  recipientSchema,
  deliverySchema,
  readSchema,
  recoverySchema,
  inboxSchema,
  operationsSchema,
} from './notification.schemas.js';
export function createNotificationRouter(service: NotificationService) {
  const router = Router(),
    authenticate = createAuthenticatedActorMiddleware(service.resolver),
    empty = z.strictObject({}),
    id = z.strictObject({ id: z.uuid() }),
    booking = z.strictObject({ bookingId: z.uuid() }),
    guest = booking.extend({ guestId: z.uuid() });
  const context = (req: Request, res: Response) => ({
    actorId: (res.locals.actor as AuthenticatedActor).accountId,
    accessToken: req.get('authorization')!.slice(7),
    requestId: req.requestId,
  });
  const key = (req: Request) => {
    const raw = req.get('idempotency-key');
    if (raw === undefined) throw new IdempotencyKeyRequiredError();
    const result = idempotencyKeySchema.safeParse(raw);
    if (!result.success) throw new InvalidIdempotencyKeyError();
    return result.data;
  };
  router.use((req, res, next) => {
    if (
      /^\/(notifications(?:\/|$)|management\/notifications|bookings\/[^/]+\/guests\/[^/]+\/invitation-deliveries)/u.test(
        req.path,
      )
    )
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  const get = <Q extends z.ZodType>(
    path: string,
    query: Q,
    output: z.ZodType,
    work: (value: z.output<Q>, ctx: ReturnType<typeof context>) => Promise<unknown>,
  ) =>
    router.get(path, authenticate, validateRequest({ params: empty, query }), async (req, res) => {
      const input = validatedRequest(res, { query });
      res.json(
        z
          .strictObject({ data: output })
          .parse({ data: await work(input.query, context(req, res)) }),
      );
    });
  const write = <P extends z.ZodType, B extends z.ZodType>(
    method: 'post' | 'patch' | 'delete',
    path: string,
    params: P,
    body: B,
    output: z.ZodType,
    work: (
      params: z.output<P>,
      body: z.output<B>,
      key: string,
      ctx: ReturnType<typeof context>,
    ) => Promise<unknown>,
  ) =>
    router[method](
      path,
      authenticate,
      validateRequest({ params, body, query: empty }),
      async (req, res) => {
        const input = validatedRequest(res, { params, body });
        res
          .status(method === 'post' ? 201 : 200)
          .json(
            z
              .strictObject({ data: output })
              .parse({ data: await work(input.params, input.body, key(req), context(req, res)) }),
          );
      },
    );
  get('/notifications/preferences', empty, preferenceSchema, (_q, c) => service.preferences(c));
  get('/notifications/inbox', pageInput, inboxSchema, (q, c) => service.inbox(q, c));
  get('/management/notifications', operationsInput, operationsSchema, (q, c) =>
    service.operations(q, c),
  );
  write(
    'patch',
    '/notifications/preferences',
    empty,
    preferencesInput,
    preferenceSchema,
    (_p, b, k, c) => service.setPreferences(b, k, c),
  );
  write(
    'post',
    '/notifications/android-installations',
    empty,
    installationInput,
    installationSchema,
    (_p, b, k, c) => service.register(b, k, c),
  );
  write(
    'delete',
    '/notifications/android-installations/:id',
    id,
    revisionInput,
    installationSchema,
    (p, b, k, c) => service.revoke(p.id, b, k, c),
  );
  write('patch', '/notifications/inbox/:id/read', id, revisionInput, readSchema, (p, b, k, c) =>
    service.markRead(p.id, b, k, c),
  );
  write(
    'post',
    '/management/notifications/:id/requeue',
    id,
    requeueInput,
    recoverySchema,
    (p, b, k, c) => service.recover(p.id, b, k, c),
  );
  write(
    'post',
    '/management/notifications/:id/resolve',
    id,
    resolutionInput,
    recoverySchema,
    (p, b, k, c) => service.recover(p.id, b, k, c, true),
  );
  write(
    'post',
    '/management/notifications/bookings/:bookingId/recipients',
    booking,
    registryInput,
    recipientSchema,
    (p, b, k, c) => service.registry(p.bookingId, b, k, c),
  );
  write(
    'post',
    '/bookings/:bookingId/guests/:guestId/invitation-deliveries',
    guest,
    deliveryInput,
    deliverySchema,
    (p, b, k, c) => service.deliver(p.bookingId, p.guestId, b, k, c),
  );
  return router;
}
