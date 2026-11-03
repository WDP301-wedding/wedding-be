import { activeIntakeWhere } from './booking-navigation.policy.js';
import { Router, type Response } from 'express';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActor,
  type AuthenticatedActorResolver,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { z } from 'zod';
import {
  numberPageQuery,
  bookingPageQuery,
  consultationPageQuery,
  bookingPageResponse,
  consultationPageResponse,
  archivePageResponse,
  archiveDetailResponse,
  navigationResponse,
} from './booking-navigation.schemas.js';
const selection = {
  id: true,
  bookingCode: true,
  alias: true,
  eventDate: true,
  shiftCode: true,
  phase: true,
  createdAt: true,
  cancelledAt: true,
  hallId: true,
  consultationId: true,
  proposalSnapshot: { select: { hallName: true, tableCount: true } },
  consultation: {
    select: {
      displayName: true,
      brideName: true,
      groomName: true,
      intendedEmail: true,
      managerAccountId: true,
      intakeRequest: { select: { phone: true, email: true } },
    },
  },
} satisfies Prisma.BookingSelect;
type Row = Prisma.BookingGetPayload<{ select: typeof selection }>;
const queryFilter = (q: string): Prisma.BookingWhereInput =>
  !q
    ? {}
    : {
        OR: [
          { bookingCode: { contains: q, mode: 'insensitive' } },
          { alias: { contains: q, mode: 'insensitive' } },
          { proposalSnapshot: { hallName: { contains: q, mode: 'insensitive' } } },
          {
            consultation: {
              OR: [
                { displayName: { contains: q, mode: 'insensitive' } },
                { brideName: { contains: q, mode: 'insensitive' } },
                { groomName: { contains: q, mode: 'insensitive' } },
                { intendedEmail: { contains: q, mode: 'insensitive' } },
                { intakeRequest: { phone: { contains: q } } },
              ],
            },
          },
        ],
      };
