import { otpRequestResponseSchema } from '../../../src/modules/identity-access/password-otp/password-otp.schemas.js';
import { createPasswordOtpService } from '../../../src/modules/identity-access/password-otp/password-otp.service.js';
import { createPasswordOtpRouter } from '../../../src/modules/identity-access/password-otp/password-otp.router.js';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { createBookingExperienceRouter } from '../../../src/modules/booking-lifecycle/http/experience.router.js';
import { createAccountSettingsRouter } from '../../../src/modules/identity-access/account/settings.router.js';
import { purgeConsultationIntake } from '../../../src/modules/booking-lifecycle/application/intake-retention.js';
import { overviewResponseSchema } from '../../../src/modules/booking-lifecycle/http/experience.schemas.js';
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
      if (token === 'test-other')
        return Promise.resolve({ ...actor, accountId: otherId, roles: ['COUPLE'] as const });
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
  let otp: ReturnType<typeof createPasswordOtpService>;
  let deliveredCode = '';
  beforeAll(async () => {
    await db.connect();
    otp = createPasswordOtpService({
      prisma: db.prisma,
      passwordCrypto: crypto,
      hashKey: 'a'.repeat(64),
      emailEnabled: true,
      emailProvider: {
        send(command) {
          deliveredCode = command.text.match(/\b\d{6}\b/u)![0];
          return Promise.resolve({
            idempotencyKey: command.idempotencyKey,
            messageId: randomUUID(),
          });
        },
      },
    });
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
        server.use('/api/v1', createPasswordOtpRouter(otp, resolver));
        server.use('/api/v1', createAccountSettingsRouter(db.prisma, resolver, otp));
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
  it('lists owned pre-deposit and confirmed bookings equally on Web and Android', async () => {
    const ids: string[] = [];
    for (const [owner, level, phase] of [
      [managerId, 'RESTRICTED', 'DRAFT'],
      [managerId, 'FULL', 'CONFIRMED'],
      [otherId, 'FULL', 'CONFIRMED'],
      [managerId, 'RESTRICTED', 'AWAITING_DEPOSIT'],
      [managerId, 'RESTRICTED', 'CANCELLED'],
      [managerId, 'FULL', 'COMPLETED'],
    ] as const) {
      const consultationId = randomUUID(),
        bookingId = randomUUID();
      ids.push(bookingId);
      await db.prisma.consultation.create({
        data: {
          id: consultationId,
          managerAccountId: managerId,
          intendedEmail: 'scope@example.com',
          intendedEmailNormalized: 'scope@example.com',
          displayName: 'Scope',
        },
      });
      await db.prisma.booking.create({
        data: {
          id: bookingId,
          consultationId,
          hallId: randomUUID(),
          eventDate: new Date('2026-12-20'),
          shiftCode: 'DINNER',
          phase,
          planningHeadcount: 100,
        },
      });
      await db.prisma.consultationAccess.create({
        data: {
          accountId: owner,
          consultationId,
          level,
          ...(level === 'FULL'
            ? { bookingId, promotedAt: new Date(), sourcePaymentId: randomUUID() }
            : {}),
        },
      });
    }
    const server = app();
    const web = await request(server)
      .get('/api/v1/couple/bookings?client=WEB')
      .set('Authorization', 'Bearer test-manager');
    expect(web.status).toBe(200);
    expect(overviewResponseSchema.parse(web.body).data).toHaveLength(5);
    expect(JSON.stringify(web.body)).not.toContain(ids[2]);
    const native = await request(server)
      .get('/api/v1/couple/bookings?client=ANDROID')
      .set('Authorization', 'Bearer test-manager');
    expect(native.status).toBe(200);
    const nativePage = overviewResponseSchema.parse(native.body);
    expect(nativePage).toEqual(overviewResponseSchema.parse(web.body));
    expect(nativePage.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bookingId: ids[0], phase: 'DRAFT', accessLevel: 'RESTRICTED' }),
        expect.objectContaining({ bookingId: ids[1], phase: 'CONFIRMED', accessLevel: 'FULL' }),
      ]),
    );
    expect(JSON.stringify(native.body)).not.toContain(ids[2]);
    const pagedIds: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await request(server)
        .get('/api/v1/couple/bookings?client=ANDROID&limit=2' + (cursor ? `&cursor=${cursor}` : ''))
        .set('Authorization', 'Bearer test-manager');
      expect(page.status).toBe(200);
      const parsed = overviewResponseSchema.parse(page.body);
      pagedIds.push(...parsed.data.map((item) => item.bookingId));
      cursor = parsed.nextCursor;
    } while (cursor !== null && pagedIds.length < 10);
    expect(pagedIds).toEqual(nativePage.data.map((item) => item.bookingId));
    expect(
      (
        await request(server)
          .get('/api/v1/management/consultation-requests')
          .set('Authorization', 'Bearer test-other')
      ).status,
    ).toBe(403);
  });
  it('purges expired requests and scrubs converted contact data without deleting consultations', async () => {
    const oldDate = new Date(Date.now() - 181 * 86400_000);
    const expired = await db.prisma.consultationRequest.create({
      data: {
        ...body,
        submissionId: randomUUID(),
        preferredDate: null,
        payloadHash: 'hash',
        createdAt: oldDate,
      },
    });
    const converted = await db.prisma.consultationRequest.findUniqueOrThrow({
      where: { submissionId: body.submissionId },
    });
    await db.prisma.consultationRequest.update({
      where: { id: converted.id },
      data: { createdAt: oldDate },
    });
    expect(await purgeConsultationIntake(db.prisma)).toEqual({ deleted: 1, scrubbed: 1 });
    expect(
      await db.prisma.consultationRequest.findUnique({ where: { id: expired.id } }),
    ).toBeNull();
    const retained = await db.prisma.consultationRequest.findUniqueOrThrow({
      where: { id: converted.id },
    });
    expect(retained.email).toBe('');
    expect(retained.phone).toBe('');
    expect(retained.message).toBe('');
    expect(await db.prisma.consultation.count({ where: { id: converted.consultationId! } })).toBe(
      1,
    );
    expect(await purgeConsultationIntake(db.prisma)).toEqual({ deleted: 0, scrubbed: 0 });
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
    const challenge = await request(server)
      .post('/api/v1/auth/password-change-otp-requests')
      .set('Authorization', 'Bearer test-manager')
      .send({ currentPassword: 'initial-password-123' });
    expect(challenge.status).toBe(202);
    expect(
      (
        await request(server)
          .post('/api/v1/auth/password-changes')
          .set('Authorization', 'Bearer test-manager')
          .send({
            challengeId: otpRequestResponseSchema.parse(challenge.body).data.challengeId,
            code: deliveredCode,
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
