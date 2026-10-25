import { createHash, randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import { createGeneralRateLimit } from '../../../core/http/rate-limit.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActorResolver,
  type AuthenticatedActor,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import type { Redis } from 'ioredis';
import {
  consultationRequestBodySchema,
  intakeAcknowledgementSchema,
  intakeActionSchema,
  intakeListSchema,
  intakeStatusSchema,
  intakeQuerySchema,
  intakeParamsSchema,
  overviewQuerySchema,
  overviewResponseSchema,
  updateBookingAliasParamsSchema,
  updateBookingAliasBodySchema,
  updateBookingAliasResponseSchema,
} from './experience.schemas.js';

export function createBookingExperienceRouter(
  prisma: PrismaClient,
  resolver: AuthenticatedActorResolver,
  redisClient?: Redis | null,
) {
  const router = Router();
  const authenticate = createAuthenticatedActorMiddleware(resolver);
  router.post(
    '/consultation-requests',
    createGeneralRateLimit({ maxRequests: 5, windowMs: 60 * 60_000 }, redisClient, 'experience'),
    validateRequest({ body: consultationRequestBodySchema }),
    async (request, response) => {
      const { body } = validatedRequest(response, { body: consultationRequestBodySchema });
      const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const { preferredDate, ...fields } = body;
      await prisma.$transaction(async (tx) => {
        const created = await tx.consultationRequest.createMany({
          data: {
            ...fields,
            brideName: fields.brideName ?? null,
            groomName: fields.groomName ?? null,
            payloadHash,
            preferredDate: preferredDate === null ? null : new Date(`${preferredDate}T00:00:00Z`),
          },
          skipDuplicates: true,
        });
        const record = await tx.consultationRequest.findUniqueOrThrow({
          where: { submissionId: body.submissionId },
        });
        if (record.payloadHash !== payloadHash) throw failure(409, 'SUBMISSION_KEY_REUSED');
        if (created.count === 1)
          await tx.auditLog.create({
            data: {
              requestId: request.requestId,
              actorType: 'SYSTEM',
              action: 'booking.intake-received',
              entityType: 'consultation-request',
              entityId: record.id,
              metadata: {},
            },
          });
      });
      response
        .set('Cache-Control', 'no-store')
        .status(202)
        .json(intakeAcknowledgementSchema.parse({ data: { accepted: true } }));
    },
  );
  router.use('/management/consultation-requests', authenticate, (_request, response, next) => {
    if (!actorOf(response).roles.includes('MANAGER')) return next(failure(403, 'FORBIDDEN'));
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.get(
    '/management/consultation-requests',
    validateRequest({ query: intakeQuerySchema }),
    async (_request, response) => {
      const { query } = validatedRequest(response, { query: intakeQuerySchema });
      const normalizedSearch = query.q ? query.q.normalize('NFC') : '';
      const baseWhere: Prisma.ConsultationRequestWhereInput = {
        createdAt: { gt: new Date(Date.now() - 180 * 86400_000) },
        ...(normalizedSearch
          ? {
              OR: ['displayName', 'brideName', 'groomName', 'email', 'phone', 'message'].map(
                (field) => ({
                  [field]: { contains: normalizedSearch, mode: 'insensitive' as const },
                }),
              ),
            }
          : {}),
      };
      const where: Prisma.ConsultationRequestWhereInput = {
        ...baseWhere,
        ...(query.status === 'ALL' ? {} : { status: query.status }),
      };
      const primary: Prisma.ConsultationRequestOrderByWithRelationInput =
        query.sort === 'oldest'
          ? { createdAt: 'asc' }
          : query.sort === 'date-asc'
            ? { preferredDate: { sort: 'asc', nulls: 'last' } }
            : query.sort === 'guests-desc'
              ? { expectedGuests: { sort: 'desc', nulls: 'last' } }
              : query.sort === 'name-asc'
                ? { displayName: 'asc' }
                : { createdAt: 'desc' };
      const { rows, counts } = await prisma.$transaction(
        async (tx) => {
          if (
            query.cursor &&
            !(await tx.consultationRequest.findFirst({
              where: { ...where, id: query.cursor },
              select: { id: true },
            }))
          )
            throw failure(409, 'CONSULTATION_LIST_CHANGED');
          const [rows, grouped] = await Promise.all([
            tx.consultationRequest.findMany({
              include: { consultation: { select: { revision: true } } },
              where,
              orderBy: [primary, { id: 'desc' }],
              take: query.limit + 1,
              ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
            }),
            tx.consultationRequest.groupBy({
              by: ['status'],
              where: baseWhere,
              _count: { _all: true },
            }),
          ]);
          const counts = { NEW: 0, CONVERTED: 0, CLOSED: 0 };
          for (const group of grouped)
            counts[intakeStatusSchema.parse(group.status)] = group._count._all;
          return { rows, counts };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      const items = rows.slice(0, query.limit);
      response.json(
        intakeListSchema.parse({
          data: items.map((item) => ({
            id: item.id,
            displayName: item.displayName,
            brideName: item.brideName,
            groomName: item.groomName,
            email: item.email,
            phone: item.phone,
            preferredDate: item.preferredDate?.toISOString().slice(0, 10) ?? null,
            expectedGuests: item.expectedGuests,
            message: item.message,
            status: item.status,
            consultationId: item.consultationId,
            consultationRevision: item.consultation?.revision ?? null,
            createdAt: item.createdAt.toISOString(),
          })),
          counts,
          totalMatches:
            query.status === 'ALL'
              ? counts.NEW + counts.CONVERTED + counts.CLOSED
              : counts[query.status],
          nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
        }),
      );
    },
  );
  router.post(
    '/management/consultation-requests/:id/conversion',
    validateRequest({ params: intakeParamsSchema }),
    async (request, response) => {
      const { params } = validatedRequest(response, { params: intakeParamsSchema });
      const actor = actorOf(response);
      const converted = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ConsultationRequest" WHERE "id" = ${params.id}::uuid FOR UPDATE`;
        const item = await tx.consultationRequest.findUnique({
          where: { id: params.id },
          include: { consultation: { select: { managerAccountId: true, revision: true } } },
        });
        if (item === null || item.createdAt.getTime() <= Date.now() - 180 * 86400_000)
          throw failure(404, 'CONSULTATION_REQUEST_NOT_FOUND');
        if (item.status === 'CONVERTED') {
          if (item.consultation?.managerAccountId !== actor.accountId)
            throw failure(404, 'CONSULTATION_REQUEST_NOT_FOUND');
          return {
            consultationId: item.consultationId,
            consultationRevision: item.consultation.revision,
          };
        }
        if (item.status !== 'NEW') throw failure(409, 'CONSULTATION_REQUEST_CLOSED');
        const consultation = await tx.consultation.create({
          data: {
            id: randomUUID(),
            managerAccountId: actor.accountId,
            intendedEmail: item.email,
            intendedEmailNormalized: item.email.trim().toLowerCase(),
            displayName: item.displayName,
            brideName: item.brideName,
            groomName: item.groomName,
            note: item.message || null,
          },
        });
        await tx.consultationRequest.update({
          where: { id: item.id },
          data: { status: 'CONVERTED', consultationId: consultation.id },
        });
        await tx.auditLog.create({
          data: {
            requestId: request.requestId,
            actorType: 'USER',
            actorId: actor.accountId,
            action: 'booking.consultation-created',
            entityType: 'consultation',
            entityId: consultation.id,
            metadata: { intakeRequestId: item.id },
          },
        });
        return { consultationId: consultation.id, consultationRevision: consultation.revision };
      });
      response.json(intakeActionSchema.parse({ data: converted }));
    },
  );
  router.post(
    '/management/consultation-requests/:id/closure',
    validateRequest({ params: intakeParamsSchema }),
    async (request, response) => {
      const { params } = validatedRequest(response, { params: intakeParamsSchema });
      await prisma.$transaction(async (tx) => {
        const changed = await tx.consultationRequest.updateMany({
          where: { id: params.id, status: { in: ['NEW', 'CLOSED'] } },
          data: { status: 'CLOSED' },
        });
        if (changed.count !== 1) throw failure(409, 'CONSULTATION_REQUEST_NOT_OPEN');
        await tx.auditLog.create({
          data: {
            requestId: request.requestId,
            actorType: 'USER',
            actorId: actorOf(response).accountId,
            action: 'booking.intake-closed',
            entityType: 'consultation-request',
            entityId: params.id,
            metadata: {},
          },
        });
      });
      response.json(intakeActionSchema.parse({ data: { consultationId: null } }));
    },
  );
  router.get(
    '/couple/bookings',
    authenticate,
    validateRequest({ query: overviewQuerySchema }),
    async (_request, response) => {
      const { query } = validatedRequest(response, { query: overviewQuerySchema });
      const grants = await prisma.consultationAccess.findMany({
        where: {
          accountId: actorOf(response).accountId,
        },
        select: { consultationId: true, level: true },
      });
      if (grants.length === 0) {
        response
          .set('Cache-Control', 'no-store')
          .json(overviewResponseSchema.parse({ data: [], nextCursor: null }));
        return;
      }
      const rows = await prisma.booking.findMany({
        where: {
          consultationId: { in: grants.map((grant) => grant.consultationId) },
        },
        select: {
          id: true,
          consultationId: true,
          eventDate: true,
          phase: true,
          shiftCode: true,
          planningHeadcount: true,
          revision: true,
          eventType: true,
          alias: true,
          consultation: { select: { brideName: true, groomName: true } },
          proposalSnapshot: { select: { hallName: true, baseChargeVnd: true } },
          depositSettlement: { select: { amountVnd: true } },
          currentTimelineRevision: { select: { managerApprovedAt: true, coupleApprovedAt: true } },
        },
        orderBy: [{ eventDate: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      });
      const items = rows.slice(0, query.limit);
      const accessByConsultation = new Map(
        grants.map((grant) => [grant.consultationId, grant.level]),
      );
      response.set('Cache-Control', 'no-store').json(
        overviewResponseSchema.parse({
          data: items.map((booking) => ({
            bookingId: booking.id,
            consultationId: booking.consultationId,
            eventDate: booking.eventDate.toISOString().slice(0, 10),
            phase: booking.phase,
            accessLevel: accessByConsultation.get(booking.consultationId)!,
            hallName: booking.proposalSnapshot?.hallName ?? '',
            shiftCode: booking.shiftCode,
            planningHeadcount: booking.planningHeadcount,
            hasTimeline: booking.currentTimelineRevision !== null,
            managerApproved:
              booking.currentTimelineRevision !== null &&
              booking.currentTimelineRevision.managerApprovedAt !== null,
            coupleApproved:
              booking.currentTimelineRevision !== null &&
              booking.currentTimelineRevision.coupleApprovedAt !== null,
            revision: booking.revision,
            eventType: booking.eventType,
            alias: booking.alias,
            brideName: booking.consultation?.brideName ?? '',
            groomName: booking.consultation?.groomName ?? '',
            totalVnd: booking.proposalSnapshot?.baseChargeVnd
              ? Number(booking.proposalSnapshot.baseChargeVnd)
              : undefined,
            depositPaidVnd: booking.depositSettlement?.amountVnd
              ? Number(booking.depositSettlement.amountVnd)
              : 0,
          })),
          nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
        }),
      );
    },
  );
  router.patch(
    '/couple/bookings/:bookingId/alias',
    authenticate,
    validateRequest({
      params: updateBookingAliasParamsSchema,
      body: updateBookingAliasBodySchema,
    }),
    async (request, response) => {
      const { params, body } = validatedRequest(response, {
        params: updateBookingAliasParamsSchema,
        body: updateBookingAliasBodySchema,
      });
      const actor = actorOf(response);
      const booking = await prisma.booking.findUnique({
        where: { id: params.bookingId },
        select: { id: true, consultationId: true, revision: true },
      });
      if (!booking) throw failure(404, 'BOOKING_NOT_FOUND');
      if (body.expectedRevision !== undefined && booking.revision !== body.expectedRevision) {
        throw new AppError({
          status: 409,
          code: 'STALE_BOOKING_REVISION',
          message: 'Dữ liệu tiệc cưới đã thay đổi. Vui lòng tải lại trang.',
        });
      }
      const isManager = actor.roles.includes('MANAGER');
      if (!isManager) {
        const access = await prisma.consultationAccess.findUnique({
          where: {
            accountId_consultationId: {
              accountId: actor.accountId,
              consultationId: booking.consultationId,
            },
          },
        });
        if (!access) throw failure(403, 'FORBIDDEN');
      }
      const normalizedAlias =
        body.alias !== undefined
          ? body.alias
            ? body.alias.normalize('NFC')
            : null
          : undefined;
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.booking.update({
          where: {
            id: params.bookingId,
            ...(body.expectedRevision !== undefined ? { revision: body.expectedRevision } : {}),
          },
          data: {
            revision: { increment: 1 },
            ...(normalizedAlias !== undefined ? { alias: normalizedAlias } : {}),
            ...(body.eventType !== undefined ? { eventType: body.eventType } : {}),
          },
          select: { id: true, revision: true, alias: true, eventType: true },
        });
        await tx.auditLog.create({
          data: {
            requestId: request.requestId,
            actorType: 'USER',
            actorId: actor.accountId,
            action: 'booking.alias-updated',
            entityType: 'booking',
            entityId: params.bookingId,
            metadata: {
              alias: result.alias,
              eventType: result.eventType,
              actorRole: isManager ? 'MANAGER' : 'COUPLE',
            },
          },
        });
        return result;
      });
      response.json(
        updateBookingAliasResponseSchema.parse({
          data: {
            bookingId: updated.id,
            revision: updated.revision,
            alias: updated.alias,
            eventType: updated.eventType,
          },
        }),
      );
    },
  );
  return router;
}
function actorOf(response: Response): AuthenticatedActor {
  return response.locals.actor as AuthenticatedActor;
}
function failure(status: number, code: string) {
  return new AppError({
    status,
    code,
    message: 'The consultation operation could not be completed.',
  });
}
