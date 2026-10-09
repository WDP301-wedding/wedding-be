import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { NotFoundError, ProviderError, ValidationError } from '../../../core/errors/app-error.js';
import { FakeStorageProvider } from '../../../integrations/storage/fake-storage-provider.js';
import { MEDIA_LIMITS, claimMediaQuota } from '../domain/media-policy.js';
import { MemoryMediaRepository } from '../infrastructure/memory-media.repository.js';
import type {
  MediaAccessGuard,
  MediaImageInspector,
  MediaRequestContext,
} from './media.contracts.js';
import { MediaService } from './media.service.js';

const bookingId = '11111111-1111-4111-8111-111111111111';
const otherBookingId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const context: MediaRequestContext = { actorId, requestId: randomUUID() };
// Complete 1x1 PNG fixture. Inspector below is an explicit contract double, NOT
// production decoding evidence. No header-only decoder is wired into the service.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZWQAAAAASUVORK5CYII=',
  'base64',
);

function harness() {
  const repository = new MemoryMediaRepository();
  const storage = new FakeStorageProvider();
  let time = new Date('2026-10-09T00:00:00Z');
  let allowed = true;
  let role: 'COUPLE' | 'MANAGER' = 'COUPLE';
  const access: MediaAccessGuard = {
    requireAccess: vi.fn((id: string, ctx: MediaRequestContext) => {
      if (!allowed || id !== bookingId || ctx.actorId !== actorId)
        return Promise.reject(new NotFoundError());
      return Promise.resolve({ actorId, role, eventStartAt: new Date('2026-10-15T00:00:00Z') });
    }),
  };
  const inspector: MediaImageInspector = {
    inspect: vi.fn(() =>
      Promise.resolve({
        contentType: 'image/png' as const,
        width: 1,
        height: 1,
      }),
    ),
  };
  const service = new MediaService(repository, access, storage, inspector, () => time);
  const upload = (extra: Record<string, unknown> = {}) =>
    service.upload(
      {
        bookingId,
        bytes: png,
        contentType: 'image/png',
        altText: 'Ảnh cưới',
        idempotencyKey: randomUUID(),
        ...extra,
      },
      context,
    );
  return {
    repository,
    storage,
    access,
    inspector,
    service,
    upload,
    setTime: (value: string) => {
      time = new Date(value);
    },
    deny: () => {
      allowed = false;
    },
    manager: () => {
      role = 'MANAGER';
    },
  };
}

