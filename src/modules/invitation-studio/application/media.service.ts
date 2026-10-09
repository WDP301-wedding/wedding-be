import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { AppError, NotFoundError, ValidationError } from '../../../core/errors/app-error.js';
import {
  createStoredObject,
  type StorageProvider,
} from '../../../integrations/storage/storage-provider.js';
import {
  MEDIA_LIMITS,
  claimMediaQuota,
  inspectMedia,
  mediaConflict,
  mediaUploadSchema,
  mediaUuidSchema,
  parseMediaInput,
} from '../domain/media-policy.js';
import type {
  MediaAccessGuard,
  MediaAsset,
  MediaImageInspector,
  MediaPolicy,
  MediaRepository,
  MediaRequestContext,
  MediaResult,
  MediaState,
} from './media.contracts.js';

const assetCommandSchema = z.strictObject({
  bookingId: mediaUuidSchema,
  assetId: mediaUuidSchema,
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(128),
});
const policyCommandSchema = z.strictObject({
  bookingId: mediaUuidSchema,
  cutoffAt: z.iso.datetime(),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(128),
});
const readSchema = z.strictObject({ bookingId: mediaUuidSchema, assetId: mediaUuidSchema });
const metadataSchema = assetCommandSchema.extend({ altText: z.string().min(1).max(250) });

export class MediaService {
  constructor(
    readonly repository: MediaRepository,
    readonly access: MediaAccessGuard,
    readonly storage: StorageProvider,
    readonly inspector: MediaImageInspector,
    readonly now: () => Date = () => new Date(),
  ) {}

  async upload(value: unknown, context: MediaRequestContext): Promise<MediaAsset> {
    const parsed = parseMediaInput(mediaUploadSchema, value);
    // Freeze bytes before awaiting access/decoder/storage; caller buffer mutation
    // must never change checksum, quota or the content that was actually inspected.
    const input = { ...parsed, bytes: parsed.bytes.slice() };
    await this.requireActor(input.bookingId, context, 'COUPLE');
    const expected = createStoredObject({
      bytes: input.bytes,
      contentType: input.contentType,
      purpose: 'PRIVATE_WEDDING_MEDIA',
      resourceId: input.bookingId,
    });
    const digest = this.digest({ action: 'upload', ...input, bytes: expected.checksumSha256 });
    const receiptKey = this.receiptKey(context, input.idempotencyKey);
    // Durable intent precedes provider side effects. Failure/unknown outcomes stay
    // recoverable without deleting a key possibly used by an immutable history.
    return this.runCommand(input, context, digest, async (state, context) => {
      const actor = await this.requireActor(input.bookingId, context, 'COUPLE');
      const replay = this.replay(state, receiptKey, digest);
      if (replay !== undefined) return replay as MediaAsset;
      const policy = this.policy(state, actor.eventStartAt);
      this.beforeCutoff(policy);
      const prior = input.assetId === undefined ? undefined : this.asset(state, input.assetId);
      if (prior !== undefined && prior.revision !== input.expectedRevision)
        throw mediaConflict('MEDIA_REVISION_STALE');
      claimMediaQuota(state, input.bytes.byteLength, prior?.id);
      // Claim/serialize intent before full decoding as well as provider upload.
      // A duplicate during decoding is in flight; a committed replay avoids decoding.
      const dimensions = await inspectMedia(input, this.inspector);
      const uploadAttemptId = randomUUID();
      await this.repository.recordUploadAttempt({
        id: uploadAttemptId,
        bookingId: input.bookingId,
        object: expected,
        intentKeyDigest: receiptKey,
        commandDigest: digest,
        createdAt: this.now().toISOString(),
        policyRevision: policy.revision,
      });
      const object = await this.storage.put({
        bytes: input.bytes,
        contentType: input.contentType,
        purpose: 'PRIVATE_WEDDING_MEDIA',
        resourceId: input.bookingId,
      });
      if (
        object.objectKey !== expected.objectKey ||
        object.resourceId !== expected.resourceId ||
        object.purpose !== expected.purpose ||
        object.contentType !== expected.contentType ||
        object.sizeBytes !== expected.sizeBytes ||
        object.checksumSha256 !== expected.checksumSha256
      ) {
        throw new AppError({
          status: 503,
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Storage acceptance could not be verified.',
        });
      }
      await this.requireActor(input.bookingId, context, 'COUPLE');
      this.beforeCutoff(policy);
      const acceptedAt = this.now().toISOString(),
        id = prior?.id ?? randomUUID(),
        fileId = randomUUID();
      const asset: MediaAsset = {
        id,
        revision: (prior?.revision ?? 0) + 1,
        currentFileRevisionId: fileId,
        detachedAt: null,
      };
      state.files.set(fileId, {
        id: fileId,
        assetId: id,
        revision: asset.revision,
        object,
        ...dimensions,
        altText: input.altText,
        acceptedAt,
        policyRevision: policy.revision,
        cutoffAt: policy.cutoffAt,
        uploadAttemptId,
      });
      state.assets.set(id, asset);
      this.commit(
        state,
        receiptKey,
        digest,
        asset,
        context,
        prior === undefined ? 'media.created' : 'media.replaced',
        id,
        asset.revision,
      );
      return asset;
    });
  }