async function rowsDto(tx: Prisma.TransactionClient, rows: Row[], includeManagerIdentity = true) {
  const managers = includeManagerIdentity
    ? await tx.account.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.consultation.managerAccountId))] } },
        select: { id: true, displayEmail: true },
      })
    : [];
  const emails = new Map(managers.map((a) => [a.id, a.displayEmail]));
  return rows.map((r) => ({
    bookingId: r.id,
    bookingCode: r.bookingCode,
    alias: r.alias,
    eventDate: r.eventDate.toISOString().slice(0, 10),
    hallId: r.hallId,
    hallNameSnapshot: r.proposalSnapshot?.hallName ?? '',
    shiftCode: r.shiftCode,
    phase: r.phase,
    tableCount: r.proposalSnapshot?.tableCount ?? 0,
    createdAt: r.createdAt.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    customerName: r.consultation.displayName,
    brideName: r.consultation.brideName,
    groomName: r.consultation.groomName,
    phone: r.consultation.intakeRequest?.phone ?? null,
    email: r.consultation.intendedEmail,
    managerAccountId: includeManagerIdentity ? r.consultation.managerAccountId : null,
    managerEmail: emails.get(r.consultation.managerAccountId) ?? null,
  }));
}
const bounds = (requested: number, total: number, size: number) => ({
  page: Math.min(requested, Math.max(1, Math.ceil(total / size))),
  pageSize: size,
  total,
  totalPages: Math.ceil(total / size),
});
export function createBookingNavigationRouter(
  prisma: PrismaClient,
  resolver: AuthenticatedActorResolver,
) {
  const router = Router(),
    authenticate = createAuthenticatedActorMiddleware(resolver);
  const actor = (res: Response) => res.locals.actor as AuthenticatedActor;
  const manager = (res: Response) => {
    if (!actor(res).roles.includes('MANAGER'))
      throw new AppError({ status: 403, code: 'FORBIDDEN', message: 'Manager access required.' });
  };
  const owned = async (res: Response): Promise<Prisma.BookingWhereInput> => {
    if (actor(res).roles.includes('MANAGER')) return {};
    if (!actor(res).roles.includes('COUPLE')) throw new NotFoundError();
    const grants = await prisma.consultationAccess.findMany({
      where: { accountId: actor(res).accountId },
      select: { consultationId: true },
    });
    return { consultationId: { in: grants.map((g) => g.consultationId) } };
  };
  const params = z.strictObject({ bookingId: z.uuid() });
  router.get(
    '/management/booking-page',
    authenticate,
    validateRequest({ query: bookingPageQuery }),
    async (_req, res) => {
      manager(res);
      res.set('Cache-Control', 'no-store');
      const q = validatedRequest(res, { query: bookingPageQuery }).query;
      const base: Prisma.BookingWhereInput = { phase: { not: 'CANCELLED' } };
      const where: Prisma.BookingWhereInput = {
        AND: [
          base,
          queryFilter(q.q),
          ...(q.scope === 'mine'
            ? [{ consultation: { managerAccountId: actor(res).accountId } }]
            : []),
          ...(q.phase === 'ALL' ? [] : [{ phase: q.phase }]),
        ],
      };
      const sort: Prisma.BookingOrderByWithRelationInput =
        q.sort === 'recency'
          ? { createdAt: q.order }
          : q.sort === 'hallName'
            ? { proposalSnapshot: { hallName: q.order } }
            : q.sort === 'tableCount'
              ? { proposalSnapshot: { tableCount: q.order } }
              : { [q.sort]: q.order };
      const data = await prisma.$transaction(
        async (tx) => {
          const [total, all, mine] = await Promise.all([
            tx.booking.count({ where }),
            tx.booking.count({ where: base }),
            tx.booking.count({
              where: { ...base, consultation: { managerAccountId: actor(res).accountId } },
            }),
          ]);
          const paging = bounds(q.page, total, q.pageSize);
          const rows = await tx.booking.findMany({
            where,
            select: selection,
            orderBy: [sort, { id: q.order }],
            skip: (paging.page - 1) * q.pageSize,
            take: q.pageSize,
          });
          return { ...paging, counts: { all, mine }, items: await rowsDto(tx, rows) };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      res.json(bookingPageResponse.parse({ data }));
    },
  );
  router.get(
    '/management/consultation-page',
    authenticate,
    validateRequest({ query: consultationPageQuery }),
    async (_req, res) => {
      manager(res);
      res.set('Cache-Control', 'no-store');
      const q = validatedRequest(res, { query: consultationPageQuery }).query;
      const where: Prisma.ConsultationRequestWhereInput = {
        AND: [activeIntakeWhere],
        ...(q.status === 'ALL' ? {} : { status: q.status }),
        ...(q.q
          ? {
              OR: [
                { displayName: { contains: q.q, mode: 'insensitive' } },
                { email: { contains: q.q, mode: 'insensitive' } },
                { phone: { contains: q.q } },
              ],
            }
          : {}),
      };
      const primary: Prisma.ConsultationRequestOrderByWithRelationInput =
        q.sort === 'preferredDate'
          ? { preferredDate: { sort: q.order, nulls: 'last' } }
          : { [q.sort]: q.order };
      const data = await prisma.$transaction(
        async (tx) => {
          const total = await tx.consultationRequest.count({ where }),
            paging = bounds(q.page, total, q.pageSize);
          const rows = await tx.consultationRequest.findMany({
            where,
            include: {
              consultation: {
                select: { revision: true, booking: { select: { id: true, phase: true } } },
              },
            },
            orderBy: [primary, { id: q.order }],
            skip: (paging.page - 1) * q.pageSize,
            take: q.pageSize,
          });
          const counts = {
            total: await tx.consultationRequest.count({
              where: activeIntakeWhere,
            }),
            pending: await tx.consultationRequest.count({
              where: { AND: [activeIntakeWhere, { status: 'NEW' }] },
            }),
          };
          return {
            ...paging,
            counts,
            items: rows.map((r) => ({
              id: r.id,
              displayName: r.displayName,
              brideName: r.brideName,
              groomName: r.groomName,
              email: r.email,
              phone: r.phone,
              preferredDate: r.preferredDate?.toISOString().slice(0, 10) ?? null,
              expectedGuests: r.expectedGuests,
              message: r.message,
              status: r.status,
              consultationId: r.consultationId,
              consultationRevision: r.consultation?.revision ?? null,
              bookingId: r.consultation?.booking?.id ?? null,
              bookingPhase: r.consultation?.booking?.phase ?? null,
              preferredHallId: r.preferredHallId ?? null,
              preferredMenuVersionId: r.preferredMenuVersionId ?? null,
              preferredShift: r.preferredShift ?? null,
              createdAt: r.createdAt.toISOString(),
            })),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      res.json(consultationPageResponse.parse({ data }));
    },
  );
  router.get(
    '/booking-archive',
    authenticate,
    validateRequest({ query: numberPageQuery }),
    async (_req, res) => {
      res.set('Cache-Control', 'no-store');
      const q = validatedRequest(res, { query: numberPageQuery }).query,
        access = await owned(res);
      const data = await prisma.$transaction(
        async (tx) => {
          const where: Prisma.BookingWhereInput = {
            AND: [access, { phase: 'CANCELLED' }, queryFilter(q.q)],
          };
          const total = await tx.booking.count({ where }),
            paging = bounds(q.page, total, q.pageSize);
          const rows = await tx.booking.findMany({
            where,
            select: selection,
            orderBy: [{ cancelledAt: 'desc' }, { id: 'desc' }],
            skip: (paging.page - 1) * q.pageSize,
            take: q.pageSize,
          });
          return {
            ...paging,
            items: await rowsDto(tx, rows, actor(res).roles.includes('MANAGER')),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      res.json(archivePageResponse.parse({ data }));
    },
  );
  router.get(
    '/bookings/:bookingId/navigation',
    authenticate,
    validateRequest({ params }),
    async (_req, res) => {
      const { bookingId } = validatedRequest(res, { params }).params;
      const access = await owned(res);
      const booking = await prisma.booking.findFirst({
        where: { AND: [access, { id: bookingId }] },
        select: { id: true, phase: true },
      });
      if (!booking) throw new NotFoundError();
      res
        .set('Cache-Control', 'no-store')
        .json(navigationResponse.parse({ data: { bookingId: booking.id, phase: booking.phase } }));
    },
  );
  router.get(
    '/bookings/:bookingId/archive',
    authenticate,
    validateRequest({ params }),
    async (_req, res) => {
      const { bookingId } = validatedRequest(res, { params }).params,
        access = await owned(res);
      const data = await prisma.$transaction(
        async (tx) => {
          const row = await tx.booking.findFirst({
            where: { AND: [access, { id: bookingId, phase: 'CANCELLED' }] },
            select: {
              ...selection,
              cancellationRequests: {
                where: { status: 'APPROVED' },
                orderBy: { decidedAt: 'desc' },
                take: 1,
                select: { reason: true },
              },
              commercialContract: {
                select: {
                  currentRevision: {
                    select: {
                      state: true,
                      contractTotalVnd: true,
                      depositAmountVnd: true,
                      document: true,
                    },
                  },
                },
              },
            },
          });
          if (!row) throw new NotFoundError();
          const contract = row.commercialContract?.currentRevision;
          const audit =
            actor(res).roles.includes('MANAGER') && !row.cancellationRequests[0]
              ? await tx.auditLog.findFirst({
                  where: {
                    entityType: 'booking',
                    entityId: bookingId,
                    action: 'booking.cancelled',
                  },
                  orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
                  select: { metadata: true },
                })
              : null;
          const metadata = audit?.metadata;
          const managerReason =
            metadata !== null &&
            typeof metadata === 'object' &&
            !Array.isArray(metadata) &&
            typeof metadata['reason'] === 'string'
              ? metadata['reason']
              : null;

          return {
            booking: (await rowsDto(tx, [row], actor(res).roles.includes('MANAGER')))[0],
            cancellationReason: row.cancellationRequests[0]?.reason ?? managerReason,
            contract: contract
              ? {
                  state: contract.state,
                  totalVnd: contract.contractTotalVnd.toNumber(),
                  depositVnd: contract.depositAmountVnd.toNumber(),
                  document: contract.document,
                }
              : null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      res.set('Cache-Control', 'no-store').json(archiveDetailResponse.parse({ data }));
    },
  );
  return router;
}
