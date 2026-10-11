import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import {
  createStoredObject,
  type StorageProvider,
} from '../../../integrations/storage/storage-provider.js';
import { digest } from '../domain/studio-policy.js';
import type { StudioAuthorization } from './studio-authorization.js';
import type { StudioRepository } from './studio.repository.js';
import { PrintFileService } from './print-file.service.js';
import { PRINT_MAX_IMAGE_BYTES } from './print-file.renderer.js';

async function fixture() {
  const bookingId = randomUUID(),
    revisionId = randomUUID(),
    assetId = randomUUID();
  const bytes = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#ead9c2' },
  })
    .png()
    .toBuffer();
  const object = createStoredObject({
    bytes,
    purpose: 'PRIVATE_WEDDING_MEDIA',
    resourceId: assetId,
    contentType: 'image/png',
  });
  const content = {
    design: {
      title: 'Thiệp cưới',
      textFields: {},
      sections: [],
      derivedAssetIds: [assetId],
      includesSeating: false,
    },
    timeline: {
      bookingId,
      timelineRevisionId: randomUUID(),
      revisionNumber: 1,
      eventDate: '2027-01-06',
      hallName: 'Sảnh Hoa Sen',
      shiftCode: 'DINNER',
      shiftStartTime: '18:00',
      shiftEndTime: '22:00',
      items: [
        {
          itemId: randomUUID(),
          order: 0,
          startTime: '18:00',
          title: 'Đón khách',
          description: null,
        },
      ],
      approvedByManagerAt: '2026-10-11T00:00:00Z',
      approvedByCoupleAt: '2026-10-11T00:00:00Z',
      isEffective: true,
    },
    seating: null,
    genericQrPayload: 'https://wedding.example.test/api/v1/public/invitations/' + 'a'.repeat(64),
    publicInvitationId: randomUUID(),
    publishedRevisionId: randomUUID(),
  };
  const state: {
    row: { content: unknown; contentDigest: string; createdAt: Date } | null;
    assets: { id: string; object: unknown }[];
  } = {
    row: { content, contentDigest: digest(content), createdAt: new Date('2026-10-11T00:00:00Z') },
    assets: [{ id: assetId, object }],
  };
  // Controlled persistence faults complement the real database/session integration
  // tests. They cannot weaken the native boundary or write financial history.
  const repository = {
    boundary: {
      run: <T>(input: { context: ContractContext }, work: (scope: ContractContext) => Promise<T>) =>
        work({ ...input.context, transactionScopeId: randomUUID() }),
      requireScope: () => ({
        invitationPrintableRevision: { findFirst: () => Promise.resolve(state.row) },
        invitationDerivedAsset: { findMany: () => Promise.resolve(state.assets) },
      }),
    },
  } as unknown as StudioRepository;
  const access = { booking: vi.fn(() => Promise.resolve()) } as unknown as StudioAuthorization;
  const originalRead = vi.fn(() => Promise.resolve(bytes));
  const writes = {
    put: vi.fn(() => Promise.reject(new Error('Read-only operation'))),
    delete: vi.fn(() => Promise.reject(new Error('Read-only operation'))),
    createSignedReadUrl: vi.fn(() => Promise.reject(new Error('Server original required'))),
  };
  const storage: StorageProvider = { read: originalRead, ...writes };
  const service = new PrintFileService(repository, access, storage);
  const read = () =>
    service.read(bookingId, revisionId, { actorId: randomUUID(), requestId: randomUUID() });
  const setContent = (value: unknown) => {
    state.row = { ...state.row!, content: value, contentDigest: digest(value) };
  };
  return {
    state,
    content,
    object,
    storage,
    bytes,
    read,
    setContent,
    assetId,
    originalRead,
    writes,
  };
}