  async authorizeUpload(bookingId: string, context: MediaRequestContext): Promise<void> {
    const canonicalId = parseMediaInput(mediaUuidSchema, bookingId);
    await this.requireActor(canonicalId, context, 'COUPLE');
  }

  async updateMetadata(value: unknown, context: MediaRequestContext): Promise<MediaAsset> {
    const input = parseMediaInput(metadataSchema, value);
    await this.requireActor(input.bookingId, context, 'COUPLE');
    const digest = this.digest({ action: 'metadata', ...input });
    return this.runCommand(input, context, digest, async (state, context) => {
      const actor = await this.requireActor(input.bookingId, context, 'COUPLE');
      const key = this.receiptKey(context, input.idempotencyKey);
      const replay = this.replay(state, key, digest);
      if (replay !== undefined) return replay as MediaAsset;
      const policy = this.policy(state, actor.eventStartAt);
      this.beforeCutoff(policy);
      const prior = this.asset(state, input.assetId),
        original = state.files.get(prior.currentFileRevisionId);
      if (prior.revision !== input.expectedRevision) throw mediaConflict('MEDIA_REVISION_STALE');
      if (original === undefined) throw new NotFoundError();
      const id = randomUUID(),
        asset = { ...prior, revision: prior.revision + 1, currentFileRevisionId: id };
      state.files.set(id, {
        ...original,
        id,
        revision: asset.revision,
        altText: input.altText,
        acceptedAt: this.now().toISOString(),
        policyRevision: policy.revision,
        cutoffAt: policy.cutoffAt,
      });
      state.assets.set(asset.id, asset);
      this.commit(
        state,
        key,
        digest,
        asset,
        context,
        'media.metadata-changed',
        asset.id,
        asset.revision,
      );
      return asset;
    });
  }

  async detach(value: unknown, context: MediaRequestContext): Promise<MediaAsset> {
    const input = parseMediaInput(assetCommandSchema, value);
    await this.requireActor(input.bookingId, context, 'COUPLE');
    const digest = this.digest({ action: 'detach', ...input });
    return this.runCommand(input, context, digest, async (state, context) => {
      const actor = await this.requireActor(input.bookingId, context, 'COUPLE');
      const key = this.receiptKey(context, input.idempotencyKey);
      const replay = this.replay(state, key, digest);
      if (replay !== undefined) return replay as MediaAsset;
      this.beforeCutoff(this.policy(state, actor.eventStartAt));
      const current = this.asset(state, input.assetId);
      if (current.revision !== input.expectedRevision) throw mediaConflict('MEDIA_REVISION_STALE');
      const asset = {
        ...current,
        revision: current.revision + 1,
        detachedAt: this.now().toISOString(),
      };
      state.assets.set(asset.id, asset);
      this.commit(state, key, digest, asset, context, 'media.detached', asset.id, asset.revision);
      // No Storage.delete: published/printable history remains immutable.
      return asset;
    });
  }

  async changeCutoff(value: unknown, context: MediaRequestContext): Promise<MediaPolicy> {
    const input = parseMediaInput(policyCommandSchema, value);
    await this.requireActor(input.bookingId, context, 'MANAGER');
    const digest = this.digest({ action: 'policy', ...input });
    return this.runCommand(input, context, digest, async (state, context) => {
      const actor = await this.requireActor(input.bookingId, context, 'MANAGER');
      const key = this.receiptKey(context, input.idempotencyKey);
      const replay = this.replay(state, key, digest);
      if (replay !== undefined) return replay as MediaPolicy;
      const policy = this.policy(state, actor.eventStartAt);
      if (input.expectedRevision !== policy.revision) throw mediaConflict('MEDIA_POLICY_STALE');
      state.policy = { revision: policy.revision + 1, cutoffAt: input.cutoffAt };
      this.commit(
        state,
        key,
        digest,
        state.policy,
        context,
        'media.cutoff-changed',
        null,
        state.policy.revision,
      );
      const fact = state.audit.pop()!;
      state.audit.push({ ...fact, previousCutoffAt: policy.cutoffAt, cutoffAt: input.cutoffAt });
      return state.policy;
    });
  }

