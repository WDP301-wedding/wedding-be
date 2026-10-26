import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { createConsultationWorkspaceRouter } from './consultation-workspace.router.js';

const consultationId = '00000000-0000-4000-8000-000000000001';
const bookingId = '00000000-0000-4000-8000-000000000002';
const accountId = '00000000-0000-4000-8000-000000000003';
function fixture(roles: ('MANAGER' | 'COUPLE')[] = ['MANAGER']) {
  const db = { consultation: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) } };
  const app = createApp({
    runtimeEnvironment: 'test',
    registerRoutes(server) {
      server.use(
        '/api/v1/management',
        createConsultationWorkspaceRouter(db as unknown as PrismaClient, {
          resolve: () =>
            Promise.resolve({
              accountId,
              sessionId: bookingId,
              displayEmail: 'manager@example.test',
              roles,
            }),
        }),
      );
    },
  });
  return { app, db };
}
const root = '/api/v1/management';
describe('manager consultation resume and contact reuse', () => {
  it.each([null, { id: bookingId, phase: 'DRAFT' }])(
    'resolves the saved booking and independent intake choices: %j',
    async (booking) => {
      const { app, db } = fixture();
      db.consultation.findFirst.mockResolvedValue({
        id: consultationId,
        revision: 4,
        displayName: 'Lan',
        intendedEmail: 'lan@example.test',
        note: 'Ghi chú',
        booking,
        intakeRequest: {
          preferredDate: new Date('2026-12-20'),
          expectedGuests: 120,
          preferredHallId: accountId,
          preferredMenuVersionId: bookingId,
          preferredShift: 'LUNCH',
        },
      });
      const result = await request(app)
        .get(`${root}/consultations/${consultationId}/workspace`)
        .set('Authorization', 'Bearer token');
      expect(result.status).toBe(200);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body as unknown).toMatchObject({
        data: {
          consultationId,
          revision: 4,
          bookingId: booking?.id ?? null,
          preferredHallId: accountId,
          preferredMenuVersionId: bookingId,
          preferredShift: 'LUNCH',
          preferredDate: '2026-12-20',
        },
      });
      expect(db.consultation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: consultationId, managerAccountId: accountId } }),
      );
    },
  );
  it('conceals a missing or foreign consultation instead of offering creation', async () => {
    const { app, db } = fixture();
    db.consultation.findFirst.mockResolvedValue(null);
    expect(
      (
        await request(app)
          .get(`${root}/consultations/${consultationId}/workspace`)
          .set('Authorization', 'Bearer token')
      ).status,
    ).toBe(404);
  });
  it('denies customer search and resume to a couple without reading contacts', async () => {
    const { app, db } = fixture(['COUPLE']);
    for (const url of [
      `/consultations/${consultationId}/workspace`,
      '/consultation-customers?q=Lan',
    ])
      expect(
        (
          await request(app)
            .get(root + url)
            .set('Authorization', 'Bearer token')
        ).status,
      ).toBe(403);
    expect(db.consultation.findFirst).not.toHaveBeenCalled();
    expect(db.consultation.findMany).not.toHaveBeenCalled();
  });
  it('searches only owned contacts with a bounded result and never writes access', async () => {
    const { app, db } = fixture();
    db.consultation.findMany.mockResolvedValue([
      { id: consultationId, displayName: 'Lan', intendedEmail: 'lan@example.test' },
    ]);
    const result = await request(app)
      .get(`${root}/consultation-customers?q=Lan`)
      .set('Authorization', 'Bearer token');
    expect(result.status).toBe(200);
    expect(result.body as unknown).toEqual({
      data: [{ consultationId, displayName: 'Lan', email: 'lan@example.test' }],
    });
    expect(db.consultation.findMany.mock.calls).toMatchObject([
      [{ where: { managerAccountId: accountId }, take: 15, distinct: ['intendedEmailNormalized'] }],
    ]);
  });
});
