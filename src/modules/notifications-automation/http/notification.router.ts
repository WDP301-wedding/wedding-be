import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  AppError,
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import type { NotificationSettings } from '../application/notification-settings.js';
import type { createGuestServices } from '../../guest-management/infrastructure/guest.composition.js';
import type { GuestCredentialDelivery } from '../../guest-management/application/guest.contracts.js';
import {
  id,
  result,
  page,
  preferencesDto,
  installationDto,
  registryDto,
  statusDto,
  inboxDto,
  guestDeliveryDto,
  guestDeliveryBody,
} from './notification.schemas.js';
import { parse } from '../domain/notification-policy.js';

export function createNotificationRouter(
  settings: NotificationSettings,
  guests: ReturnType<typeof createGuestServices>,
  delivery: GuestCredentialDelivery | null,
) {
  const router = Router(),
    authenticate = createAuthenticatedActorMiddleware(settings.resolver);
  const own = '/notifications',
    management = '/management/notifications';
  router.use((req, res, next) => {
    if (
      req.path.startsWith(own) ||
      req.path.startsWith(management) ||
      /^\/bookings\/[^/]+\/guests\/[^/]+\/delivery$/u.test(req.path)
    )
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  const token = (req: Request) => req.get('authorization')!.slice(7),
    key = (req: Request) => req.get('idempotency-key');
  const scope = (req: Request) => settings.withRequestId(req.requestId);
  const parameter = (req: Request) => parse(id, req.params['id']);
  router.get(own + '/preferences', authenticate, async (req, res) =>
    res.json(result(preferencesDto).parse({ data: await scope(req).preferences(token(req)) })),
  );
  router.patch(own + '/preferences', authenticate, async (req, res) =>
    res.json(
      result(preferencesDto).parse({
        data: await scope(req).patchPreferences(token(req), req.body, key(req)),
      }),
    ),
  );
  router.get(own + '/android-installations', authenticate, async (req, res) =>
    res.json(
      result(z.array(installationDto)).parse({ data: await scope(req).installations(token(req)) }),
    ),
  );
  router.post(own + '/android-installations', authenticate, async (req, res) =>
    res.status(201).json(
      result(installationDto).parse({
        data: await scope(req).register(token(req), req.body, key(req)),
      }),
    ),
  );
  router.delete(own + '/android-installations/:id', authenticate, async (req, res) =>
    res.json(
      result(installationDto).parse({
        data: await scope(req).revoke(token(req), parameter(req), req.body, key(req)),
      }),
    ),
  );
  router.get(management + '/recipient', authenticate, async (req, res) =>
    res.json(result(registryDto.nullable()).parse({ data: await scope(req).registry(token(req)) })),
  );
  router.patch(management + '/recipient', authenticate, async (req, res) =>
    res.json(
      result(registryDto).parse({
        data: await scope(req).patchRegistry(token(req), req.body, key(req)),
      }),
    ),
  );
  router.get(management, authenticate, async (req, res) =>
    res.json(
      result(page(statusDto)).parse({ data: await scope(req).statuses(token(req), req.query) }),
    ),
  );
  router.post(management + '/:id/requeue', authenticate, async (req, res) =>
    res.json(
      result(statusDto).parse({
        data: await scope(req).requeue(token(req), parameter(req), req.body, key(req)),
      }),
    ),
  );
  router.get(own + '/inbox', authenticate, async (req, res) =>
    res.json(result(page(inboxDto)).parse({ data: await scope(req).inbox(token(req), req.query) })),
  );
  router.get(own + '/unread-count', authenticate, async (req, res) =>
    res.json(
      result(z.strictObject({ count: z.int().nonnegative() })).parse({
        data: await scope(req).unread(token(req)),
      }),
    ),
  );
  router.post(own + '/inbox/:id/read', authenticate, async (req, res) =>
    res.json(
      result(z.strictObject({ id, revision: z.int().positive(), readAt: z.iso.datetime() })).parse({
        data: await scope(req).markRead(token(req), parameter(req), req.body, key(req)),
      }),
    ),
  );
  router.post(own + '/inbox/read-all', authenticate, async (req, res) =>
    res.json(
      result(
        z.strictObject({ count: z.int().nonnegative(), throughCreatedAt: z.iso.datetime() }),
      ).parse({ data: await scope(req).readAll(token(req), req.body, key(req)) }),
    ),
  );
  router.post('/bookings/:bookingId/guests/:guestId/delivery', authenticate, async (req, res) => {
    if (!delivery)
      throw new AppError({
        status: 503,
        code: 'GUEST_DELIVERY_UNAVAILABLE',
        message: 'Guest email delivery is not configured.',
      });
    const bookingId = parse(id, req.params['bookingId']),
      guestId = parse(id, req.params['guestId']);
    const actor = res.locals.actor as AuthenticatedActor;
    const rawKey = key(req);
    if (rawKey === undefined) throw new IdempotencyKeyRequiredError();
    const parsedKey = idempotencyKeySchema.safeParse(rawKey);
    if (!parsedKey.success) throw new InvalidIdempotencyKeyError();
    const data = await guests.links.issueDelivery(
      bookingId,
      guestId,
      parse(guestDeliveryBody, req.body),
      parsedKey.data,
      { actorId: actor.accountId, accessToken: token(req), requestId: req.requestId },
      delivery,
    );
    res.status(201).json(result(guestDeliveryDto).parse({ data }));
  });
  return router;
}
