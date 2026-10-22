import { randomUUID } from 'node:crypto';
import type {
  MediaRepository,
  MediaState,
  MediaUploadAttempt,
  MediaRequestContext,
  MediaCommandIdentity,
  MediaAsset,
  MediaFileRevision,
  MediaPolicy,
  MediaAuditFact,
} from '../application/media.contracts.js';
import type { StoredObject } from '../../../integrations/storage/storage-provider.js';
import {
  IdempotencyKeyReusedError,
  NotFoundError,
  RequestInProgressError,
} from '../../../core/errors/app-error.js';
import { claimMediaQuota, mediaConflict } from '../domain/media-policy.js';

/** Offline contract double only. Never wire this non-durable repository to runtime. */
export class MemoryMediaRepository implements MediaRepository {
  readonly states = new Map<string, MediaState>();
  readonly attempts = new Map<string, MediaUploadAttempt>();
  readonly denials: { readonly bookingId: string; readonly context: MediaRequestContext }[] = [];
  readonly #tails = new Map<string, Promise<void>>();
  readonly #leaseTails = new Map<string, Promise<void>>();
  readonly #activeLeases = new Map<
    string,
    {
      bookingId: string;
      reservedFiles: number;
      reservedBytes: number;
      promise: Promise<void>;
      resolve: () => void;
    }
  >();
  readonly #intents = new Set<string>();
  readonly #commands = new Map<string, string>();
  readonly #activeReplacements = new Map<string, string>();

