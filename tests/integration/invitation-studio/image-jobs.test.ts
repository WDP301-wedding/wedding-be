import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';
import { createGeneratedAiImage } from '../../../src/integrations/ai-image/ai-image-provider.js';
import { ProviderError } from '../../../src/core/errors/app-error.js';
import { createInvitationStudioServices } from '../../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import express from 'express';
import request from 'supertest';
import { createStudioRouter } from '../../../src/modules/invitation-studio/http/studio.router.js';
import { createErrorHandler } from '../../../src/core/errors/error-handler.js';
import { ImageJobsService } from '../../../src/modules/invitation-studio/infrastructure/image-jobs.service.js';
import {
  imageJobResponse,
  imageJobListResponse,
} from '../../../src/modules/invitation-studio/domain/image-jobs.js';
import { mediaAssetResponseSchema } from '../../../src/modules/invitation-studio/http/media.schemas.js';
import pino from 'pino';
import { Client } from 'pg';

const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
suite('Durable invitation image jobs', { timeout: 15000 }, () => {
  const db = new CatalogTestDatabase('image_jobs');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect(), 60000);
  beforeEach(async () => {
    // The dispatcher intentionally scans the entire test database. Close previous
    // synthetic unfinished jobs so each case owns the next dispatch candidate.
    await db.prisma.invitationImageJob.updateMany({
      where: { status: { in: ['QUEUED', 'RUNNING', 'RECOVERY_REQUIRED'] } },
      data: {
        status: 'FAILED',
        errorCode: 'FIXTURE_CLOSED',
        prompt: null,
        claimToken: null,
        claimExpiresAt: null,
      },
    });
  });
  async function setup() {
    const f = await studioFixture(db.prisma);
    const provider = {
      generate: vi.fn(() => Promise.resolve(createGeneratedAiImage(f.bytes, 'image/png'))),
    };
    const services = createInvitationStudioServices(
      db.prisma,
      f.storage.provider,
      provider,
      null,
      () => f.now,
    );
    const command = {
      bookingId: f.bookingId,
      prompt: 'Wedding garden',
      aspectRatio: '1:1',
      idempotencyKey: randomUUID(),
    };
    return { f, provider, services, command };
  }
  it('persists before dispatch, replays current state, rejects changed bodies and lists completed results', async () => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    expect(job.status).toBe('QUEUED');
    expect(provider.generate).not.toHaveBeenCalled();
    expect((await services.imageJobs.enqueue(command, f.couple)).jobId).toBe(job.jobId);
    await expect(
      services.imageJobs.enqueue({ ...command, prompt: 'Another garden' }, f.couple),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await services.imageJobs.runNext();
    const result = await services.imageJobs.read(f.bookingId, job.jobId, f.couple);
    expect(result.status).toBe('SUCCEEDED');
    if (result.status !== 'SUCCEEDED') throw new Error('Expected accepted assets');
    expect(result.result.mediaAssetId).toBeTypeOf('string');
    expect(result.result.derivedAssetId).toBeTypeOf('string');
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect((await services.imageJobs.enqueue(command, f.couple)).status).toBe('SUCCEEDED');
    expect((await services.imageJobs.list(f.bookingId, {}, f.couple)).items).toContainEqual(result);
    const row = await db.prisma.invitationImageJob.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(row.prompt).toBeNull();
    expect(JSON.stringify(result)).not.toContain(command.prompt);
    expect(JSON.stringify(row)).not.toContain(f.couple.accessToken);
  });
  it('retains unknown outcomes and a recovery attempt never invokes Gemini twice', async () => {
    const { f, provider, services, command } = await setup();
    provider.generate.mockRejectedValueOnce(new ProviderError('timeout'));
    const job = await services.imageJobs.enqueue(command, f.couple);
    await services.imageJobs.runNext();
    expect(await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).toMatchObject({
      status: 'RECOVERY_REQUIRED',
      errorCode: 'PROVIDER_TIMEOUT',
    });
    await services.imageJobs.runNext();
    expect(provider.generate).toHaveBeenCalledTimes(1);
    await services.imageJobs.recover(f.bookingId, job.jobId, randomUUID(), f.couple);
    await services.imageJobs.runNext();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).status).toBe(
      'RECOVERY_REQUIRED',
    );
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('recovers a privately journaled paid output after an acceptance failure and restart', async () => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    const audit = vi
      .spyOn(services.studioRepository, 'audit')
      .mockRejectedValueOnce(new Error('commit interrupted'));
    await services.imageJobs.runNext();
    audit.mockRestore();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).status).toBe(
      'RECOVERY_REQUIRED',
    );
    const recoveryKey = randomUUID();
    await services.imageJobs.recover(f.bookingId, job.jobId, recoveryKey, f.couple);
    await services.imageJobs.recover(f.bookingId, job.jobId, recoveryKey, f.couple);
    const restarted = createInvitationStudioServices(
      db.prisma,
      f.storage.provider,
      provider,
      null,
      () => f.now,
    );
    await restarted.imageJobs.runNext();
    expect((await restarted.imageJobs.read(f.bookingId, job.jobId, f.manager)).status).toBe(
      'SUCCEEDED',
    );
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('retries only derive after its failure without purchasing another image', async () => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    const read = vi
      .spyOn(f.storage.provider, 'read')
      .mockRejectedValueOnce(new ProviderError('timeout'));
    await services.imageJobs.runNext();
    read.mockRestore();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).status).toBe(
      'RECOVERY_REQUIRED',
    );
    await services.imageJobs.recover(f.bookingId, job.jobId, randomUUID(), f.manager);
    await services.imageJobs.runNext();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).status).toBe(
      'SUCCEEDED',
    );
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('keeps a known Storage failure recoverable after AI acceptance', async () => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    const read = vi
      .spyOn(f.storage.provider, 'read')
      .mockRejectedValueOnce(new ProviderError('failure'));
    await services.imageJobs.runNext();
    read.mockRestore();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).status).toBe(
      'RECOVERY_REQUIRED',
    );
    await services.imageJobs.recover(f.bookingId, job.jobId, randomUUID(), f.couple);
    await services.imageJobs.runNext();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).status).toBe(
      'SUCCEEDED',
    );
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('fences concurrent workers and resumes expired claims using the persisted intent', async () => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    let resume!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const gate = new Promise<void>((r) => {
      resume = r;
    });
    provider.generate.mockImplementationOnce(async () => {
      entered();
      await gate;
      return createGeneratedAiImage(f.bytes, 'image/png');
    });
    const running = services.imageJobs.runNext();
    await ready;
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).status).toBe(
      'RUNNING',
    );
    expect(await services.imageJobs.runNext()).toBe(false);
    // Simulate a new dispatcher taking over after ownership is lost. The old
    // process must not accept media or overwrite its successor's status.
    await db.prisma.invitationImageJob.update({
      where: { id: job.jobId },
      data: { claimToken: randomUUID() },
    });
    resume();
    await running;
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).status).toBe(
      'RUNNING',
    );
    await db.prisma.invitationImageJob.update({
      where: { id: job.jobId },
      data: { claimExpiresAt: new Date(0) },
    });
    await services.imageJobs.runNext();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).status).toBe(
      'SUCCEEDED',
    );
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it.each([
    'revoked',
    'idle-expired',
    'absolute-expired',
    'disabled',
    'role-removed',
    'access-removed',
    'session-missing',
    'session-reparented',
  ] as const)('denies %s initiating authority before paid dispatch', async (mode) => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    if (mode === 'revoked')
      await db.prisma.session.update({
        where: { id: f.couple.sessionId },
        data: { status: 'REVOKED' },
      });
    if (mode === 'idle-expired')
      await db.prisma.session.update({
        where: { id: f.couple.sessionId },
        data: { idleExpiresAt: new Date(0) },
      });
    if (mode === 'absolute-expired')
      await db.prisma.session.update({
        where: { id: f.couple.sessionId },
        data: {
          createdAt: new Date(f.now.getTime() - 3000),
          idleExpiresAt: new Date(f.now.getTime() - 1000),
          absoluteExpiresAt: new Date(f.now.getTime() - 1000),
        },
      });
    if (mode === 'disabled')
      await db.prisma.account.update({
        where: { id: f.couple.actorId },
        data: { status: 'DISABLED', disabledAt: f.now },
      });
    if (mode === 'role-removed')
      await db.prisma.accountRole.deleteMany({ where: { accountId: f.couple.actorId } });
    if (mode === 'access-removed')
      await db.prisma.consultationAccess.deleteMany({ where: { accountId: f.couple.actorId } });
    if (mode === 'session-missing')
      await db.prisma.invitationImageJob.update({
        where: { id: job.jobId },
        data: { sessionId: randomUUID() },
      });
    if (mode === 'session-reparented')
      await db.prisma.invitationImageJob.update({
        where: { id: job.jobId },
        data: { sessionId: f.manager.sessionId },
      });
    await services.imageJobs.runNext();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.manager)).status).toBe(
      'FAILED',
    );
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('continues past short-lived access credential expiry without storing a bearer', async () => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    await db.prisma.accessCredential.updateMany({
      where: { sessionId: f.couple.sessionId },
      data: {
        createdAt: new Date(f.now.getTime() - 3000),
        expiresAt: new Date(f.now.getTime() - 1000),
      },
    });
    await services.imageJobs.runNext();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.manager)).status).toBe(
      'SUCCEEDED',
    );
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('rechecks revocation after paid work and retains its output without accepting it', async () => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    provider.generate.mockImplementationOnce(async () => {
      await db.prisma.session.update({
        where: { id: f.couple.sessionId },
        data: { status: 'REVOKED' },
      });
      return createGeneratedAiImage(f.bytes, 'image/png');
    });
    await services.imageJobs.runNext();
    expect((await services.imageJobs.read(f.bookingId, job.jobId, f.manager)).status).toBe(
      'FAILED',
    );
    expect(await db.prisma.invitationMediaAsset.count({ where: { bookingId: f.bookingId } })).toBe(
      0,
    );
    expect(
      await db.prisma.invitationMediaUploadAttempt.count({ where: { bookingId: f.bookingId } }),
    ).toBe(1);
  });
  it('preserves evidence-backed Manager abandonment and releases the unresolved-job quota', async () => {
    const { f, provider, services, command } = await setup();
    provider.generate.mockRejectedValueOnce(new ProviderError('timeout'));
    const job = await services.imageJobs.enqueue(command, f.couple);
    await services.imageJobs.runNext();
    const input = {
      bookingId: f.bookingId,
      intentDigest: job.intentDigest,
      outcome: 'ABANDONED',
      evidenceReference: 'job-recovery-reviewed',
      idempotencyKey: randomUUID(),
    };
    await expect(services.generation.reconcile(input, f.couple)).rejects.toMatchObject({
      status: 404,
    });
    await services.generation.reconcile(input, f.manager);
    expect(await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_GENERATION_ABANDONED',
    });
    await expect(
      services.imageJobs.recover(f.bookingId, job.jobId, randomUUID(), f.couple),
    ).rejects.toMatchObject({ code: 'AI_JOB_RECOVERY_UNAVAILABLE' });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('limits unresolved and daily jobs while allowing same-key replay at the limit', async () => {
    const { f, services, command } = await setup();
    await services.imageJobs.enqueue(command, f.couple);
    await services.imageJobs.enqueue({ ...command, idempotencyKey: randomUUID() }, f.couple);
    await services.imageJobs.enqueue(command, f.couple);
    await expect(
      services.imageJobs.enqueue({ ...command, idempotencyKey: randomUUID() }, f.couple),
    ).rejects.toMatchObject({ status: 429 });
    await db.prisma.invitationImageJob.updateMany({
      where: { bookingId: f.bookingId },
      data: { status: 'FAILED', errorCode: 'FIXTURE', prompt: null },
    });
    for (let i = 0; i < 8; i++) {
      const job = await services.imageJobs.enqueue(
        { ...command, idempotencyKey: randomUUID() },
        f.couple,
      );
      await db.prisma.invitationImageJob.update({
        where: { id: job.jobId },
        data: { status: 'FAILED', errorCode: 'FIXTURE', prompt: null },
      });
    }
    await expect(
      services.imageJobs.enqueue({ ...command, idempotencyKey: randomUUID() }, f.couple),
    ).rejects.toMatchObject({ status: 429 });
  });
  it('paginates tied timestamps, denies foreign/missing jobs and current access on populated and empty lists', async () => {
    const { f, services, command } = await setup();
    await services.imageJobs.enqueue(command, f.couple);
    await services.imageJobs.enqueue({ ...command, idempotencyKey: randomUUID() }, f.couple);
    const first = await services.imageJobs.list(f.bookingId, { limit: 1 }, f.couple);
    const second = await services.imageJobs.list(
      f.bookingId,
      { limit: 1, cursor: first.nextCursor },
      f.couple,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.jobId).not.toBe(first.items[0]!.jobId);
    expect(second.nextCursor).toBeNull();
    expect(
      (await services.imageJobs.list(f.bookingId, { cursor: second.items[0]!.jobId }, f.couple))
        .items,
    ).toEqual([]);
    const foreign = await f.actor('COUPLE');
    const staff = await f.actor('STAFF');
    await expect(
      services.imageJobs.read(f.bookingId, first.items[0]!.jobId, foreign),
    ).rejects.toMatchObject({ status: 404 });
    await expect(services.imageJobs.list(f.bookingId, {}, staff)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      services.imageJobs.read(f.bookingId, randomUUID(), f.manager),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      services.imageJobs.list(f.bookingId, { cursor: randomUUID() }, f.manager),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      services.imageJobs.recover(f.bookingId, randomUUID(), randomUUID(), f.manager),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('HTTP enqueues quickly, validates strictly, exposes result polling and leaves synchronous 201 intact', async () => {
    const { f, provider, services, command } = await setup();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.requestId = randomUUID();
      next();
    });
    app.use('/api/v1', createStudioRouter(services, services.identity.resolver));
    app.use(createErrorHandler());
    const path = `/api/v1/bookings/${f.bookingId}/invitation-image-jobs`;
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${f.couple.accessToken}`);
    const body = { prompt: command.prompt, aspectRatio: command.aspectRatio };
    expect((await request(app).post(path).send(body)).status).toBe(401);
    expect((await auth(request(app).post(path)).send(body)).status).toBe(400);
    expect(
      (
        await auth(request(app).post(path))
          .set('Idempotency-Key', randomUUID())
          .send({ ...body, actorId: f.couple.actorId })
      ).status,
    ).toBe(422);
    expect(
      (
        await auth(request(app).post(path + '?force=true'))
          .set('Idempotency-Key', randomUUID())
          .send(body)
      ).status,
    ).toBe(422);
    const queued = await auth(request(app).post(path))
      .set('Idempotency-Key', command.idempotencyKey)
      .send(body);
    expect(queued.status).toBe(202);
    expect(queued.headers['retry-after']).toBe('3');
    const queuedView = imageJobResponse.parse(queued.body).data;
    expect(queued.headers.location).toBe(queuedView.statusPath);
    expect(provider.generate).not.toHaveBeenCalled();
    const statusPath = queuedView.statusPath;
    expect(
      imageJobResponse.parse((await auth(request(app).get(statusPath))).body).data.status,
    ).toBe('QUEUED');
    expect((await auth(request(app).get(statusPath + '?secret=1'))).status).toBe(422);
    expect(
      imageJobListResponse.parse((await auth(request(app).get(path))).body).data.items,
    ).toHaveLength(1);
    provider.generate.mockRejectedValueOnce(new ProviderError('timeout'));
    await services.imageJobs.runNext();
    const recovering = await auth(request(app).post(statusPath + '/recovery'))
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(recovering.status).toBe(202);
    await services.imageJobs.runNext();
    const unresolved = await auth(request(app).get(statusPath));
    expect(imageJobResponse.parse(unresolved.body).data.status).toBe('RECOVERY_REQUIRED');
    expect(unresolved.headers['retry-after']).toBeUndefined();
    expect(unresolved.headers['cache-control']).toBe('no-store');
    expect(
      (
        await auth(request(app).post(statusPath + '/reconciliation'))
          .set('Idempotency-Key', randomUUID())
          .send({ outcome: 'ABANDONED', evidenceReference: 'http-case-reviewed' })
      ).status,
    ).toBe(404);
    const reconciled = await request(app)
      .post(statusPath + '/reconciliation')
      .set('Authorization', `Bearer ${f.manager.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ outcome: 'ABANDONED', evidenceReference: 'http-case-reviewed' });
    expect(reconciled.status).toBe(200);
    expect(imageJobResponse.parse(reconciled.body).data.status).toBe('FAILED');
    const legacy = await auth(
      request(app).post(`/api/v1/bookings/${f.bookingId}/invitation-image-generations`),
    )
      .set('Idempotency-Key', randomUUID())
      .send(body);
    expect(legacy.status).toBe(201);
    expect(mediaAssetResponseSchema.parse(legacy.body).data.mediaAssetId).toBeTypeOf('string');
  });
  it('keeps paid dispatch disabled while expiring operational input and retaining evidence', async () => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    const disabled = new ImageJobsService(services.imageJobs.deps, () => f.now, false);
    await expect(disabled.enqueue(command, f.couple)).rejects.toMatchObject({
      code: 'AI_IMAGE_PROVIDER_DISABLED',
    });
    await expect(
      disabled.recover(f.bookingId, job.jobId, randomUUID(), f.couple),
    ).rejects.toMatchObject({ code: 'AI_IMAGE_PROVIDER_DISABLED' });
    expect(await disabled.runNext()).toBe(false);
    await db.prisma.invitationImageJob.update({
      where: { id: job.jobId },
      data: { inputExpiresAt: new Date(0) },
    });
    await disabled.runNext();
    const row = await db.prisma.invitationImageJob.findUniqueOrThrow({ where: { id: job.jobId } });
    expect(row).toMatchObject({
      prompt: null,
      status: 'FAILED',
      errorCode: 'AI_JOB_INPUT_EXPIRED',
    });
    expect(row.intentDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('clears expired recovery and abandoned-worker inputs while preserving unknown-effect classification', async () => {
    const { f, provider, services, command } = await setup();
    provider.generate.mockRejectedValueOnce(new ProviderError('timeout'));
    const job = await services.imageJobs.enqueue(command, f.couple);
    await services.imageJobs.runNext();
    await db.prisma.invitationImageJob.update({
      where: { id: job.jobId },
      data: { inputExpiresAt: new Date(0) },
    });
    await services.imageJobs.runNext();
    expect(await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).toMatchObject({
      status: 'RECOVERY_REQUIRED',
      errorCode: 'AI_JOB_INPUT_EXPIRED',
    });
    await expect(
      services.imageJobs.recover(f.bookingId, job.jobId, randomUUID(), f.couple),
    ).rejects.toMatchObject({ code: 'AI_JOB_RECOVERY_UNAVAILABLE' });
    const second = await services.imageJobs.enqueue(
      { ...command, idempotencyKey: randomUUID() },
      f.couple,
    );
    await db.prisma.invitationImageJob.update({
      where: { id: second.jobId },
      data: {
        status: 'RUNNING',
        claimToken: randomUUID(),
        claimExpiresAt: new Date(0),
        inputExpiresAt: new Date(0),
      },
    });
    await services.imageJobs.runNext();
    expect(await services.imageJobs.read(f.bookingId, second.jobId, f.couple)).toMatchObject({
      status: 'RECOVERY_REQUIRED',
      errorCode: 'AI_JOB_INPUT_EXPIRED',
    });
  });
  it('never resurrects a Manager-abandoned job when an expiry sweep reads stale state', async () => {
    const { f, provider, services, command } = await setup();
    provider.generate.mockRejectedValueOnce(new ProviderError('timeout'));
    const job = await services.imageJobs.enqueue(command, f.couple);
    await services.imageJobs.runNext();
    await db.prisma.invitationImageJob.update({
      where: { id: job.jobId },
      data: { inputExpiresAt: new Date(0) },
    });
    const table = db.prisma.invitationImageJob;
    const findMany = table.findMany.bind(table);
    const sweepRead = vi.spyOn(table, 'findMany').mockImplementationOnce((args) => {
      const pending = findMany(args).then(async (rows) => {
        await services.imageJobs.abandon(
          f.bookingId,
          job.jobId,
          { outcome: 'ABANDONED', evidenceReference: 'reviewed-during-input-sweep' },
          randomUUID(),
          f.manager,
        );
        return rows;
      });
      return {
        [Symbol.toStringTag]: 'PrismaPromise' as const,
        then: pending.then.bind(pending),
        catch: pending.catch.bind(pending),
        finally: pending.finally.bind(pending),
      };
    });
    try {
      await services.imageJobs.runNext();
    } finally {
      sweepRead.mockRestore();
    }
    expect(await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_JOB_ABANDONED',
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('rejects new work past media cutoff and provider-disabled mode before any dispatch', async () => {
    const { f, provider, services, command } = await setup();
    await services.service.changeCutoff(
      {
        bookingId: f.bookingId,
        expectedRevision: 0,
        cutoffAt: new Date(f.now.getTime() - 1).toISOString(),
        idempotencyKey: randomUUID(),
      },
      f.manager,
    );
    await expect(services.imageJobs.enqueue(command, f.couple)).rejects.toMatchObject({
      code: 'MEDIA_CUTOFF_REACHED',
    });
    await expect(f.services.imageJobs.enqueue(command, f.couple)).rejects.toMatchObject({
      code: 'AI_IMAGE_PROVIDER_DISABLED',
    });
    expect(provider.generate).not.toHaveBeenCalled();
  });
  it('lets Manager abandon a failed derive with evidence while preserving the accepted paid image', async () => {
    const { f, provider, services, command } = await setup();
    const job = await services.imageJobs.enqueue(command, f.couple);
    const read = vi
      .spyOn(f.storage.provider, 'read')
      .mockRejectedValueOnce(new ProviderError('timeout'));
    await services.imageJobs.runNext();
    read.mockRestore();
    const body = { outcome: 'ABANDONED', evidenceReference: 'operator-reviewed-derive' };
    const key = randomUUID();
    await expect(
      services.imageJobs.abandon(f.bookingId, job.jobId, body, key, f.couple),
    ).rejects.toMatchObject({ status: 404 });
    const abandoned = await services.imageJobs.abandon(
      f.bookingId,
      job.jobId,
      body,
      key,
      f.manager,
    );
    expect(abandoned).toMatchObject({ status: 'FAILED', errorCode: 'AI_JOB_ABANDONED' });
    expect(await services.imageJobs.abandon(f.bookingId, job.jobId, body, key, f.manager)).toEqual(
      abandoned,
    );
    await expect(
      services.imageJobs.abandon(f.bookingId, job.jobId, body, randomUUID(), f.manager),
    ).rejects.toMatchObject({ code: 'AI_JOB_RECONCILIATION_STALE' });
    await expect(
      services.imageJobs.abandon(f.bookingId, randomUUID(), body, randomUUID(), f.manager),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db.prisma.invitationMediaAsset.count({ where: { bookingId: f.bookingId } })).toBe(
      1,
    );
    expect(
      await db.prisma.auditLog.count({
        where: { action: 'invitation.image-job-abandoned', entityId: f.bookingId },
      }),
    ).toBe(1);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('records allowlisted job/phase logs without prompts, credentials or raw exceptions', async () => {
    const { f, provider, services, command } = await setup();
    const lines: string[] = [];
    const logger = pino(
      { level: 'trace' },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    );
    const job = await services.imageJobs.enqueue(command, f.couple);
    await services.imageJobs.runNext(logger);
    await services.imageJobs.enqueue({ ...command, idempotencyKey: randomUUID() }, f.couple);
    provider.generate.mockRejectedValueOnce(new Error('private provider detail'));
    await services.imageJobs.runNext(logger);
    const output = lines.join('');
    expect(output).toContain(job.jobId);
    expect(output).toContain('invitation_studio_phase');
    expect(output).toContain('RECOVERY_REQUIRED');
    expect(output).not.toContain(command.prompt);
    expect(output).not.toContain(f.couple.accessToken);
    expect(output).not.toContain('private provider detail');
  });
  it('keeps operational input private under RLS and uses database admission across connections', async () => {
    const { f, provider, services, command } = await setup();
    await services.imageJobs.enqueue(command, f.couple);
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    const role = 'image_job_reader_' + randomUUID().replaceAll('-', '');
    try {
      await client.query('CREATE ROLE ' + role);
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE ' + role);
      await expect(client.query('SELECT prompt FROM "InvitationImageJob"')).rejects.toMatchObject({
        code: '42501',
      });
      await client.query('ROLLBACK');
      await client.query('GRANT SELECT ON "InvitationImageJob" TO ' + role);
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE ' + role);
      expect((await client.query('SELECT prompt FROM "InvitationImageJob"')).rows).toHaveLength(0);
      await expect(client.query('TRUNCATE "InvitationImageJob"')).rejects.toMatchObject({
        code: '42501',
      });
      await client.query('ROLLBACK');
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('invitation-image-job-dispatch'))");
      expect(await services.imageJobs.runNext()).toBe(false);
      expect(provider.generate).not.toHaveBeenCalled();
    } finally {
      await client.query('ROLLBACK');
      await client.query('REVOKE ALL ON "InvitationImageJob" FROM ' + role);
      await client.query('DROP ROLE ' + role);
      await client.end();
    }
    await services.imageJobs.runNext();
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('treats a proven provider failure as terminal while retaining its intent evidence', async () => {
    const { f, provider, services, command } = await setup();
    provider.generate.mockRejectedValueOnce(new ProviderError('failure'));
    const job = await services.imageJobs.enqueue(command, f.couple);
    await services.imageJobs.runNext();
    expect(await services.imageJobs.read(f.bookingId, job.jobId, f.couple)).toMatchObject({
      status: 'FAILED',
      errorCode: 'PROVIDER_ERROR',
    });
    expect(
      await db.prisma.invitationGenerationIntent.count({
        where: { bookingId: f.bookingId, status: 'FAILED' },
      }),
    ).toBe(1);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
});
