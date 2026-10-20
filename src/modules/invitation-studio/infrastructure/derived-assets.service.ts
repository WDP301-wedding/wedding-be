import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type {
  StorageProvider,
  StoredObject,
} from '../../../integrations/storage/storage-provider.js';
import { createStoredObject } from '../../../integrations/storage/storage-provider.js';
import { NotFoundError, ProviderError } from '../../../core/errors/app-error.js';
import type { MediaRequestContext } from '../application/media.contracts.js';
import { id, parseStudio, revision, studioConflict, digest } from '../domain/studio-policy.js';
import { asJson, type StudioRepository } from './studio.repository.js';
import { type StudioAuthorization } from './studio-authorization.js';
import { StudioExternalWork } from './external-work.js';
import { studioPhase } from './studio-phase.js';

const schema = z.strictObject({
  bookingId: id,
  mediaAssetId: id,
  expectedRevision: revision,
  idempotencyKey: z.string(),
});
export class DerivedAssetsService {
  constructor(
    readonly repository: StudioRepository,
    readonly access: StudioAuthorization,
    readonly storage: StorageProvider,
  ) {}
  async derive(value: unknown, context: MediaRequestContext) {
    const input = parseStudio(schema, value);
    const intentDigest = digest({ actorId: context.actorId, key: input.idempotencyKey });
    const external = new StudioExternalWork(this.repository);
    return external.run(
      {
        bookingId: input.bookingId,
        idempotencyKey: input.idempotencyKey,
        payload: { action: 'asset.derive', ...input },
        operation: { action: 'asset.derive', resourceId: input.mediaAssetId },
      },
      context,
      (scoped) => this.access.booking(input.bookingId, scoped, 'COUPLE'),
      async (tx) => {
        if (!this.storage.read) throw new ProviderError('unavailable');
        const source = await tx.invitationMediaAsset.findFirst({
          where: { bookingId: input.bookingId, id: input.mediaAssetId, detachedAt: null },
          include: { currentFile: true },
        });
        if (!source) throw new NotFoundError();
        if (source.revision !== input.expectedRevision)
          throw studioConflict('MEDIA_REVISION_STALE');
        return source.currentFile;
      },
      async (file, lease) => {
        const bytes = await studioPhase(context, 'asset.derive', 'read', () =>
          this.storage.read!({
            objectKey: file.objectKey as StoredObject['objectKey'],
            purpose: 'PRIVATE_WEDDING_MEDIA',
            resourceId: input.bookingId,
          }),
        );
        if (
          createStoredObject({
            bytes,
            contentType: file.contentType as StoredObject['contentType'],
            purpose: 'PRIVATE_WEDDING_MEDIA',
            resourceId: input.bookingId,
          }).checksumSha256 !== file.checksumSha256
        )
          throw new ProviderError('failure');
        const output = await studioPhase(context, 'asset.derive', 'decode', () =>
          sharp(bytes, { failOn: 'warning', limitInputPixels: 40000000 })
            .timeout({ seconds: 10 })
            .rotate()
            .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer({ resolveWithObject: true }),
        );
        const attempt = await lease.write(async (tx) => {
          const prior = await tx.invitationDerivedUploadAttempt.findUnique({
            where: { bookingId_intentDigest: { bookingId: input.bookingId, intentDigest } },
          });
          if (prior) {
            if (prior.sourceFileId !== file.id) throw studioConflict('MEDIA_REVISION_STALE');
            return prior;
          }
          const assetId = randomUUID();
          const object = createStoredObject({
            bytes: output.data,
            contentType: 'image/png',
            purpose: 'PRIVATE_WEDDING_MEDIA',
            resourceId: assetId,
          });
          return tx.invitationDerivedUploadAttempt.create({
            data: {
              bookingId: input.bookingId,
              intentDigest,
              assetId,
              sourceFileId: file.id,
              object: asJson(object),
            },
          });
        });
        const expected = attempt.object as unknown as StoredObject;
        const object = await studioPhase(context, 'asset.derive', 'upload', () =>
          this.storage.put({
            bytes: output.data,
            contentType: 'image/png',
            purpose: 'PRIVATE_WEDDING_MEDIA',
            resourceId: attempt.assetId,
          }),
        );
        if (
          object.objectKey !== expected.objectKey ||
          object.checksumSha256 !== expected.checksumSha256 ||
          object.sizeBytes !== expected.sizeBytes ||
          object.contentType !== expected.contentType ||
          object.resourceId !== attempt.assetId ||
          object.purpose !== expected.purpose
        )
          throw new ProviderError('failure');
        return { attempt, object, width: output.info.width, height: output.info.height };
      },
      async (tx, scoped, output, file) => {
        const source = await tx.invitationMediaAsset.findFirst({
          where: { id: input.mediaAssetId, bookingId: input.bookingId, detachedAt: null },
        });
        if (!source) throw new NotFoundError();
        if (source.revision !== input.expectedRevision || source.currentFileRevisionId !== file.id)
          throw studioConflict('MEDIA_REVISION_STALE');
        const asset = await tx.invitationDerivedAsset.create({
          data: {
            id: output.attempt.assetId,
            bookingId: input.bookingId,
            sourceFileId: file.id,
            object: asJson(output.object),
            width: output.width,
            height: output.height,
            publicSlug: randomBytes(32).toString('hex'),
          },
        });
        await this.repository.audit(tx, scoped, 'invitation.asset-derived', asset.id, 1);
        return {
          derivedAssetId: asset.id,
          width: asset.width,
          height: asset.height,
          contentType: 'image/png' as const,
        };
      },
    );
  }
  async readPublic(slug: string) {
    if (!/^[a-f0-9]{64}$/u.test(slug)) throw new NotFoundError();
    if (this.storage.read === undefined) throw new ProviderError('unavailable');
    const asset = await this.repository.prisma.invitationDerivedAsset.findUnique({
      where: { publicSlug: slug },
    });
    if (asset === null) throw new NotFoundError();
    const identity = await this.repository.prisma.invitationPublicIdentity.findUnique({
      where: { bookingId: asset.bookingId },
    });
    if (identity?.currentPublicationId === null || identity === null) throw new NotFoundError();
    const current = await this.repository.prisma.invitationPublishedRevision.findFirst({
      where: { id: identity.currentPublicationId, assetIds: { has: asset.id } },
    });
    if (current === null) throw new NotFoundError();
    const bytes = await this.storage.read(asset.object as unknown as StoredObject);
    // Recheck unpublication/replacement after the provider read; old references stay
    // private and do not authorize a public asset response.
    const latest = await this.repository.prisma.invitationPublicIdentity.findUnique({
      where: { bookingId: asset.bookingId },
    });
    if (latest?.currentPublicationId !== current.id) throw new NotFoundError();
    return bytes;
  }
}
