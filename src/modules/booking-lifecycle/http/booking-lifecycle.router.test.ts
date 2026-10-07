import type { RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app.js';
import {
  createBookingLifecycleRouter,
  type BookingLifecycleHttpServices,
} from './booking-lifecycle.router.js';

const consultationId = '00000000-0000-4000-8000-000000000001';

describe('BookingLifecycleRouter', () => {
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

function appWith(overrides: Partial<BookingLifecycleHttpServices>): ReturnType<typeof createApp> {
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
          createIdempotencyHandler: () =>
            ((_request, _response, next) => next()) satisfies RequestHandler,
        }),
      );
    },
  });
}
