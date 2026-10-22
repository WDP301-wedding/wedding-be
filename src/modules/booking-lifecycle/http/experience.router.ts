import { createHash, randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { AppError } from '../../../core/errors/app-error.js';
import { createGeneralRateLimit } from '../../../core/http/rate-limit.js';
import { validateRequest, validatedRequest } from '../../../core/http/validate.js';
import {
  createAuthenticatedActorMiddleware,
  type AuthenticatedActorResolver,
  type AuthenticatedActor,
} from '../../identity-access/authorization/authenticated-actor.middleware.js';
import {
  consultationRequestBodySchema,
  intakeAcknowledgementSchema,
  intakeActionSchema,
  intakeListSchema,
  experienceQuerySchema,
  intakeParamsSchema,
  overviewQuerySchema,
  overviewResponseSchema,
} from './experience.schemas.js';

export function createBookingExperienceRouter(
  prisma: PrismaClient,
  resolver: AuthenticatedActorResolver,
) {
  const router = Router();
  const authenticate = createAuthenticatedActorMiddleware(resolver);
  router.post(
    '/consultation-requests',
    createGeneralRateLimit({ maxRequests: 5, windowMs: 60 * 60_000 }),
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
    validateRequest({ query: experienceQuerySchema }),
    async (_request, response) => {
      const { query } = validatedRequest(response, { query: experienceQuerySchema });
      const rows = await prisma.consultationRequest.findMany({
        include: { consultation: { select: { revision: true } } },
        where: { createdAt: { gt: new Date(Date.now() - 180 * 86400_000) } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      });
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
      const consultationId = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "ConsultationRequest" WHERE "id" = ${params.id}::uuid FOR UPDATE`;
        const item = await tx.consultationRequest.findUnique({
          where: { id: params.id },
          include: { consultation: { select: { managerAccountId: true } } },
        });
        if (item === null || item.createdAt.getTime() <= Date.now() - 180 * 86400_000)
          throw failure(404, 'CONSULTATION_REQUEST_NOT_FOUND');
        if (item.status === 'CONVERTED') {
          if (item.consultation?.managerAccountId !== actor.accountId)
            throw failure(404, 'CONSULTATION_REQUEST_NOT_FOUND');
          return item.consultationId;
        }
        if (item.status !== 'NEW') throw failure(409, 'CONSULTATION_REQUEST_CLOSED');
        const consultation = await tx.consultation.create({
          data: {
            id: randomUUID(),
            managerAccountId: actor.accountId,
            intendedEmail: item.email,
            intendedEmailNormalized: item.email,
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
        return consultation.id;
      });
      response.json(intakeActionSchema.parse({ data: { consultationId } }));
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
          ...(query.client === 'ANDROID' ? { level: 'FULL' as const } : {}),
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
          ...(query.client === 'ANDROID'
            ? { phase: { in: ['CONFIRMED' as const, 'COMPLETED' as const] } }
            : {}),
        },
        select: {
          id: true,
          consultationId: true,
          eventDate: true,
          phase: true,
          shiftCode: true,
          planningHeadcount: true,
          proposalSnapshot: { select: { hallName: true } },
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
          })),
          nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
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
