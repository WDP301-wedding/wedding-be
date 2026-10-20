import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from '../venue-catalog/catalog-test-database.js';
import { studioFixture } from './studio-fixture.js';
import { createPrismaClient } from '../../../src/core/database/prisma.js';
import { createInvitationStudioServices } from '../../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import { createGeneratedAiImage } from '../../../src/integrations/ai-image/ai-image-provider.js';
import { controlledStorage } from './controlled-storage.js';
import { insertDatabaseMedia } from './media-database-fixtures.js';
import { digest } from '../../../src/modules/invitation-studio/domain/studio-policy.js';
import { withRequestDeadline } from '../../../src/core/http/request-deadline.js';

const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
suite('Invitation external work without long transactions', () => {
  const db = new CatalogTestDatabase('studio_external');
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect(), 60000);

  it('reserves actual bytes for a known journaled output instead of requiring space for a second maximum-sized generation', async () => {
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
    const failure = vi
      .spyOn(services.studioRepository, 'audit')
      .mockRejectedValueOnce(new Error('acceptance rollback'));
    try {
      await expect(services.generation.generate(command, f.couple)).rejects.toThrow(
        'acceptance rollback',
      );
    } finally {
      failure.mockRestore();
    }
    await db.prisma.$transaction(async (tx) => {
      for (let i = 0; i < 40; i++) await insertDatabaseMedia(tx, f.bookingId, 25 * 1024 * 1024);
      await insertDatabaseMedia(tx, f.bookingId, 20 * 1024 * 1024);
    });
    expect((await services.generation.generate(command, f.couple)).mediaAssetId).toBeTruthy();
    expect(provider.generate).toHaveBeenCalledTimes(1);
  }, 15000);

  it('rolls back an undispatched claim when the HTTP budget ends during authorization', async () => {
    const f = await studioFixture(db.prisma);
    const provider = { generate: vi.fn() };
    const services = createInvitationStudioServices(
      db.prisma,
      f.storage.provider,
      provider,
      null,
      () => f.now,
    );
    const controller = new AbortController();
    const resolve = services.generation.access.bookingActor.bind(services.generation.access);
    let calls = 0;
    const spy = vi
      .spyOn(services.generation.access, 'bookingActor')
      .mockImplementation(async (...args) => {
        const actor = await resolve(...args);
        if (++calls === 2) controller.abort();
        return actor;
      });
    try {
      await expect(
        withRequestDeadline(
          { signal: controller.signal, expiresAt: performance.now() + 60000 },
          () =>
            services.generation.generate(
              {
                bookingId: f.bookingId,
                prompt: 'Wedding garden',
                aspectRatio: '1:1',
                idempotencyKey: randomUUID(),
              },
              f.couple,
            ),
        ),
      ).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
      expect(provider.generate).not.toHaveBeenCalled();
      expect(
        await db.prisma.invitationGenerationIntent.count({ where: { bookingId: f.bookingId } }),
      ).toBe(0);
      expect(
        await db.prisma.invitationExternalWork.count({ where: { bookingId: f.bookingId } }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects nesting external work in an existing transaction before any provider call', async () => {
    const f = await studioFixture(db.prisma);
    const provider = { generate: vi.fn() };
    const services = createInvitationStudioServices(
      db.prisma,
      f.storage.provider,
      provider,
      null,
      () => f.now,
    );
    await expect(
      services.boundary.run({ bookingId: f.bookingId, context: f.contract }, (scope) =>
        services.generation.generate(
          {
            bookingId: f.bookingId,
            prompt: 'Wedding garden',
            aspectRatio: '1:1',
            idempotencyKey: randomUUID(),
          },
          { ...f.couple, transactionScopeId: scope.transactionScopeId! },
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(
      await db.prisma.invitationGenerationIntent.count({ where: { bookingId: f.bookingId } }),
    ).toBe(0);
  });

  async function pausedGeneration() {
    const f = await studioFixture(db.prisma);
    let started!: () => void, resume!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const provider = {
      generate: vi.fn(async () => {
        started();
        await gate;
        return createGeneratedAiImage(f.bytes, 'image/png');
      }),
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
    return { f, services, command, ready, resume: () => resume(), provider };
  }

  it('keeps one provider call for concurrent same-key retries and rejects changed payloads', async () => {
    const p = await pausedGeneration();
    const pending = p.services.generation.generate(p.command, p.f.couple);
    try {
      await Promise.race([p.ready, pending]);
      await expect(p.services.generation.generate(p.command, p.f.couple)).rejects.toMatchObject({
        code: 'REQUEST_IN_PROGRESS',
      });
      await expect(
        p.services.generation.generate({ ...p.command, prompt: 'Different garden' }, p.f.couple),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    } finally {
      p.resume();
    }
    const result = await pending;
    expect(await p.services.generation.generate(p.command, p.f.couple)).toEqual(result);
    expect(p.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('counts an in-flight generation reservation against other generation and ordinary uploads', async () => {
    const p = await pausedGeneration();
    await db.prisma.$transaction(async (tx) => {
      for (let i = 0; i < 99; i++) await insertDatabaseMedia(tx, p.f.bookingId, 10);
    });
    const pending = p.services.generation.generate(p.command, p.f.couple);
    try {
      await Promise.race([p.ready, pending]);
      await expect(
        p.services.generation.generate({ ...p.command, idempotencyKey: randomUUID() }, p.f.couple),
      ).rejects.toMatchObject({ code: 'MEDIA_QUOTA_EXCEEDED' });
      await expect(
        p.services.service.upload(
          {
            bookingId: p.f.bookingId,
            bytes: p.f.bytes,
            contentType: 'image/png',
            altText: 'Own photo',
            idempotencyKey: randomUUID(),
          },
          p.f.couple,
        ),
      ).rejects.toMatchObject({ code: 'MEDIA_QUOTA_EXCEEDED' });
    } finally {
      p.resume();
    }
    await pending;
    expect(
      await db.prisma.invitationMediaAsset.count({ where: { bookingId: p.f.bookingId } }),
    ).toBe(100);
    expect(p.provider.generate).toHaveBeenCalledTimes(1);
    expect(
      await db.prisma.invitationExternalWork.count({ where: { bookingId: p.f.bookingId } }),
    ).toBe(0);
  }, 15000);

  it('rechecks cutoff after provider work and keeps the output recoverable', async () => {
    const p = await pausedGeneration();
    const pending = p.services.generation.generate(p.command, p.f.couple);
    const observed = pending.catch((error: unknown) => error);
    try {
      await Promise.race([p.ready, pending]);
      await p.services.service.changeCutoff(
        {
          bookingId: p.f.bookingId,
          expectedRevision: 0,
          cutoffAt: new Date(p.f.now.getTime() - 1).toISOString(),
          idempotencyKey: randomUUID(),
        },
        p.f.manager,
      );
    } finally {
      p.resume();
    }
    expect(await observed).toMatchObject({ code: 'MEDIA_CUTOFF_REACHED' });
    expect(
      await db.prisma.invitationMediaAsset.count({ where: { bookingId: p.f.bookingId } }),
    ).toBe(0);
    expect(
      await db.prisma.invitationMediaUploadAttempt.count({ where: { bookingId: p.f.bookingId } }),
    ).toBe(1);
    expect(p.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('fences an expired worker without deleting a successor claim or repeating generation', async () => {
    const p = await pausedGeneration();
    const pending = p.services.generation.generate(p.command, p.f.couple);
    const observed = pending.catch((error: unknown) => error);
    const intentDigest = digest({
      actorId: p.f.couple.actorId,
      action: 'ai.generate',
      key: p.command.idempotencyKey,
    });
    const token = randomUUID();
    try {
      await Promise.race([p.ready, pending]);
      await db.prisma.invitationExternalWork.update({
        where: { bookingId_intentDigest: { bookingId: p.f.bookingId, intentDigest } },
        data: { token },
      });
    } finally {
      p.resume();
    }
    expect(await observed).toMatchObject({ code: 'REQUEST_IN_PROGRESS' });
    expect(await db.prisma.invitationExternalWork.findUnique({ where: { token } })).not.toBeNull();
    await db.prisma.invitationExternalWork.update({
      where: { token },
      data: { expiresAt: new Date(0) },
    });
    await expect(p.services.generation.generate(p.command, p.f.couple)).rejects.toMatchObject({
      code: 'AI_GENERATION_PENDING',
    });
    expect(p.provider.generate).toHaveBeenCalledTimes(1);
    expect(
      await db.prisma.invitationMediaAsset.count({ where: { bookingId: p.f.bookingId } }),
    ).toBe(0);
  });

  it('journals a completed paid output after disconnect but accepts it only on an authorized retry', async () => {
    const p = await pausedGeneration();
    const controller = new AbortController();
    const pending = withRequestDeadline(
      { signal: controller.signal, expiresAt: performance.now() + 60000 },
      () => p.services.generation.generate(p.command, p.f.couple),
    );
    const observed = pending.catch((error: unknown) => error);
    try {
      await Promise.race([p.ready, pending]);
      controller.abort();
    } finally {
      p.resume();
    }
    expect(await observed).toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(
      await db.prisma.invitationMediaAsset.count({ where: { bookingId: p.f.bookingId } }),
    ).toBe(0);
    expect((await p.services.generation.generate(p.command, p.f.couple)).mediaAssetId).toBeTruthy();
    expect(p.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('generates and derives using a single connection, without a transaction around provider work', async () => {
    const f = await studioFixture(db.prisma);
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.delete('schema');
    vi.stubEnv('DB_POOL_MAX', '1');
    const prisma = createPrismaClient(url.toString());
    vi.unstubAllEnvs();
    const storage = controlledStorage();
    const provider = {
      generate: vi.fn(async () => {
        expect(services.boundary.current()).toBeUndefined();
        await prisma.$queryRaw`SELECT 1`;
        return createGeneratedAiImage(f.bytes, 'image/png');
      }),
    };
    const services: ReturnType<typeof createInvitationStudioServices> =
      createInvitationStudioServices(prisma, storage.provider, provider, null, () => f.now);
    const put = storage.provider.put.bind(storage.provider);
    const putSpy = vi.spyOn(storage.provider, 'put').mockImplementation(async (input) => {
      expect(services.boundary.current()).toBeUndefined();
      await prisma.$queryRaw`SELECT 1`;
      return put(input);
    });
    try {
      const command = {
        bookingId: f.bookingId,
        prompt: 'Wedding garden',
        aspectRatio: '1:1',
        idempotencyKey: randomUUID(),
      };
      const image = await services.generation.generate(command, f.couple);
      expect(await services.generation.generate(command, f.couple)).toEqual(image);
      const derive = {
        bookingId: f.bookingId,
        mediaAssetId: image.mediaAssetId,
        expectedRevision: image.revision,
        idempotencyKey: randomUUID(),
      };
      const asset = await services.derivedAssets.derive(derive, f.couple);
      expect(await services.derivedAssets.derive(derive, f.couple)).toEqual(asset);
      expect(provider.generate).toHaveBeenCalledTimes(1);
      expect(putSpy).toHaveBeenCalledTimes(2);
    } finally {
      putSpy.mockRestore();
      await prisma.$disconnect();
    }
  });

  it('allows a booking command while AI waits, then rejects revoked authority at acceptance', async () => {
    const f = await studioFixture(db.prisma);
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.delete('schema');
    vi.stubEnv('DB_POOL_MAX', '1');
    const prisma = createPrismaClient(url.toString());
    vi.unstubAllEnvs();
    let started!: () => void, resume!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const provider = {
      generate: vi.fn(async () => {
        started();
        await gate;
        return createGeneratedAiImage(f.bytes, 'image/png');
      }),
    };
    const services = createInvitationStudioServices(
      prisma,
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
    const pending = services.generation.generate(command, f.couple);
    const observed = pending.then(
      () => ({ accepted: true }),
      (error: unknown) => ({ error }),
    );
    try {
      await Promise.race([ready, pending]);
      await services.boundary.run({ bookingId: f.bookingId, context: f.contract }, async () => {
        await db.prisma.session.update({
          where: { id: f.couple.sessionId },
          data: { status: 'REVOKED' },
        });
      });
    } finally {
      resume();
    }
    try {
      expect(await observed).toMatchObject({ error: { status: 401 } });
      expect(
        await db.prisma.invitationMediaAsset.count({ where: { bookingId: f.bookingId } }),
      ).toBe(0);
      expect(
        await db.prisma.invitationMediaAudit.count({
          where: { bookingId: f.bookingId, action: 'media.access-denied' },
        }),
      ).toBe(1);
      expect(provider.generate).toHaveBeenCalledTimes(1);
    } finally {
      await prisma.$disconnect();
    }
  }, 15000);

  it.each(['replaced', 'expired', 'missing'] as const)(
    'rejects %s ownership at acceptance after Storage upload',
    async (mode) => {
      const p = await pausedGeneration();
      p.resume();
      const token = randomUUID();
      const put = p.f.storage.provider.put.bind(p.f.storage.provider);
      const spy = vi.spyOn(p.f.storage.provider, 'put').mockImplementationOnce(async (input) => {
        const object = await put(input);
        if (mode === 'missing')
          await db.prisma.invitationExternalWork.deleteMany({
            where: { bookingId: p.f.bookingId },
          });
        else
          await db.prisma.invitationExternalWork.updateMany({
            where: { bookingId: p.f.bookingId },
            data: mode === 'replaced' ? { token } : { expiresAt: new Date(0) },
          });
        return object;
      });
      try {
        await expect(p.services.generation.generate(p.command, p.f.couple)).rejects.toMatchObject({
          code: 'REQUEST_IN_PROGRESS',
        });
        expect(
          await db.prisma.invitationMediaAsset.count({ where: { bookingId: p.f.bookingId } }),
        ).toBe(0);
        if (mode === 'replaced')
          expect(
            await db.prisma.invitationExternalWork.findUnique({ where: { token } }),
          ).not.toBeNull();
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('rechecks the original file revision after deriving outside the booking lock', async () => {
    const p = await pausedGeneration();
    p.resume();
    const image = await p.services.generation.generate(p.command, p.f.couple);
    let started!: () => void, resume!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const read = p.f.storage.provider.read.bind(p.f.storage.provider);
    const spy = vi.spyOn(p.f.storage.provider, 'read').mockImplementationOnce(async (reference) => {
      started();
      await gate;
      return read(reference);
    });
    const pending = p.services.derivedAssets.derive(
      {
        bookingId: p.f.bookingId,
        mediaAssetId: image.mediaAssetId,
        expectedRevision: 1,
        idempotencyKey: randomUUID(),
      },
      p.f.couple,
    );
    const observed = pending.catch((error: unknown) => error);
    try {
      await Promise.race([ready, pending]);
      await p.services.service.updateMetadata(
        {
          bookingId: p.f.bookingId,
          assetId: image.mediaAssetId,
          expectedRevision: 1,
          altText: 'New metadata',
          idempotencyKey: randomUUID(),
        },
        p.f.couple,
      );
    } finally {
      resume();
    }
    try {
      expect(await observed).toMatchObject({ code: 'MEDIA_REVISION_STALE' });
      expect(
        await db.prisma.invitationDerivedAsset.count({ where: { bookingId: p.f.bookingId } }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
