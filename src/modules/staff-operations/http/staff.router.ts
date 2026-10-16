import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  IdempotencyKeyRequiredError,
  InvalidIdempotencyKeyError,
} from '../../../core/errors/app-error.js';
import { idempotencyKeySchema } from '../../../core/idempotency/idempotency.schemas.js';
import type { createStaffServices } from '../infrastructure/staff.composition.js';
import {
  configurationInput,
  assignmentInput,
  revokeInput,
  provisionInput,
  operationalInput,
  checkInInput,
  undoInput,
  searchInput,
  pageInput,
} from '../domain/staff-policy.js';
import { attendanceSchema } from '../application/attendance-readers.js';
import {
  settingsSchema,
  assignmentSchema,
  provisionSchema,
  operationalSchema,
  recordSchema,
  searchSchema,
  historySchema,
} from './staff.schemas.js';

export function createStaffRouter(s: ReturnType<typeof createStaffServices>) {
  const router = Router(),
    authenticate = createAuthenticatedActorMiddleware(s.resolver);
  const context = (req: Request, res: Response) => ({
    actorId: (res.locals.actor as AuthenticatedActor).accountId,
    requestId: req.requestId,
    accessToken: req.get('authorization')!.slice(7),
  });
  const key = (req: Request) => {
    const raw = req.get('idempotency-key');
    if (raw === undefined) throw new IdempotencyKeyRequiredError();
    const result = idempotencyKeySchema.safeParse(raw);
    if (!result.success) throw new InvalidIdempotencyKeyError();
    return result.data;
  };
  const bookingParams = z.strictObject({ bookingId: z.uuid() }),
    guestParams = bookingParams.extend({ guestId: z.uuid() }),
    accountParams = z.strictObject({ accountId: z.uuid() }),
    assignmentParams = bookingParams.extend({ assignmentId: z.uuid() });
  // All routes below are private; scope this router before other public routers.
  router.use((req, res, next) => {
    if (
      /^\/(staff\/|management\/(staff-accounts|events)|bookings\/[^/]+\/(check-in-settings|attendance-summary))/u.test(
        req.path,
      )
    )
      res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  const get = <P extends z.ZodType, Q extends z.ZodType>(
    path: string,
    params: P,
    query: Q,
    output: z.ZodType,
    work: (
      req: Request,
      res: Response,
      params: z.output<P>,
      query: z.output<Q>,
    ) => Promise<unknown>,
  ) =>
    router.get(path, authenticate, validateRequest({ params, query }), async (req, res) => {
      const input = validatedRequest(res, { params, query });
      res.json(
        z
          .strictObject({ data: output })
          .parse({ data: await work(req, res, input.params, input.query) }),
      );
    });
  const write = <P extends z.ZodType, B extends z.ZodType>(
    method: 'post' | 'patch',
    path: string,
    params: P,
    body: B,
    output: z.ZodType,
    work: (req: Request, res: Response, params: z.output<P>, body: z.output<B>) => Promise<unknown>,
  ) =>
    router[method](
      path,
      authenticate,
      validateRequest({ params, body, query: z.strictObject({}) }),
      async (req, res) => {
        const input = validatedRequest(res, { params, body });
        res
          .status(method === 'patch' ? 200 : 201)
          .json(
            z
              .strictObject({ data: output })
              .parse({ data: await work(req, res, input.params, input.body) }),
          );
      },
    );
  write(
    'post',
    '/management/staff-accounts',
    z.strictObject({}),
    provisionInput,
    provisionSchema,
    (req, res, _p, b) => s.accounts.provision(b.email, key(req), context(req, res)),
  );
  write(
    'post',
    '/management/staff-accounts/:accountId/operational-access',
    accountParams,
    operationalInput,
    operationalSchema,
    (req, res, p, b) =>
      s.accounts.setOperationalAccess(p.accountId, b, key(req), context(req, res)),
  );
  get(
    '/management/events/:bookingId/assignments',
    bookingParams,
    z.strictObject({}),
    z.array(assignmentSchema).max(100),
    (req, res, p) => s.staff.assignments(p.bookingId, context(req, res)),
  );
  write(
    'post',
    '/management/events/:bookingId/assignments',
    bookingParams,
    assignmentInput,
    assignmentSchema,
    (req, res, p, b) => s.staff.assign(p.bookingId, b, key(req), context(req, res)),
  );
  write(
    'post',
    '/management/events/:bookingId/assignments/:assignmentId/revocation',
    assignmentParams,
    revokeInput,
    assignmentSchema,
    (req, res, p, b) => s.staff.revoke(p.bookingId, p.assignmentId, b, key(req), context(req, res)),
  );
  get(
    '/bookings/:bookingId/check-in-settings',
    bookingParams,
    z.strictObject({}),
    settingsSchema,
    (req, res, p) => s.staff.settings(p.bookingId, context(req, res)),
  );
  write(
    'patch',
    '/bookings/:bookingId/check-in-settings',
    bookingParams,
    configurationInput,
    settingsSchema,
    (req, res, p, b) => s.staff.configure(p.bookingId, b, key(req), context(req, res)),
  );
  get(
    '/bookings/:bookingId/attendance-summary',
    bookingParams,
    z.strictObject({}),
    attendanceSchema,
    (req, res, p) =>
      s.staff.run(
        p.bookingId,
        context(req, res),
        () => s.staff.ownerAccess(p.bookingId, context(req, res)),
        () => s.readers.getBookingAttendance(p.bookingId),
        'READ',
      ),
  );
  get(
    '/staff/events/:bookingId/guests/search',
    bookingParams,
    searchInput,
    searchSchema,
    (req, res, p, q) => s.journal.search(p.bookingId, q, context(req, res)),
  );
  write(
    'post',
    '/staff/events/:bookingId/guests/:guestId/check-ins',
    guestParams,
    checkInInput,
    recordSchema,
    (req, res, p, b) => s.journal.checkIn(p.bookingId, p.guestId, b, key(req), context(req, res)),
  );
  write(
    'post',
    '/staff/events/:bookingId/guests/:guestId/check-in-undos',
    guestParams,
    undoInput,
    recordSchema,
    (req, res, p, b) => s.journal.undo(p.bookingId, p.guestId, b, key(req), context(req, res)),
  );
  get(
    '/staff/events/:bookingId/guests/:guestId/check-ins',
    guestParams,
    pageInput,
    historySchema,
    (req, res, p, q) => s.journal.history(p.bookingId, p.guestId, q, context(req, res)),
  );
  return router;
}
