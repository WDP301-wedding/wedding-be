import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createApp } from '../../../app.js';
import { NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor, AuthenticatedActorResolver } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { ForbiddenIdentityAccessError } from '../../identity-access/authorization/authorization.service.js';
import type { SeatingPlanService } from '../application/seating-plan.service.js';
import {
  createSeatingPlanRouter,
  seatingActorScope,
  type BookingAccessAuthorizer,
  type SeatingPlanHttpServices,
} from './seating-plan.router.js';

type MockedService<T> = {
  [Key in keyof T]: T[Key] extends (...arguments_: infer Arguments) => infer Result
    ? Mock<(...arguments_: Arguments) => Result>
    : T[Key];
};

function createMockSeatingService(): MockedService<SeatingPlanService> {
  return {
    listLayoutOptions: vi.fn(),
    selectLayout: vi.fn(),
    getPlan: vi.fn(),
    saveRevision: vi.fn(),
    confirmPlan: vi.fn(),
    recordManagerException: vi.fn(),
    getGuidance: vi.fn(),
    requireCurrentPlan: vi.fn(),
    resolveRevision: vi.fn(),
  };
}

describe('Seating Plan Router', () => {
  let mockService: MockedService<SeatingPlanService>;
  let mockActorResolver: Mock<AuthenticatedActorResolver['resolve']>;
  let mockAuthorizer: Mock<BookingAccessAuthorizer>;
  let app: ReturnType<typeof createApp>;

  const coupleAccountId = randomUUID();
  const bookingId = randomUUID();
  const planId = randomUUID();

  beforeEach(() => {
    mockService = createMockSeatingService();
    mockActorResolver = vi.fn();
    mockAuthorizer = vi.fn();

    const services: SeatingPlanHttpServices = {
      seatingPlan: mockService,
      actorResolver: { resolve: mockActorResolver },
      authorizeBookingAccess: mockAuthorizer,
    };

    app = createApp({
      registerRoutes: (expressApp) => {
        expressApp.use(
          '/api/v1',
          createSeatingPlanRouter({
            services,
            createIdempotencyHandler: () => (_req, _res, next) => next(),
          }),
        );
      },
    });
  });

  describe('P1 — Booking Ownership & FULL Access Authorization', () => {
    it('returns concealed 404 when Couple does not own or have access to the booking', async () => {
      const coupleActor: AuthenticatedActor = {
        accountId: coupleAccountId,
        sessionId: randomUUID(),
        displayEmail: 'othercouple@example.com',
        roles: ['COUPLE'],
      };
      mockActorResolver.mockResolvedValue(coupleActor);
      mockAuthorizer.mockRejectedValue(new NotFoundError());

      const response = await request(app)
        .get(`/api/v1/bookings/${bookingId}/seating-plans/${planId}`)
        .set('Authorization', 'Bearer valid-couple-token');

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
      expect(mockAuthorizer).toHaveBeenCalledWith(coupleActor, bookingId);
      expect(mockService.getPlan).not.toHaveBeenCalled();
    });

    it('returns 403 Forbidden when Couple has RESTRICTED access (not FULL)', async () => {
      const coupleActor: AuthenticatedActor = {
        accountId: coupleAccountId,
        sessionId: randomUUID(),
        displayEmail: 'restrictedcouple@example.com',
        roles: ['COUPLE'],
      };
      mockActorResolver.mockResolvedValue(coupleActor);
      mockAuthorizer.mockRejectedValue(new ForbiddenIdentityAccessError());

      const response = await request(app)
        .get(`/api/v1/bookings/${bookingId}/seating-plans/${planId}`)
        .set('Authorization', 'Bearer valid-couple-token');

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(mockAuthorizer).toHaveBeenCalledWith(coupleActor, bookingId);
      expect(mockService.getPlan).not.toHaveBeenCalled();
    });

    it('returns 200 when Couple has FULL access to the booking', async () => {
      const coupleActor: AuthenticatedActor = {
        accountId: coupleAccountId,
        sessionId: randomUUID(),
        displayEmail: 'owner@example.com',
        roles: ['COUPLE'],
      };
      mockActorResolver.mockResolvedValue(coupleActor);
      mockAuthorizer.mockResolvedValue(undefined);
      mockService.getPlan.mockResolvedValue({
        planId,
        bookingId,
        status: 'CONFIRMED',
        planRevision: 1,
        currentRevision: null,
        confirmedRevisionId: randomUUID(),
        hasManagerException: false,
      });

      const response = await request(app)
        .get(`/api/v1/bookings/${bookingId}/seating-plans/${planId}`)
        .set('Authorization', 'Bearer valid-couple-token');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ data: { planId } });
      expect(mockAuthorizer).toHaveBeenCalledWith(coupleActor, bookingId);
      expect(mockService.getPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId,
          planId,
        }),
      );
    });
  });

  describe('P1 — Idempotency Security & Namespace', () => {
    it('rejects unauthenticated requests before running idempotency handler', async () => {
      const response = await request(app)
        .post(`/api/v1/bookings/${bookingId}/seating-plans/${planId}/confirmation`)
        .send({
          expectedRevision: 1,
          expectedBookingRevision: 1,
        });

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
      expect(mockService.confirmPlan).not.toHaveBeenCalled();
    });

    it('requires authentication for actor scope generation', () => {
      const fakeReq = {} as unknown as Request;
      expect(() => seatingActorScope(fakeReq)).toThrow();
    });
  });
});