describe('SPEC-05 W1 isolated media contract', () => {
  it('claims intent during full decoding and replays committed content without decoding again', async () => {
    const h = harness();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inspect = vi.spyOn(h.inspector, 'inspect').mockImplementationOnce(async () => {
      entered();
      await gate;
      return { contentType: 'image/png', width: 1, height: 1 };
    });
    const first = h.upload({ idempotencyKey: 'decoding' });
    await started;
    try {
      await expect(h.upload({ idempotencyKey: 'decoding' })).rejects.toMatchObject({
        status: 409,
        code: 'REQUEST_IN_PROGRESS',
      });
      await expect(
        h.upload({ idempotencyKey: 'decoding', altText: 'different body' }),
      ).rejects.toMatchObject({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' });
    } finally {
      release();
    }
    const accepted = await first;
    expect(await h.upload({ idempotencyKey: 'decoding' })).toEqual(accepted);
    expect(inspect).toHaveBeenCalledTimes(1);
  });
  it('rejects in-flight intent immediately and permits retry replay after acceptance', async () => {
    const h = harness();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const put = h.storage.put.bind(h.storage);
    vi.spyOn(h.storage, 'put').mockImplementationOnce(async (command) => {
      entered();
      await gate;
      return put(command);
    });
    const first = h.upload({ idempotencyKey: 'inflight' });
    await started;
    try {
      await expect(h.upload({ idempotencyKey: 'inflight' })).rejects.toMatchObject({
        status: 409,
        code: 'REQUEST_IN_PROGRESS',
      });
    } finally {
      release();
    }
    const accepted = await first;
    expect(await h.upload({ idempotencyKey: 'inflight' })).toEqual(accepted);
  });
  it('accepts only private server-generated references and snapshots cutoff/policy without persisting URLs', async () => {
    const h = harness(),
      asset = await h.upload();
    const state = h.repository.states.get(bookingId)!;
    const file = state.files.get(asset.currentFileRevisionId)!;
    expect(file.object).toMatchObject({
      purpose: 'PRIVATE_WEDDING_MEDIA',
      resourceId: bookingId,
      sizeBytes: png.length,
    });
    expect(file.object.objectKey).toMatch(
      /^private-wedding-media\/11111111-1111-4111-8111-111111111111\/[a-f0-9]{64}\.png$/,
    );
    expect(file).toMatchObject({
      width: 1,
      height: 1,
      cutoffAt: '2026-10-12T00:00:00.000Z',
      policyRevision: 0,
    });
    expect(JSON.stringify([...state.files.values()])).not.toContain('signedUrl');
    expect(state.audit).toHaveLength(1);
    expect(h.repository.attempts.has(file.uploadAttemptId)).toBe(true);
    expect(state.audit[0]).not.toHaveProperty('altText');
  });

  it.each(['restricted', 'Staff', 'public', 'disabled', 'revoked'])(
    'conceals %s access before storage and records redacted denial',
    async () => {
      const h = harness();
      h.deny();
      const put = vi.spyOn(h.storage, 'put');
      await expect(h.upload()).rejects.toMatchObject({ status: 404 });
      expect(put).not.toHaveBeenCalled();
      expect(h.repository.denials).toHaveLength(1);
      expect(h.repository.states.size).toBe(0);
    },
  );

  it('denies other booking and actor identities', async () => {
    const h = harness();
    await expect(h.upload({ bookingId: otherBookingId })).rejects.toMatchObject({ status: 404 });
    await expect(
      h.service.upload(
        { bookingId, bytes: png, contentType: 'image/png', altText: 'a', idempotencyKey: 'a' },
        { ...context, actorId: randomUUID() },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    { objectKey: '../secret' },
    { filename: '../file.png' },
    { bucket: 'public' },
    { altText: '' },
    { altText: 'x'.repeat(251) },
    { contentType: 'image/svg+xml' },
    { bytes: new Uint8Array() },
    { bytes: new Uint8Array(25 * 1024 * 1024 + 1) },
    { bytes: Buffer.from('not an image') },
    { assetId: randomUUID() },
    { expectedRevision: 1 },
    { idempotencyKey: '' },
    { bookingId: 'not-a-uuid' },
  ])('rejects unsafe/schema upload %#', async (extra) => {
    const h = harness();
    await expect(h.upload(extra)).rejects.toBeInstanceOf(ValidationError);
    expect(h.repository.attempts.size).toBe(0);
  });

  it.each([
    { width: 0, height: 1 },
    { width: 12001, height: 1 },
    { width: 1, height: 12001 },
    { width: 8000, height: 5001 },
    { width: 1.5, height: 1 },
    { width: 1, height: 1, contentType: 'image/jpeg' },
  ])('rejects decoder type/dimension result %#', async (dimensions) => {
    const h = harness();
    vi.spyOn(h.inspector, 'inspect').mockResolvedValue({
      contentType: 'image/png',
      ...dimensions,
    } as Awaited<ReturnType<MediaImageInspector['inspect']>>);
    await expect(h.upload()).rejects.toBeInstanceOf(ValidationError);
    expect(h.repository.attempts.size).toBe(0);
  });

  it('accepts exact decoded pixel limit and rejects corrupt content reported by decoder', async () => {
    const h = harness();
    vi.spyOn(h.inspector, 'inspect').mockResolvedValue({
      contentType: 'image/png',
      width: 8000,
      height: 5000,
    });
    await h.upload();
    vi.spyOn(h.inspector, 'inspect').mockRejectedValue(new ValidationError());
    await expect(h.upload()).rejects.toBeInstanceOf(ValidationError);
    expect(h.repository.states.get(bookingId)!.assets.size).toBe(1);
  });

  it.each(['2026-10-12T00:00:00Z', '2026-10-12T00:00:01Z'])(
    'blocks create at/after cutoff %s',
    async (time) => {
      const h = harness();
      h.setTime(time);
      await expect(h.upload()).rejects.toMatchObject({ code: 'MEDIA_CUTOFF_REACHED' });
      expect(h.repository.attempts.size).toBe(0);
    },
  );

  it('allows just before cutoff and blocks replace/delete/metadata at the boundary', async () => {
    const h = harness();
    h.setTime('2026-10-11T23:59:59.999Z');
    const asset = await h.upload();
    h.setTime('2026-10-12T00:00:00Z');
    const input = { bookingId, assetId: asset.id, expectedRevision: 1, idempotencyKey: 'mutation' };
    await expect(h.upload({ assetId: asset.id, expectedRevision: 1 })).rejects.toMatchObject({
      code: 'MEDIA_CUTOFF_REACHED',
    });
    await expect(h.service.detach(input, context)).rejects.toMatchObject({
      code: 'MEDIA_CUTOFF_REACHED',
    });
    await expect(
      h.service.updateMetadata(
        { ...input, idempotencyKey: 'metadata-at-cutoff', altText: 'new' },
        context,
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_CUTOFF_REACHED' });
    expect(h.repository.states.get(bookingId)!.files.size).toBe(1);
  });

  it('serializes 101 concurrent originals across service instances: exactly 100 accept', async () => {
    const h = harness();
    const second = new MediaService(
      h.repository,
      h.access,
      h.storage,
      h.inspector,
      () => new Date('2026-10-09T00:00:00Z'),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 101 }, (_, i) =>
        i % 2 === 0
          ? h.upload()
          : second.upload(
              {
                bookingId,
                bytes: png,
                contentType: 'image/png',
                altText: 'a',
                idempotencyKey: String(i),
              },
              context,
            ),
      ),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(100);
    expect(h.repository.states.get(bookingId)!.assets.size).toBe(100);
    expect(h.repository.attempts.size).toBe(100);
    const rejected = results.find((x) => x.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      code: 'MEDIA_QUOTA_EXCEEDED',
    });
    const current = [...h.repository.states.get(bookingId)!.assets.values()][0]!;
    await h.upload({ assetId: current.id, expectedRevision: 1 });
    expect(h.repository.states.get(bookingId)!.assets.size).toBe(100);
  });

  it('checks exact 1GiB quota, replacement subtraction and detached originals', async () => {
    const h = harness(),
      asset = await h.upload();
    const state = h.repository.states.get(bookingId)!;
    const file = state.files.get(asset.currentFileRevisionId)!;
    // Aggregate fixture uses valid <=25MiB entries; no GiB allocation required.
    for (let i = 0; i < 40; i++) {
      const id = randomUUID();
      state.files.set(id, {
        ...file,
        id,
        assetId: id,
        object: { ...file.object, sizeBytes: 25 * 1024 * 1024 },
      });
      state.assets.set(id, { id, currentFileRevisionId: id, revision: 1, detachedAt: null });
    }
    expect(() => claimMediaQuota(state, 24 * 1024 * 1024 - png.length)).not.toThrow();
    expect(() => claimMediaQuota(state, 24 * 1024 * 1024 - png.length + 1)).toThrowError(
      expect.objectContaining({ code: 'MEDIA_QUOTA_EXCEEDED' }),
    );
    expect(() => claimMediaQuota(state, 24 * 1024 * 1024, asset.id)).not.toThrow();
    state.assets.set(asset.id, { ...asset, detachedAt: '2026-10-09T01:00:00Z' });
    expect(() => claimMediaQuota(state, 24 * 1024 * 1024)).not.toThrow();
  });

  it('failed replacement preserves original, revision, quota and audit; pending intent survives', async () => {
    const h = harness(),
      asset = await h.upload(),
      before = structuredClone(h.repository.states.get(bookingId));
    vi.spyOn(h.storage, 'put').mockRejectedValue(new ProviderError('timeout'));
    await expect(h.upload({ assetId: asset.id, expectedRevision: 1 })).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(h.repository.states.get(bookingId)).toEqual(before);
    expect(h.repository.attempts.size).toBe(2);
    expect(await h.service.preview({ bookingId, assetId: asset.id }, context)).toMatchObject({
      expiresInSeconds: 900,
    });
  });

  it('rechecks revoked access and cutoff after upload: no partially accepted media', async () => {
    for (const cause of ['cutoff', 'revoked']) {
      const h = harness(),
        put = h.storage.put.bind(h.storage);
      vi.spyOn(h.storage, 'put').mockImplementation(async (command) => {
        const object = await put(command);
        if (cause === 'cutoff') h.setTime('2026-10-12T00:00:00Z');
        else h.deny();
        return object;
      });
      await expect(h.upload()).rejects.toMatchObject({
        code: cause === 'cutoff' ? 'MEDIA_CUTOFF_REACHED' : 'NOT_FOUND',
      });
      expect(h.repository.states.size).toBe(0);
      expect(h.repository.attempts.size).toBe(1);
    }
  });

  it('rejects mismatched accepted Storage metadata and retains recovery attempt', async () => {
    const h = harness(),
      put = h.storage.put.bind(h.storage);
    vi.spyOn(h.storage, 'put').mockImplementation(async (command) => ({
      ...(await put(command)),
      sizeBytes: 7,
    }));
    await expect(h.upload()).rejects.toMatchObject({ status: 503 });
    expect(h.repository.states.size).toBe(0);
    expect(h.repository.attempts.size).toBe(1);
  });

  it('stable command replay has one accepted file/audit and key reuse rejects changed content', async () => {
    const h = harness(),
      put = vi.spyOn(h.storage, 'put');
    const asset = await h.upload({ idempotencyKey: 'stable' });
    h.setTime('2026-10-13T00:00:00Z');
    expect(await h.upload({ idempotencyKey: 'stable' })).toEqual(asset);
    await expect(h.upload({ idempotencyKey: 'stable', altText: 'changed' })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(h.repository.attempts.size).toBe(1);
    h.deny();
    await expect(h.upload({ idempotencyKey: 'stable' })).rejects.toMatchObject({ status: 404 });
  });

  it('one CAS replacement wins; metadata preserves immutable original and does not upload again', async () => {
    const h = harness(),
      asset = await h.upload(),
      put = vi.spyOn(h.storage, 'put');
    const input = { assetId: asset.id, expectedRevision: 1 };
    const result = await Promise.allSettled([h.upload(input), h.upload(input)]);
    expect(result.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const next = await h.service.updateMetadata(
      {
        bookingId,
        assetId: asset.id,
        expectedRevision: 2,
        altText: 'Mô tả mới',
        idempotencyKey: 'metadata',
      },
      context,
    );
    expect(next.revision).toBe(3);
    expect(put).toHaveBeenCalledTimes(1);
    const state = h.repository.states.get(bookingId)!;
    expect(state.files.get(asset.currentFileRevisionId)!.altText).toBe('Ảnh cưới');
    expect(state.files.size).toBe(3);
    expect(
      await h.service.updateMetadata(
        {
          bookingId,
          assetId: asset.id,
          expectedRevision: 2,
          altText: 'Mô tả mới',
          idempotencyKey: 'metadata',
        },
        context,
      ),
    ).toEqual(next);
    await expect(
      h.service.updateMetadata(
        {
          bookingId,
          assetId: asset.id,
          expectedRevision: 1,
          altText: 'stale',
          idempotencyKey: 'other',
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'MEDIA_REVISION_STALE' });
  });

  it('tombstones without Storage deletion; history survives and repeated intent replays', async () => {
    const h = harness(),
      asset = await h.upload(),
      remove = vi.spyOn(h.storage, 'delete');
    const input = { bookingId, assetId: asset.id, expectedRevision: 1, idempotencyKey: 'detach' };
    const detached = await h.service.detach(input, context);
    expect(await h.service.detach(input, context)).toEqual(detached);
    expect(remove).not.toHaveBeenCalled();
    expect(h.repository.states.get(bookingId)!.files.size).toBe(1);
    await expect(
      h.service.preview({ bookingId, assetId: asset.id }, context),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      h.service.detach({ ...input, idempotencyKey: 'new' }, context),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('Manager reads originals after cutoff; only explicit audited policy command permits a later Couple upload', async () => {
    const h = harness(),
      asset = await h.upload();
    await expect(
      h.service.changeCutoff(
        {
          bookingId,
          expectedRevision: 0,
          cutoffAt: '2026-10-20T00:00:00Z',
          idempotencyKey: 'policy',
        },
        context,
      ),
    ).rejects.toMatchObject({ status: 404 });
    h.setTime('2026-10-13T00:00:00Z');
    h.manager();
    expect(
      (await h.service.preview({ bookingId, assetId: asset.id }, context)).signedUrl,
    ).toContain('expiresIn=900');
    const input = {
      bookingId,
      expectedRevision: 0,
      cutoffAt: '2026-10-20T00:00:00Z',
      idempotencyKey: 'policy',
    };
    const policy = await h.service.changeCutoff(input, context);
    expect(policy.revision).toBe(1);
    expect(await h.service.changeCutoff(input, context)).toEqual(policy);
    await expect(
      h.service.changeCutoff({ ...input, idempotencyKey: 'stale' }, context),
    ).rejects.toMatchObject({ code: 'MEDIA_POLICY_STALE' });
    expect(h.repository.states.get(bookingId)!.audit.at(-1)!.action).toBe('media.cutoff-changed');
    expect(
      h.repository.states.get(bookingId)!.files.get(asset.currentFileRevisionId)!.policyRevision,
    ).toBe(0);
    await expect(h.upload()).rejects.toMatchObject({ status: 404 });
  });

  it('snapshots caller bytes before awaits and prevents invalid authoritative dates', async () => {
    const h = harness(),
      bytes = Uint8Array.from(png);
    const operation = h.upload({ bytes });
    bytes.fill(0);
    await operation;
    vi.spyOn(h.access, 'requireAccess').mockResolvedValue({
      actorId,
      role: 'COUPLE',
      eventStartAt: new Date('invalid'),
    });
    await expect(h.upload()).rejects.toBeInstanceOf(ValidationError);
    expect(MEDIA_LIMITS.fileBytes).toBe(25 * 1024 * 1024);
  });

  it('database commit failure rolls back acceptance but keeps a recoverable attempt/object', async () => {
    const h = harness(),
      locked = h.repository.runLocked.bind(h.repository);
    vi.spyOn(h.repository, 'runLocked').mockImplementationOnce((id, work) =>
      locked(id, async (state) => {
        await work(state);
        throw new Error('simulated commit failure');
      }),
    );
    await expect(h.upload({ idempotencyKey: 'retry' })).rejects.toThrow('simulated commit failure');
    expect(h.repository.states.size).toBe(0);
    expect(h.repository.attempts.size).toBe(1);
    const pending = [...h.repository.attempts.values()][0]!;
    expect(await h.storage.createSignedReadUrl(pending.object, 900)).toContain('expiresIn=900');
    await h.upload({ idempotencyKey: 'retry' });
    expect(h.repository.states.get(bookingId)!.assets.size).toBe(1);
    expect(h.repository.states.get(bookingId)!.audit).toHaveLength(1);
  });

  it('policy update queues behind upload and does not rewrite the captured policy', async () => {
    const h = harness(),
      put = h.storage.put.bind(h.storage);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(h.storage, 'put').mockImplementation(async (command) => {
      entered();
      await gate;
      return put(command);
    });
    const operation = h.upload();
    await started;
    const managerGuard: MediaAccessGuard = {
      requireAccess: () =>
        Promise.resolve({
          actorId,
          role: 'MANAGER',
          eventStartAt: new Date('2026-10-15T00:00:00Z'),
        }),
    };
    const manager = new MediaService(
      h.repository,
      managerGuard,
      h.storage,
      h.inspector,
      () => new Date('2026-10-09T00:00:00Z'),
    );
    const policy = manager.changeCutoff(
      {
        bookingId,
        expectedRevision: 0,
        cutoffAt: '2026-10-20T00:00:00Z',
        idempotencyKey: 'policy-race',
      },
      context,
    );
    release();
    const asset = await operation;
    await policy;
    const state = h.repository.states.get(bookingId)!;
    expect(state.files.get(asset.currentFileRevisionId)!.policyRevision).toBe(0);
    expect(state.policy!.revision).toBe(1);
    expect(state.audit.at(-1)).toMatchObject({
      previousCutoffAt: '2026-10-12T00:00:00.000Z',
      cutoffAt: '2026-10-20T00:00:00Z',
    });
    const later = await h.upload();
    expect(
      h.repository.states.get(bookingId)!.files.get(later.currentFileRevisionId)!.policyRevision,
    ).toBe(1);
  });
});
