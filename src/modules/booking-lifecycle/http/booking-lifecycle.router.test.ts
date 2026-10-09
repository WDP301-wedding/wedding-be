import type { RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app.js';
import { AppError } from '../../../core/errors/app-error.js';
import { BookingPolicyError } from '../domain/booking-policy.js';
import {
  createBookingLifecycleRouter,
  type BookingLifecycleHttpServices,
  type CreateBookingLifecycleRouterOptions,
} from './booking-lifecycle.router.js';

const consultationId = '00000000-0000-4000-8000-000000000001';

describe('BookingLifecycleRouter', () => {
  it('rejects a past event date before creating a booking', async () => {
    const createBooking = vi.fn();
    const response = await request(appWith({ createBooking }))
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer test-token')
      .set('Idempotency-Key', 'past-event-date')
      .send({
        consultationId,
        hallId: consultationId,
        eventDate: '2020-01-01',
        shiftCode: 'DINNER',
        menuPackageVersionId: consultationId,
        tableCount: 20,
        planningHeadcount: 200,
        expectedRevision: 1,
      });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        details: [
          expect.objectContaining({
            path: 'eventDate',
            message: 'Ngày tổ chức phải là ngày hợp lệ, từ ngày mốt trở đi (theo giờ Việt Nam).',
          }),
        ],
      },
    });
    expect(createBooking).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])(
    'audits protected %s denials without raw credentials, query or body',
    async (status) => {
      const audit = vi.fn().mockResolvedValue(undefined);
      const app = appWith(
        {
          getProposal: vi
            .fn()
            .mockRejectedValue(
              new AppError({ code: 'BOOKING_NOT_FOUND', status, message: 'Denied' }),
            ),
        },
        audit,
      );
      const response = await request(app)
        .get('/api/v1/bookings/' + consultationId + '/proposal?privateNote=omit')
        .set('Authorization', 'Bearer private-token');
      expect(response.status).toBe(status);
      expect(audit).toHaveBeenCalledWith({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Vitest matcher represents the generated request UUID.
        requestId: expect.any(String),
        actorAccountId: '00000000-0000-4000-8000-000000000010',
        code: 'BOOKING_NOT_FOUND',
        status,
        operation: 'GET /bookings/:bookingId/proposal',
      });
      expect(JSON.stringify(audit.mock.calls)).not.toMatch(/private-token|privateNote|omit/);
    },
  );
  it('fails closed when protected audit storage is unavailable', async () => {
    const app = appWith(
      {
        getProposal: vi
          .fn()
          .mockRejectedValue(new AppError({ code: 'FORBIDDEN', status: 403, message: 'Denied' })),
      },
      vi.fn().mockRejectedValue(new Error('audit unavailable')),
    );
    expect(
      (
        await request(app)
          .get('/api/v1/bookings/' + consultationId + '/proposal')
          .set('Authorization', 'Bearer token')
      ).status,
    ).toBe(503);
  });
  it('routes a strict cancellation decision to the owning Manager service', async () => {
    const decideCancellation = vi
      .fn()
      .mockResolvedValue({ phase: 'CONFIRMED', bookingRevision: 5 });
    const app = appWith({ decideCancellation });
    const response = await request(app)
      .post(
        `/api/v1/management/bookings/${consultationId}/cancellation-requests/${consultationId}/decision`,
      )
      .set('Authorization', 'Bearer test-token')
      .set('Idempotency-Key', 'reject-cancellation')
      .send({ expectedRevision: 4, decision: 'REJECT', reason: 'Continue event' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { phase: 'CONFIRMED', bookingRevision: 5 } });
    expect(decideCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        cancellationRequestId: consultationId,
        decision: 'REJECT',
        expectedBookingRevision: 4,
      }),
    );
  });
  it('returns a stable conflict for a rejected domain transition', async () => {
    const app = appWith({
      complete: vi
        .fn()
        .mockRejectedValue(
          new BookingPolicyError('INVALID_BOOKING_TRANSITION', 'Cannot complete a draft.'),
        ),
    });
    const response = await request(app)
      .post(`/api/v1/management/bookings/${consultationId}/completion`)
      .set('Authorization', 'Bearer test-token')
      .set('Idempotency-Key', 'complete-draft')
      .send({ expectedRevision: 1 });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_BOOKING_TRANSITION' } });
  });
  it('creates a consultation with a strict Manager command', async () => {
    const createConsultation = vi.fn().mockResolvedValue({ consultationId, revision: 1 });
    const app = appWith({ createConsultation });

    const response = await request(app)
      .post('/api/v1/management/consultations')
      .set('Authorization', 'Bearer test-token')
      .set('Idempotency-Key', 'create-consultation-1')
      .send({ intendedEmail: 'couple@example.com', displayName: 'Minh and An' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ data: { consultationId, revision: 1 } });
    expect(createConsultation).toHaveBeenCalledWith(
      expect.objectContaining({
        intendedEmail: 'couple@example.com',
        managerAccountId: '00000000-0000-4000-8000-000000000010',
      }),
    );
  });

  it('rejects unknown write properties before executing the command', async () => {
    const createConsultation = vi.fn().mockResolvedValue({ consultationId, revision: 1 });
    const app = appWith({ createConsultation });

    const response = await request(app)
      .post('/api/v1/management/consultations')
      .set('Authorization', 'Bearer test-token')
      .set('Idempotency-Key', 'create-consultation-2')
      .send({ intendedEmail: 'couple@example.com', displayName: 'Minh and An', role: 'MANAGER' });

    expect(response.status).toBe(422);
    expect(createConsultation).not.toHaveBeenCalled();
  });
});

function appWith(
  overrides: Partial<BookingLifecycleHttpServices>,
  auditProtectedDenial?: CreateBookingLifecycleRouterOptions['auditProtectedDenial'],
): ReturnType<typeof createApp> {
  const unused = () => Promise.reject(new Error('unused'));
  const services: BookingLifecycleHttpServices = {
    resolveActor: {
      resolve: () =>
        Promise.resolve({
          accountId: '00000000-0000-4000-8000-000000000010',
          sessionId: '00000000-0000-4000-8000-000000000011',
          displayEmail: 'manager@example.com',
          roles: ['MANAGER'],
        }),
    },
    createConsultation: unused,
    requestWorkspaceInvitation: unused,
    checkAvailability: unused,
    createBooking: unused,
    acquireSlotHold: unused,
    getProposal: unused,
    saveTimeline: unused,
    approveTimeline: unused,
    withdrawTimeline: unused,
    requestChange: unused,
    requestCancellation: unused,
    decideCancellation: unused,
    cancel: unused,
    complete: unused,
    ...overrides,
  };
  return createApp({
    registerRoutes: (app) => {
      app.use(
        '/api/v1',
        createBookingLifecycleRouter({
          services,
          ...(auditProtectedDenial === undefined ? {} : { auditProtectedDenial }),
          createIdempotencyHandler: () =>
            ((_request, _response, next) => next()) satisfies RequestHandler,
        }),
      );
    },
  });
}
