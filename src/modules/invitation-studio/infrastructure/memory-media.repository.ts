import type {
  MediaRepository,
  MediaState,
  MediaUploadAttempt,
  MediaRequestContext,
  MediaCommandIdentity,
} from '../application/media.contracts.js';
import {
  IdempotencyKeyReusedError,
  RequestInProgressError,
} from '../../../core/errors/app-error.js';

/** Offline contract double only. Never wire this non-durable repository to runtime. */
export class MemoryMediaRepository implements MediaRepository {
  readonly states = new Map<string, MediaState>();
  readonly attempts = new Map<string, MediaUploadAttempt>();
  readonly denials: { readonly bookingId: string; readonly context: MediaRequestContext }[] = [];
  readonly #tails = new Map<string, Promise<void>>();
  readonly #intents = new Set<string>();
  readonly #commands = new Map<string, string>();

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