  async preview(
    value: unknown,
    context: MediaRequestContext,
  ): Promise<{
    readonly asset: MediaAsset;
    readonly altText: string;
    readonly signedUrl: string;
    readonly expiresInSeconds: number;
  }> {
    const input = parseMediaInput(readSchema, value);
    return this.repository.runLocked(
      input.bookingId,
      async (state, scopedContext) => {
        context = scopedContext ?? context;
        await this.requireActor(input.bookingId, context);
        const asset = this.asset(state, input.assetId),
          file = state.files.get(asset.currentFileRevisionId);
        if (file === undefined) throw new NotFoundError();
        const signedUrl = await this.storage.createSignedReadUrl(
          file.object,
          MEDIA_LIMITS.signedReadSeconds,
        );
        await this.requireActor(input.bookingId, context);
        return {
          asset,
          altText: file.altText,
          signedUrl,
          expiresInSeconds: MEDIA_LIMITS.signedReadSeconds,
        };
      },
      undefined,
      context,
    );
  }

  private async requireActor(
    bookingId: string,
    context: MediaRequestContext,
    role?: 'COUPLE' | 'MANAGER',
  ) {
    let actor;
    try {
      actor = await this.access.requireAccess(bookingId, context);
      if (
        actor.actorId !== context.actorId ||
        (actor.role !== 'MANAGER' && actor.role !== 'COUPLE') ||
        (role !== undefined && actor.role !== role)
      )
        throw new NotFoundError();
    } catch (error) {
      if (error instanceof AppError && [401, 403, 404].includes(error.status)) {
        await this.repository.recordDeniedAccess(bookingId, context);
      }
      throw error;
    }
    if (!Number.isFinite(actor.eventStartAt.getTime())) throw new ValidationError();
    return actor;
  }

  private policy(state: MediaState, eventStartAt: Date): MediaPolicy {
    state.policy ??= {
      revision: 0,
      cutoffAt: new Date(eventStartAt.getTime() - MEDIA_LIMITS.cutoffLeadMs).toISOString(),
    };
    return state.policy;
  }
  private beforeCutoff(policy: MediaPolicy): void {
    if (this.now().getTime() >= Date.parse(policy.cutoffAt))
      throw mediaConflict('MEDIA_CUTOFF_REACHED');
  }
  private asset(state: MediaState, id: string): MediaAsset {
    const asset = state.assets.get(id);
    if (asset === undefined || asset.detachedAt !== null) throw new NotFoundError();
    return asset;
  }
  private receiptKey(context: MediaRequestContext, key: string): string {
    return this.digest([context.actorId, key]);
  }
  private runCommand<T>(
    input: { bookingId: string; idempotencyKey: string },
    context: MediaRequestContext,
    commandDigest: string,
    work: (state: MediaState, context: MediaRequestContext) => Promise<T>,
  ): Promise<T> {
    return this.repository.runLocked(
      input.bookingId,
      (state, scopedContext) => work(state, scopedContext ?? context),
      {
        intentKeyDigest: this.receiptKey(context, input.idempotencyKey),
        commandDigest,
      },
      context,
    );
  }
  private digest(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  private replay(state: MediaState, key: string, digest: string): MediaResult | undefined {
    const previous = state.receipts.get(key);
    if (previous !== undefined && previous.digest !== digest) {
      throw new AppError({
        status: 422,
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'The command key identifies a different media request.',
      });
    }
    return previous?.result;
  }
  private commit(
    state: MediaState,
    key: string,
    digest: string,
    result: MediaResult,
    context: MediaRequestContext,
    action: string,
    assetId: string | null,
    revision: number,
  ): void {
    state.receipts.set(key, { digest, result });
    state.audit.push({
      action,
      actorId: context.actorId,
      requestId: context.requestId,
      occurredAt: this.now().toISOString(),
      assetId,
      revision,
    });
  }
}
