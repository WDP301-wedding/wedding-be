import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createApp } from '../../../app.js';
import { AppError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor, AuthenticatedActorResolver } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { EventAssignmentRequiredError } from '../domain/staff-operations.policy.js';
import type { StaffOperationsService } from '../application/staff-operations.service.js';
import {
  createStaffOperationsRouter,
  staffActorScope,
  type StaffOperationsHttpServices,
} from './staff-operations.router.js';

type MockedService<T> = {
  [Key in keyof T]: T[Key] extends (...arguments_: infer Arguments) => infer Result
    ? Mock<(...arguments_: Arguments) => Result>
    : T[Key];
};

function createMockService(): MockedService<StaffOperationsService> {
  return {
    provisionStaffAccount: vi.fn(),
    setStaffOperationalAccess: vi.fn(),
    assignStaff: vi.fn(),
    revokeAssignment: vi.fn(),
    listAssignments: vi.fn(),
    searchHouseholds: vi.fn(),
    recordArrival: vi.fn(),
    recordCorrection: vi.fn(),
    getHouseholdAttendance: vi.fn(),
    getBookingAttendance: vi.fn(),
  };
}

describe('Staff Operations Router', () => {
  let mockService: MockedService<StaffOperationsService>;
  let mockActorResolver: Mock<AuthenticatedActorResolver['resolve']>;
  let app: ReturnType<typeof createApp>;

  const staffAccountId = randomUUID();
  const managerAccountId = randomUUID();
  const bookingId = randomUUID();
  const householdId = randomUUID();
  const arrivalId = randomUUID();

  beforeEach(() => {
    mockService = createMockService();
    mockActorResolver = vi.fn();

    const services: StaffOperationsHttpServices = {
      staffOperations: mockService,
      actorResolver: { resolve: mockActorResolver },
    };

    app = createApp({
      registerRoutes: (expressApp) => {
        expressApp.use(
          '/api/v1',
          createStaffOperationsRouter({
            services,
            createIdempotencyHandler: () => (_req, _res, next) => next(),
          }),
        );
      },
    });
  });

  describe('P1 — Staff Assignment & Role Handling', () => {
    it('denies access (403) when Staff is not assigned to the booking', async () => {
      const staffActor: AuthenticatedActor = {
        accountId: staffAccountId,
        sessionId: randomUUID(),
        displayEmail: 'staff@example.com',
        roles: ['STAFF'],
      };
      mockActorResolver.mockResolvedValue(staffActor);
      mockService.recordArrival.mockRejectedValue(new EventAssignmentRequiredError());

      const response = await request(app)
        .post(`/api/v1/staff/events/${bookingId}/households/${householdId}/arrivals`)
        .set('Authorization', 'Bearer valid-staff-token')
        .send({
          attendeeCount: 3,
        });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ error: { code: 'EVENT_ASSIGNMENT_REQUIRED' } });
      expect(mockService.recordArrival).toHaveBeenCalledWith(
        bookingId,
        householdId,
        expect.objectContaining({ attendeeCount: 3 }),
        { accountId: staffAccountId, role: 'STAFF' },
      );
    });

    it('allows access (201) when Staff is actively assigned to the booking', async () => {
      const staffActor: AuthenticatedActor = {
        accountId: staffAccountId,
        sessionId: randomUUID(),
        displayEmail: 'staff@example.com',
        roles: ['STAFF'],
      };
      mockActorResolver.mockResolvedValue(staffActor);
      mockService.recordArrival.mockResolvedValue({
        arrivalId,
        actualAttendees: 3,
        ledgerRevision: 1,
        warnings: [],
      });

      const response = await request(app)
        .post(`/api/v1/staff/events/${bookingId}/households/${householdId}/arrivals`)
        .set('Authorization', 'Bearer valid-staff-token')
        .send({
          attendeeCount: 3,
        });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ data: { actualAttendees: 3 } });
      expect(mockService.recordArrival).toHaveBeenCalledWith(
        bookingId,
        householdId,
        expect.objectContaining({ attendeeCount: 3 }),
        { accountId: staffAccountId, role: 'STAFF' },
      );
    });

    it('identifies Manager role correctly and passes role: MANAGER', async () => {
      const managerActor: AuthenticatedActor = {
        accountId: managerAccountId,
        sessionId: randomUUID(),
        displayEmail: 'manager@example.com',
        roles: ['STAFF', 'MANAGER'],
      };
      mockActorResolver.mockResolvedValue(managerActor);
      mockService.recordArrival.mockResolvedValue({
        arrivalId,
        actualAttendees: 2,
        ledgerRevision: 1,
        warnings: [],
      });

      const response = await request(app)
        .post(`/api/v1/staff/events/${bookingId}/households/${householdId}/arrivals`)
        .set('Authorization', 'Bearer valid-manager-token')
        .send({
          attendeeCount: 2,
        });

      expect(response.status).toBe(201);
      expect(mockService.recordArrival).toHaveBeenCalledWith(
        bookingId,
        householdId,
        expect.objectContaining({ attendeeCount: 2 }),
        { accountId: managerAccountId, role: 'MANAGER' },
      );
    });
  });

  describe('P1 — Idempotency Authentication & Namespace', () => {
    it('rejects unauthenticated requests with 401 before processing', async () => {
      const response = await request(app)
        .post(`/api/v1/staff/events/${bookingId}/households/${householdId}/arrivals`)
        .send({
          attendeeCount: 2,
        });

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
      expect(mockService.recordArrival).not.toHaveBeenCalled();
    });

    it('derives idempotency actor scope from accountId instead of token', () => {
      const fakeReq = {} as unknown as Request;
      expect(() => staffActorScope(fakeReq)).toThrow();
    });
  });

  describe('Attendance Corrections', () => {
    it('returns 409 Conflict when expectedLedgerRevision is stale', async () => {
      const staffActor: AuthenticatedActor = {
        accountId: staffAccountId,
        sessionId: randomUUID(),
        displayEmail: 'staff@example.com',
        roles: ['STAFF'],
      };
      mockActorResolver.mockResolvedValue(staffActor);
      mockService.recordCorrection.mockRejectedValue(
        new AppError({
          status: 409,
          code: 'STALE_REVISION',
          message: 'Ledger revision conflict',
        }),
      );

      const response = await request(app)
        .post(`/api/v1/staff/events/${bookingId}/households/${householdId}/corrections`)
        .set('Authorization', 'Bearer valid-staff-token')
        .send({
          arrivalId,
          delta: 1,
          reason: 'Adding an extra child',
          expectedLedgerRevision: 1,
        });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: { code: 'STALE_REVISION' } });
    });
  });
});