  async runLocked<T>(
    bookingId: string,
    work: (state: MediaState) => Promise<T>,
    command?: MediaCommandIdentity,
  ): Promise<T> {
    const intent = command === undefined ? undefined : `${bookingId}:${command.intentKeyDigest}`;
    if (intent !== undefined) {
      const prior = this.#commands.get(intent);
      if (prior !== undefined && prior !== command!.commandDigest)
        throw new IdempotencyKeyReusedError();
      this.#commands.set(intent, command!.commandDigest);
      if (this.#intents.has(intent)) throw new RequestInProgressError(1);
      this.#intents.add(intent);
    }
    if (command !== undefined && this.#leaseTails.has(bookingId)) {
      await this.#leaseTails.get(bookingId);
    }
    const previous = this.#tails.get(bookingId) ?? Promise.resolve();
    let unlock!: () => void;
    const tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    this.#tails.set(bookingId, tail);
    await previous;
    try {
      const state = structuredClone(
        this.states.get(bookingId) ?? {
          policy: null,
          assets: new Map(),
          files: new Map(),
          receipts: new Map(),
          audit: [],
        },
      );
      const result = await work(state);
      this.states.set(bookingId, structuredClone(state));
      return structuredClone(result);
    } finally {
      if (intent !== undefined) this.#intents.delete(intent);
      unlock();
      if (this.#tails.get(bookingId) === tail) this.#tails.delete(bookingId);
    }
  }

  async previewAsset(
    bookingId: string,
    assetId: string,
    context?: MediaRequestContext,
    authorize?: (scopedContext: MediaRequestContext) => Promise<void>,
  ): Promise<{
    readonly asset: MediaAsset;
    readonly file: MediaFileRevision;
    readonly policy: MediaPolicy | null;
  }> {
    if (authorize !== undefined && context !== undefined) {
      await authorize(context);
    }
    const state = this.states.get(bookingId);
    if (!state) throw new NotFoundError();
    const asset = state.assets.get(assetId);
    if (!asset || asset.detachedAt !== null) throw new NotFoundError();
    const file = state.files.get(asset.currentFileRevisionId);
    if (!file) throw new NotFoundError();
    return {
      asset: structuredClone(asset),
      file: structuredClone(file),
      policy: state.policy ? structuredClone(state.policy) : null,
    };
  }

  claimUploadLease(input: {
    bookingId: string;
    bytes: number;
    assetId?: string;
    expectedRevision?: number;
    idempotencyKey: string;
    commandDigest: string;
    intentKeyDigest: string;
    object: StoredObject;
    cutoffAt?: string;
  }): Promise<
    | { readonly replay: true; readonly asset: MediaAsset }
    | {
        readonly replay: false;
        readonly leaseToken: string;
        readonly uploadAttemptId: string;
        readonly policyRevision: number;
        readonly cutoffAt: string;
        readonly prior?: MediaAsset;
      }
  > {
    const intent = `${input.bookingId}:${input.intentKeyDigest}`;
    const priorCmd = this.#commands.get(intent);
    if (priorCmd !== undefined && priorCmd !== input.commandDigest) {
      throw new IdempotencyKeyReusedError();
    }
    this.#commands.set(intent, input.commandDigest);

    const state: MediaState = this.states.get(input.bookingId) ?? {
      policy: null,
      assets: new Map(),
      files: new Map(),
      receipts: new Map(),
      audit: [] as MediaAuditFact[],
    };

    const replay = state.receipts.get(input.intentKeyDigest);
    if (replay !== undefined && replay.digest === input.commandDigest) {
      return Promise.resolve({ replay: true, asset: replay.result as MediaAsset });
    }

    if (this.#intents.has(intent)) throw new RequestInProgressError(1);
    if (input.assetId !== undefined && this.#activeReplacements.has(input.assetId)) {
      throw mediaConflict('MEDIA_REVISION_STALE');
    }

    const prior = input.assetId === undefined ? undefined : state.assets.get(input.assetId);
    if (prior !== undefined && prior.revision !== input.expectedRevision) {
      throw mediaConflict('MEDIA_REVISION_STALE');
    }

    let reservedFiles = 0;
    let reservedBytes = 0;
    for (const lease of this.#activeLeases.values()) {
      if (lease.bookingId === input.bookingId) {
        reservedFiles += lease.reservedFiles;
        reservedBytes += lease.reservedBytes;
      }
    }
    const stateForQuota: MediaState = {
      ...state,
      reservedFiles,
      reservedBytes,
    };

    claimMediaQuota(stateForQuota, input.bytes, prior?.id);

    this.#intents.add(intent);
    if (input.assetId !== undefined) {
      this.#activeReplacements.set(input.assetId, intent);
    }

    const reservedDeltaFiles = prior === undefined ? 1 : 0;
    let resolveLease!: () => void;
    const leasePromise = new Promise<void>((r) => {
      resolveLease = r;
    });
    this.#activeLeases.set(intent, {
      bookingId: input.bookingId,
      reservedFiles: reservedDeltaFiles,
      reservedBytes: input.bytes,
      promise: leasePromise,
      resolve: resolveLease,
    });
    this.#leaseTails.set(input.bookingId, leasePromise);

    const leaseToken = randomUUID();
    const uploadAttemptId = randomUUID();
    const cutoffAt =
      state.policy?.cutoffAt ?? input.cutoffAt ?? new Date(Date.now() + 86400000).toISOString();
    const policyRevision = state.policy?.revision ?? 0;

    return Promise.resolve({
      replay: false,
      leaseToken,
      uploadAttemptId,
      policyRevision,
      cutoffAt,
      ...(prior === undefined ? {} : { prior: structuredClone(prior) }),
    });
  }

  acceptUpload(
    input: {
      bookingId: string;
      leaseToken: string;
      intentKeyDigest: string;
      commandDigest: string;
      uploadAttemptId: string;
      prior?: MediaAsset;
      object: StoredObject;
      dimensions: { width: number; height: number };
      altText: string;
      policyRevision: number;
      cutoffAt: string;
    },
    context: MediaRequestContext,
    authorize?: (scopedContext: MediaRequestContext) => Promise<void>,
  ): Promise<MediaAsset> {
    return this.runLocked(input.bookingId, async (state) => {
      if (authorize !== undefined) {
        await authorize(context);
      }

      const intent = `${input.bookingId}:${input.intentKeyDigest}`;
      this.#intents.delete(intent);
      if (input.prior !== undefined) {
        this.#activeReplacements.delete(input.prior.id);
      }

      const active = this.#activeLeases.get(intent);
      if (active) {
        active.resolve();
        this.#activeLeases.delete(intent);
        if (this.#leaseTails.get(input.bookingId) === active.promise) {
          this.#leaseTails.delete(input.bookingId);
        }
      }

      if (input.prior !== undefined) {
        const current = state.assets.get(input.prior.id);
        if (
          current === undefined ||
          current.revision !== input.prior.revision ||
          current.detachedAt !== null
        ) {
          throw mediaConflict('MEDIA_REVISION_STALE');
        }
      }

      const id = input.prior?.id ?? randomUUID();
      const fileId = randomUUID();
      const revision = (input.prior?.revision ?? 0) + 1;
      const asset: MediaAsset = {
        id,
        revision,
        currentFileRevisionId: fileId,
        detachedAt: null,
      };

      state.files.set(fileId, {
        id: fileId,
        assetId: id,
        revision,
        object: input.object,
        width: input.dimensions.width,
        height: input.dimensions.height,
        altText: input.altText,
        acceptedAt: new Date().toISOString(),
        policyRevision: input.policyRevision,
        cutoffAt: input.cutoffAt,
        uploadAttemptId: input.uploadAttemptId,
      });
      state.assets.set(id, asset);
      state.receipts.set(input.intentKeyDigest, {
        digest: input.commandDigest,
        result: asset,
      });
      state.audit.push({
        action: input.prior === undefined ? 'media.created' : 'media.replaced',
        actorId: context.actorId,
        requestId: context.requestId,
        occurredAt: new Date().toISOString(),
        assetId: id,
        revision,
      });

      return asset;
    });
  }

  releaseUploadLease(
    bookingId: string,
    intentKeyDigest: string,
  ): Promise<void> {
    const intent = `${bookingId}:${intentKeyDigest}`;
    this.#intents.delete(intent);
    for (const [assetId, activeIntent] of this.#activeReplacements.entries()) {
      if (activeIntent === intent) {
        this.#activeReplacements.delete(assetId);
      }
    }
    const active = this.#activeLeases.get(intent);
    if (active) {
      active.resolve();
      this.#activeLeases.delete(intent);
      if (this.#leaseTails.get(bookingId) === active.promise) {
        this.#leaseTails.delete(bookingId);
      }
    }
    return Promise.resolve();
  }

  recordUploadAttempt(attempt: MediaUploadAttempt): Promise<void> {
    this.attempts.set(attempt.id, structuredClone(attempt));
    return Promise.resolve();
  }

  recordDeniedAccess(bookingId: string, context: MediaRequestContext): Promise<void> {
    this.denials.push({
      bookingId,
      context: { actorId: context.actorId, requestId: context.requestId },
    });
    return Promise.resolve();
  }
}