describe('print file integrity failures', () => {
  it('rejects missing revisions and digest tampering before storage IO', async () => {
    const f = await fixture();
    f.state.row!.contentDigest = '0'.repeat(64);
    await expect(f.read()).rejects.toMatchObject({ code: 'PRINTABLE_DIGEST_CONFLICT' });
    f.state.row = null;
    await expect(f.read()).rejects.toMatchObject({ status: 404 });
    expect(f.originalRead).not.toHaveBeenCalled();
  });
  it('rejects unsupported seating and too many retained assets', async () => {
    const f = await fixture();
    f.setContent({ ...f.content, seating: [] });
    await expect(f.read()).rejects.toMatchObject({ code: 'PRINT_SEATING_NOT_SUPPORTED' });
    f.setContent({
      ...f.content,
      design: {
        ...f.content.design,
        includesSeating: true,
        sections: [{ kind: 'SEATING', textKey: null, derivedAssetId: null }],
      },
    });
    await expect(f.read()).rejects.toMatchObject({ code: 'PRINT_SEATING_NOT_SUPPORTED' });
    f.setContent({
      ...f.content,
      design: {
        ...f.content.design,
        derivedAssetIds: Array.from({ length: 9 }, () => randomUUID()),
      },
    });
    await expect(f.read()).rejects.toMatchObject({ code: 'PRINT_ASSET_LIMIT' });
    expect(f.originalRead).not.toHaveBeenCalled();
  });
  it('rejects missing retained rows and providers without original reads', async () => {
    const f = await fixture();
    f.state.assets = [];
    await expect(f.read()).rejects.toMatchObject({ status: 502 });
    f.state.assets = [{ id: f.assetId, object: f.object }];
    delete f.storage.read;
    await expect(f.read()).rejects.toMatchObject({ status: 503 });
  });
  it.each([
    { contentType: 'image/jpeg' },
    { resourceId: randomUUID() },
    { objectKey: '../escape.png' },
    { objectKey: `private/wedding-media/${randomUUID()}/${'0'.repeat(64)}.png` },
  ])('rejects invalid immutable storage metadata %j', async (mutation) => {
    const f = await fixture();
    f.state.assets[0]!.object = { ...f.object, ...mutation };
    await expect(f.read()).rejects.toMatchObject({ status: 502 });
    expect(f.originalRead).not.toHaveBeenCalled();
  });
  it('rejects a valid reference with a checksum different from its metadata', async () => {
    const f = await fixture();
    f.state.assets[0]!.object = { ...f.object, checksumSha256: '0'.repeat(64) };
    await expect(f.read()).rejects.toMatchObject({ status: 502 });
    expect(f.originalRead).not.toHaveBeenCalled();
  });
  it('bounds aggregate declared retained bytes before reading the next object', async () => {
    const f = await fixture(),
      secondId = randomUUID();
    f.setContent({
      ...f.content,
      design: { ...f.content.design, derivedAssetIds: [f.assetId, secondId] },
    });
    f.state.assets.push({
      id: secondId,
      object: { ...f.object, resourceId: secondId, sizeBytes: PRINT_MAX_IMAGE_BYTES },
    });
    await expect(f.read()).rejects.toMatchObject({ code: 'PRINT_ASSET_LIMIT' });
    expect(f.originalRead).toHaveBeenCalledTimes(1);
  });
  it('rejects truncated and same-length corrupted original bytes', async () => {
    const f = await fixture();
    f.storage.read = () => Promise.resolve(f.bytes.subarray(1));
    await expect(f.read()).rejects.toMatchObject({ status: 502 });
    const corrupted = Buffer.from(f.bytes);
    corrupted[0] = 0;
    f.storage.read = () => Promise.resolve(corrupted);
    await expect(f.read()).rejects.toMatchObject({ status: 502 });
  });
  it('rejects an immutable revision substituted while external IO is in progress', async () => {
    const f = await fixture();
    f.storage.read = () => {
      f.setContent({
        ...f.content,
        design: { ...f.content.design, title: 'Changed immutable row' },
      });
      return Promise.resolve(f.bytes);
    };
    await expect(f.read()).rejects.toMatchObject({ code: 'PRINTABLE_DIGEST_CONFLICT' });
    expect(f.writes.put).not.toHaveBeenCalled();
    expect(f.writes.delete).not.toHaveBeenCalled();
    expect(f.writes.createSignedReadUrl).not.toHaveBeenCalled();
  });
});
