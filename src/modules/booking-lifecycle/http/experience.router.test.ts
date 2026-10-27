import { createHash } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { AuthenticatedActor } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { createBookingExperienceRouter } from './experience.router.js';
import { consultationRequestBodySchema, overviewResponseSchema } from './experience.schemas.js';

const id = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const consultationId = '00000000-0000-4000-8000-000000000003';
const actor: AuthenticatedActor = {
  accountId: '00000000-0000-4000-8000-000000000004',
  sessionId: '00000000-0000-4000-8000-000000000005',
  displayEmail: 'manager@example.com',
  roles: ['MANAGER'],
};
const intake = {
  submissionId: id,
  displayName: 'Lan',
  email: 'lan@example.com',
  phone: '0901234567',
  preferredDate: null,
  expectedGuests: 200,
  message: 'Tư vấn sảnh',
};
function record() {
  return {
    ...intake,
    brideName: null,
    groomName: null,
    id,
    createdAt: new Date(),
    status: 'NEW',
    consultationId: null,
    consultation: null as { revision: number; managerAccountId: string } | null,
    payloadHash: createHash('sha256').update(JSON.stringify(intake)).digest('hex'),
  };
}

function fixture(currentActor = actor) {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    consultationRequest: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(record()),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: secondId }),
      groupBy: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    consultation: { create: vi.fn().mockResolvedValue({ id: consultationId }) },
    hall: { findFirst: vi.fn().mockResolvedValue({ id: secondId }) },
    menuPackage: { findFirst: vi.fn().mockResolvedValue({ id: secondId }) },
    consultationAccess: {
      findMany: vi.fn().mockResolvedValue([{ consultationId, level: 'FULL' }]),
    },
    booking: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...db,
    $transaction: async (run: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      run(db as unknown as Prisma.TransactionClient),
  } as unknown as PrismaClient;
  const app = createApp({
    runtimeEnvironment: 'test',
    registerRoutes(server) {
      server.use(
        '/api/v1',
        createBookingExperienceRouter(prisma, { resolve: () => Promise.resolve(currentActor) }),
      );
    },
  });
  return { app, db };
}
const management = '/api/v1/management/consultation-requests';

