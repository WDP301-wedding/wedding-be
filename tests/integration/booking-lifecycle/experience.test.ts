import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { createBookingExperienceRouter } from '../../../src/modules/booking-lifecycle/http/experience.router.js';
import { createAccountSettingsRouter } from '../../../src/modules/identity-access/account/settings.router.js';
import {
  hashPassword,
  verifyPassword,
} from '../../../src/modules/identity-access/crypto/password.js';
import type { AuthenticatedActor } from '../../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import { AppError } from '../../../src/core/errors/app-error.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';

const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
suite('post-booking experience persistence and authority', () => {
  const db = new CatalogTestDatabase('experience');
  const managerId = randomUUID(),
    otherId = randomUUID(),
    sessionId = randomUUID();
  const actor: AuthenticatedActor = {
    accountId: managerId,
    displayEmail: 'manager@example.com',
    roles: ['MANAGER'],
    sessionId,
  };
  const resolver = {
    resolve(token: string) {
      if (token !== 'test-manager')
        throw new AppError({
          status: 401,
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required.',
        });
      return Promise.resolve(actor);
    },
  };
  const policy = {
    minimumCharacters: 12,
    maximumCharacters: 128,
    maximumBytes: 512,
    scrypt: {
      cost: 1024,
      blockSize: 8,
      parallelization: 1,
      keyLengthBytes: 32,
      maxMemoryBytes: 67108864,
    },
  };
  const crypto = {
    hash: (password: string) => hashPassword(password, policy),
    verify: (password: string, verifier: unknown) => verifyPassword(password, verifier, policy),
  };
  const body = {
    submissionId: randomUUID(),
    displayName: 'Lan & Minh',
    email: 'lan@example.com',
    phone: '0901234567',
    preferredDate: '2026-12-20',
    expectedGuests: 200,
    message: 'Tư vấn sảnh và thực đơn',
  };
  beforeAll(async () => {
    await db.connect();
    await db.prisma.account.createMany({
      data: [
        { id: managerId, emailNormalized: actor.displayEmail, displayEmail: actor.displayEmail },
        { id: otherId, emailNormalized: 'other@example.com', displayEmail: 'other@example.com' },
      ],
    });
    const verifier = await crypto.hash('initial-password-123');
    await db.prisma.passwordCredential.create({
      data: {
        accountId: managerId,
        algorithm: verifier.algorithm,
        version: verifier.version,
        ...verifier.parameters,
        saltEncoded: verifier.saltEncoded,
        derivedKeyEncoded: verifier.derivedKeyEncoded,
      },
    });
    await db.prisma.session.create({
      data: {
        id: sessionId,
        accountId: managerId,
        clientKind: 'WEB',
        refreshFamilyId: randomUUID(),
        idleExpiresAt: new Date(Date.now() + 86400_000),
        absoluteExpiresAt: new Date(Date.now() + 86400_000),
      },
    });
  }, 60_000);
  afterAll(() => db.disconnect());
  const app = () =>
    createApp({
      runtimeEnvironment: 'test',
      registerRoutes(server) {
        server.use('/api/v1', createBookingExperienceRouter(db.prisma, resolver));
        server.use('/api/v1', createAccountSettingsRouter(db.prisma, resolver, crypto));
      },
    });

  it('acks retries privately and rejects changed payload under the same submission', async () => {
    const server = app();
    expect((await request(server).post('/api/v1/consultation-requests').send(body)).body).toEqual({
      data: { accepted: true },
    });
    expect((await request(server).post('/api/v1/consultation-requests').send(body)).status).toBe(
      202,
    );
    expect(
      (
        await request(server)
          .post('/api/v1/consultation-requests')
          .send({ ...body, message: 'changed' })
      ).status,
    ).toBe(409);
    expect(
      await db.prisma.consultationRequest.count({ where: { submissionId: body.submissionId } }),
    ).toBe(1);
    expect((await request(server).get('/api/v1/management/consultation-requests')).status).toBe(
      401,
    );
  });
  it('serializes concurrent conversions into exactly one consultation', async () => {
    const item = await db.prisma.consultationRequest.findUniqueOrThrow({
      where: { submissionId: body.submissionId },
    });
    const server = app();
    const results = await Promise.all(
      [1, 2].map(() =>
        request(server)
          .post(`/api/v1/management/consultation-requests/${item.id}/conversion`)
          .set('Authorization', 'Bearer test-manager')
          .send({}),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    expect(await db.prisma.consultation.count({ where: { intendedEmail: body.email } })).toBe(1);
    expect(
      (
        await request(server)
          .post(`/api/v1/management/consultation-requests/${item.id}/closure`)
          .set('Authorization', 'Bearer test-manager')
          .send({})
      ).status,
    ).toBe(409);
  });
  it('updates only own profile with optimistic concurrency', async () => {
    const server = app();
    expect(
      (
        await request(server)
          .patch('/api/v1/auth/profile')
          .set('Authorization', 'Bearer test-manager')
          .send({ displayName: 'Người quản lý', expectedRevision: 1 })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(server)
          .patch('/api/v1/auth/profile')
          .set('Authorization', 'Bearer test-manager')
          .send({ displayName: 'stale', expectedRevision: 1 })
      ).status,
    ).toBe(409);
    expect(
      (await db.prisma.account.findUniqueOrThrow({ where: { id: otherId } })).displayName,
    ).toBeNull();
  });
  it('refuses wrong current password and atomically revokes sessions on success', async () => {
    const server = app();
    expect(
      (
        await request(server)
          .post('/api/v1/auth/password-changes')
          .set('Authorization', 'Bearer test-manager')
          .send({ currentPassword: 'wrong', newPassword: 'replacement-password-123' })
      ).status,
    ).toBe(422);
    expect((await db.prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe(
      'ACTIVE',
    );
    expect(
      (
        await request(server)
          .post('/api/v1/auth/password-changes')
          .set('Authorization', 'Bearer test-manager')
          .send({
            currentPassword: 'initial-password-123',
            newPassword: 'replacement-password-123',
          })
      ).status,
    ).toBe(200);
    expect((await db.prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe(
      'REVOKED',
    );
    expect(
      (
        await request(server)
          .patch('/api/v1/auth/profile')
          .set('Authorization', 'Bearer test-manager')
          .send({ displayName: 'after revocation', expectedRevision: 2 })
      ).status,
    ).toBe(401);
    const audits = JSON.stringify(
      await db.prisma.auditLog.findMany({ where: { actorId: managerId } }),
    );
    expect(audits).not.toContain('initial-password');
    expect(audits).not.toContain('replacement-password');
  });
});
