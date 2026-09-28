import { z } from 'zod';

import type {
  IdempotencyJsonValue,
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyStatus,
} from './idempotency.repository.js';
import { canonicalizeRequest, hashCanonicalRequest } from './request-hash.js';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

export const DEFAULT_IDEMPOTENCY_RETENTION_MS = 30 * DAY_IN_MILLISECONDS;
export const PAYMENT_IDEMPOTENCY_RETENTION_MS = 180 * DAY_IN_MILLISECONDS;

export interface ClaimIdempotencyInput {
  readonly namespace: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
  readonly retentionMs?: number;
}

export type IdempotencyClaimResult = Readonly<{
  outcome: 'CLAIMED' | 'MISMATCH' | IdempotencyStatus;
  record: IdempotencyRecord;
}>;

export interface StoreIdempotencyResultInput {
  readonly claimId: string;
  readonly responseStatus: number;
  readonly responseBody?: IdempotencyJsonValue;
  readonly resource?: Readonly<{ type: string; id: string }>;
}

export interface IdempotencyService {
  claim(input: ClaimIdempotencyInput): Promise<IdempotencyClaimResult>;
  markSucceeded(input: StoreIdempotencyResultInput): Promise<IdempotencyRecord>;
  markFailed(input: StoreIdempotencyResultInput): Promise<IdempotencyRecord>;
}

export class IdempotencyInputError extends Error {
  override readonly name = 'IdempotencyInputError';

  constructor() {
    super('The idempotency input is invalid.');
  }
}

export class IdempotencyTransitionError extends Error {
  override readonly name = 'IdempotencyTransitionError';

  constructor() {
    super('The idempotency record is missing or is no longer in progress.');
  }
}

const idempotencyKeyPattern = /^[\x20-\x7e]{1,128}$/;
const uuidSchema = z.uuid();

function validateRetention(retentionMs: number): void {
  if (!Number.isSafeInteger(retentionMs) || retentionMs <= 0) {
    throw new IdempotencyInputError();
  }
}

function validateClaimInput(input: ClaimIdempotencyInput, retentionMs: number): void {
  if (input.namespace.trim() === '' || !idempotencyKeyPattern.test(input.idempotencyKey)) {
    throw new IdempotencyInputError();
  }

  validateRetention(retentionMs);
}

function parseTerminalInput(input: StoreIdempotencyResultInput): {
  readonly responseBody: IdempotencyJsonValue | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
} {
  if (
    !uuidSchema.safeParse(input.claimId).success ||
    !Number.isInteger(input.responseStatus) ||
    input.responseStatus < 100 ||
    input.responseStatus > 599
  ) {
    throw new IdempotencyInputError();
  }

  const responseBody = input.responseBody ?? null;

  try {
    canonicalizeRequest(responseBody);
  } catch {
    throw new IdempotencyInputError();
  }

  if (
    input.resource !== undefined &&
    (input.resource.type.trim() === '' || !uuidSchema.safeParse(input.resource.id).success)
  ) {
    throw new IdempotencyInputError();
  }

  return {
    responseBody,
    resourceType: input.resource?.type ?? null,
    resourceId: input.resource?.id ?? null,
  };
}

export function createIdempotencyService(
  repository: IdempotencyRepository,
  now: () => Date = () => new Date(),
): IdempotencyService {
  async function transition(
    status: Exclude<IdempotencyStatus, 'IN_PROGRESS'>,
    input: StoreIdempotencyResultInput,
  ): Promise<IdempotencyRecord> {
    const terminal = parseTerminalInput(input);
    const record = await repository.transition({
      id: input.claimId,
      status,
      responseStatus: input.responseStatus,
      ...terminal,
    });

    if (record === null) {
      throw new IdempotencyTransitionError();
    }

    return record;
  }

  return {
    async claim(input) {
      const retentionMs = input.retentionMs ?? DEFAULT_IDEMPOTENCY_RETENTION_MS;
      validateClaimInput(input, retentionMs);

      const lockedAt = new Date(now().getTime());
      const expiresAt = new Date(lockedAt.getTime() + retentionMs);

      if (Number.isNaN(lockedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
        throw new IdempotencyInputError();
      }

      const requestHash = hashCanonicalRequest(input.payload);
      const result = await repository.claim({
        namespace: input.namespace,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        lockedAt,
        expiresAt,
      });

      if (result.outcome === 'CLAIMED') {
        return result;
      }

      if (result.record.requestHash !== requestHash) {
        return { outcome: 'MISMATCH', record: result.record };
      }

      return { outcome: result.record.status, record: result.record };
    },

    markSucceeded(input) {
      return transition('SUCCEEDED', input);
    },

    markFailed(input) {
      return transition('FAILED', input);
    },
  };
}