describe('booking intake and couple overview HTTP contract', () => {
  it('returns an empty overview without querying bookings when the actor has no grants', async () => {
    const { app, db } = fixture();
    db.consultationAccess.findMany.mockResolvedValue([]);
    const response = await request(app)
      .get('/api/v1/couple/bookings')
      .set('Authorization', 'Bearer token');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [], nextCursor: null });
    expect(db.booking.findMany).not.toHaveBeenCalled();
  });
  it('acknowledges a new intake privately and records one system audit', async () => {
    const { app, db } = fixture();
    const response = await request(app).post('/api/v1/consultation-requests').send(intake);
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ data: { accepted: true } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(db.consultationRequest.createMany.mock.calls).toMatchObject([
      [{ data: { preferredDate: null } }],
    ]);
    expect(db.auditLog.create).toHaveBeenCalledOnce();
  });

  it('accepts identical retries without duplicating audit and rejects a changed payload', async () => {
    const { app, db } = fixture();
    db.consultationRequest.findUnique.mockResolvedValue(record());
    db.consultationRequest.createMany.mockResolvedValue({ count: 0 });
    expect((await request(app).post('/api/v1/consultation-requests').send(intake)).status).toBe(
      202,
    );
    const conflict = await request(app)
      .post('/api/v1/consultation-requests')
      .send({ ...intake, message: 'changed' });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: { code: 'SUBMISSION_KEY_REUSED' } });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('persists both independent catalog choices and the selected shift', async () => {
    const { app, db } = fixture();
    const body = {
      ...intake,
      preferredHallId: id,
      preferredMenuVersionId: secondId,
      preferredShift: 'LUNCH',
    };
    db.consultationRequest.findUniqueOrThrow.mockResolvedValue({
      ...record(),
      payloadHash: createHash('sha256')
        .update(JSON.stringify(consultationRequestBodySchema.parse(body)))
        .digest('hex'),
    });
    const response = await request(app).post('/api/v1/consultation-requests').send(body);
    expect(response.status).toBe(202);
    expect(db.consultationRequest.createMany.mock.calls).toMatchObject([
      [
        {
          data: { preferredHallId: id, preferredMenuVersionId: secondId, preferredShift: 'LUNCH' },
        },
      ],
    ]);
  });

  it('rejects a retired selection without writing an intake', async () => {
    const { app, db } = fixture();
    db.hall.findFirst.mockResolvedValue(null);
    const response = await request(app)
      .post('/api/v1/consultation-requests')
      .send({ ...intake, preferredHallId: id });
    expect(response.status).toBe(422);
    expect(db.consultationRequest.createMany).not.toHaveBeenCalled();
  });

  it('does not expose management intake to a couple', async () => {
    const { app, db } = fixture({ ...actor, roles: ['COUPLE'] });
    const response = await request(app).get(management).set('Authorization', 'Bearer token');
    expect(response.status).toBe(403);
    expect(db.consultationRequest.findMany).not.toHaveBeenCalled();
  });

  it('paginates intake and preserves stored preferred dates and consultation revisions', async () => {
    const { app, db } = fixture();
    const first = {
      ...record(),
      preferredDate: new Date('2020-01-01T00:00:00Z'),
      consultationId,
      consultation: { revision: 3 },
    };
    db.consultationRequest.findMany.mockResolvedValue([first, { ...record(), id: secondId }]);
    const response = await request(app)
      .get(`${management}?limit=1&cursor=${secondId}`)
      .set('Authorization', 'Bearer token');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [{ id, preferredDate: '2020-01-01', consultationRevision: 3 }],
      nextCursor: id,
    });
    expect(db.consultationRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: secondId }, skip: 1, take: 2 }),
    );
  });

  it('returns null optional intake details and no cursor at the end of a list', async () => {
    const { app, db } = fixture();
    db.consultationRequest.findMany.mockResolvedValue([record()]);
    const response = await request(app).get(management).set('Authorization', 'Bearer token');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [{ preferredDate: null, consultationRevision: null }],
      nextCursor: null,
    });
    expect(db.consultationRequest.findMany.mock.calls[0]![0]).not.toHaveProperty('cursor');
  });

  it.each([
    { item: null, code: 'CONSULTATION_REQUEST_NOT_FOUND', status: 404, label: 'missing' },
    {
      item: { ...record(), createdAt: new Date(0) },
      code: 'CONSULTATION_REQUEST_NOT_FOUND',
      status: 404,
      label: 'expired',
    },
    {
      item: { ...record(), status: 'CLOSED' },
      code: 'CONSULTATION_REQUEST_CLOSED',
      status: 409,
      label: 'closed',
    },
    {
      item: { ...record(), status: 'CONVERTED', consultation: { managerAccountId: secondId } },
      code: 'CONSULTATION_REQUEST_NOT_FOUND',
      status: 404,
      label: 'owned by another manager',
    },
    {
      item: { ...record(), status: 'CONVERTED', consultation: null },
      code: 'CONSULTATION_REQUEST_NOT_FOUND',
      status: 404,
      label: 'without an owning consultation',
    },
  ])('rejects conversion of an intake that is $label', async ({ item, code, status }) => {
    const { app, db } = fixture();
    db.consultationRequest.findUnique.mockResolvedValue(item);
    const response = await request(app)
      .post(`${management}/${id}/conversion`)
      .set('Authorization', 'Bearer token')
      .send({});
    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({ error: { code } });
    expect(db.consultation.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns the existing consultation on a conversion retry by its owner', async () => {
    const { app, db } = fixture();
    db.consultationRequest.findUnique.mockResolvedValue({
      ...record(),
      status: 'CONVERTED',
      consultationId,
      consultation: { managerAccountId: actor.accountId },
    });
    const response = await request(app)
      .post(`${management}/${id}/conversion`)
      .set('Authorization', 'Bearer token')
      .send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { consultationId } });
    expect(db.consultation.create).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['', 'Tư vấn sảnh'])('converts new intake and preserves note %j', async (message) => {
    const { app, db } = fixture();
    db.consultationRequest.findUnique.mockResolvedValue({ ...record(), message });
    const response = await request(app)
      .post(`${management}/${id}/conversion`)
      .set('Authorization', 'Bearer token')
      .send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { consultationId } });
    expect(db.consultation.create.mock.calls).toMatchObject([
      [{ data: { managerAccountId: actor.accountId, note: message || null } }],
    ]);
    expect(db.consultationRequest.update).toHaveBeenCalledWith({
      where: { id },
      data: { status: 'CONVERTED', consultationId },
    });
    expect(db.auditLog.create).toHaveBeenCalledOnce();
  });

  it.each([0, 1])('audits closure only when one open intake changed (count %s)', async (count) => {
    const { app, db } = fixture();
    db.consultationRequest.updateMany.mockResolvedValue({ count });
    const response = await request(app)
      .post(`${management}/${id}/closure`)
      .set('Authorization', 'Bearer token')
      .send({});
    expect(response.status).toBe(count === 1 ? 200 : 409);
    expect(db.consultationRequest.updateMany).toHaveBeenCalledWith({
      where: { id, status: { in: ['NEW', 'CLOSED'] } },
      data: { status: 'CLOSED' },
    });
    expect(db.auditLog.create).toHaveBeenCalledTimes(count);
    if (count === 1) expect(response.body).toEqual({ data: { consultationId: null } });
    else expect(response.body).toMatchObject({ error: { code: 'CONSULTATION_REQUEST_NOT_OPEN' } });
  });

  it.each(['WEB', 'ANDROID'] as const)(
    'scopes %s overview to actor grants and paginates bookings',
    async (client) => {
      const { app, db } = fixture();
      const booking = {
        id,
        consultationId,
        eventDate: new Date('2026-12-20T00:00:00Z'),
        consultation: { brideName: 'Lan', groomName: 'Minh' },
        phase: 'CONFIRMED',
        shiftCode: 'DINNER',
        planningHeadcount: 200,
        proposalSnapshot: { hallName: 'Sảnh vườn' },
        currentTimelineRevision: { managerApprovedAt: new Date(), coupleApprovedAt: null },
      };
      db.booking.findMany.mockResolvedValue([booking, { ...booking, id: secondId }]);
      const response = await request(app)
        .get(`/api/v1/couple/bookings?client=${client}&limit=1&cursor=${secondId}`)
        .set('Authorization', 'Bearer token');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        data: [
          {
            bookingId: id,
            accessLevel: 'FULL',
            hallName: 'Sảnh vườn',
            hasTimeline: true,
            managerApproved: true,
            coupleApproved: false,
          },
        ],
        nextCursor: id,
      });
      expect(db.consultationAccess.findMany).toHaveBeenCalledWith({
        where: { accountId: actor.accountId },
        select: { consultationId: true, level: true },
      });
      expect(db.booking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            consultationId: { in: [consultationId] },
          },
          cursor: { id: secondId },
          skip: 1,
        }),
      );
    },
  );

  it.each(['WEB', 'ANDROID'] as const)(
    'preserves nullable couple names in the %s overview without failing other bookings',
    async (client) => {
      const { app, db } = fixture();
      const profiles = [
        { brideName: null, groomName: null },
        { brideName: 'Lan', groomName: null },
        { brideName: null, groomName: 'Minh' },
        { brideName: 'Lan', groomName: 'Minh' },
      ];
      db.booking.findMany.mockResolvedValue(
        profiles.map((consultation, index) => ({
          id: `00000000-0000-4000-8000-00000000000${index + 1}`,
          consultationId,
          eventDate: new Date('2026-12-20T00:00:00Z'),
          consultation,
          phase: 'DRAFT',
          shiftCode: 'LUNCH',
          planningHeadcount: 200,
          revision: 1,
          eventType: 'WEDDING',
          alias: null,
          proposalSnapshot: null,
          depositSettlement: null,
          currentTimelineRevision: null,
        })),
      );
      const response = await request(app)
        .get(`/api/v1/couple/bookings?client=${client}&limit=50`)
        .set('Authorization', 'Bearer token');
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = overviewResponseSchema.parse(response.body);
      expect(body.data).toHaveLength(profiles.length);
      profiles.forEach((profile, index) => {
        expect(body.data[index]).toMatchObject(profile);
      });
      expect(body.nextCursor).toBeNull();
    },
  );

  it('handles absent snapshot and timeline while exposing approval states only when present', async () => {
    const { app, db } = fixture();
    const booking = {
      id,
      consultationId,
      eventDate: new Date('2026-12-20T00:00:00Z'),
      consultation: { brideName: 'Lan', groomName: 'Minh' },
      phase: 'DRAFT',
      shiftCode: 'LUNCH',
      planningHeadcount: 200,
      proposalSnapshot: null,
      currentTimelineRevision: null,
    };
    db.booking.findMany.mockResolvedValue([
      booking,
      {
        ...booking,
        id: secondId,
        currentTimelineRevision: { managerApprovedAt: null, coupleApprovedAt: new Date() },
      },
    ]);
    const response = await request(app)
      .get('/api/v1/couple/bookings')
      .set('Authorization', 'Bearer token');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [
        { hallName: '', hasTimeline: false, managerApproved: false, coupleApproved: false },
        { hasTimeline: true, managerApproved: false, coupleApproved: true },
      ],
      nextCursor: null,
    });
    expect(db.booking.findMany.mock.calls[0]![0]).not.toHaveProperty('cursor');
  });
});
