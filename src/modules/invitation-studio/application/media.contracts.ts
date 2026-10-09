import type { StoredObject } from '../../../integrations/storage/storage-provider.js';
import type { StorageContentType } from '../../../integrations/storage/storage.schemas.js';

export interface MediaRequestContext {
  readonly actorId: string;
  readonly requestId: string;
  readonly causationId?: string;
  /** Ephemeral server context only; never persist, audit, hash or return bearer material. */
  readonly accessToken?: string;
  /** Trusted Core/owner UoW handle only. Never accepted from a command or HTTP field. */
  readonly transactionScopeId?: string;
}

/** The adapter must re-resolve enabled/current identity, own FULL access and CONFIRMED
 * Booking on every call. Staff, restricted, revoked and unowned access are denied.
 * eventStartAt is an absolute instant from the authoritative restaurant calendar,
 * never a client date or a guessed LUNCH/DINNER start time. */
export interface MediaAccessGuard {
  requireAccess(
    bookingId: string,
    context: MediaRequestContext,
  ): Promise<{
    readonly actorId: string;
    readonly role: 'COUPLE' | 'MANAGER';
    readonly eventStartAt: Date;
  }>;
}

/** Decode the complete image (not just magic/header); reject malformed/truncated,
 * decompression-bomb content within the supplied bounds (including all frames).
 * Implementations must not send originals to external AI/providers for inspection. */
export interface MediaImageInspector {
  inspect(
    bytes: Uint8Array,
    limits: {
      readonly maxDimension: number;
      readonly maxPixels: number;
    },
  ): Promise<{
    readonly contentType: StorageContentType;
    readonly width: number;
    readonly height: number;
  }>;
}

export interface MediaPolicy {
  readonly revision: number;
  readonly cutoffAt: string;
}

export interface MediaFileRevision {
  readonly id: string;
  readonly assetId: string;
  readonly revision: number;
  readonly object: StoredObject;
  readonly width: number;
  readonly height: number;
  readonly altText: string;
  readonly acceptedAt: string;
  readonly policyRevision: number;
  readonly cutoffAt: string;
  readonly uploadAttemptId: string;
}

export interface MediaAsset {
  readonly id: string;
  readonly revision: number;
  readonly currentFileRevisionId: string;
  readonly detachedAt: string | null;
}

export interface MediaAuditFact {
  readonly action: string;
  readonly actorId: string;
  readonly requestId: string;
  readonly occurredAt: string;
  readonly assetId: string | null;
  readonly revision: number;
  readonly previousCutoffAt?: string;
  readonly cutoffAt?: string;
}

export type MediaResult = MediaAsset | MediaPolicy;
export interface MediaState {
  // Transaction working set: active assets/current files, current command receipt
  // and newly appended audits. Durable historical rows are never deleted.
  policy: MediaPolicy | null;
  assets: Map<string, MediaAsset>;
  files: Map<string, MediaFileRevision>;
  receipts: Map<string, { readonly digest: string; readonly result: MediaResult }>;
  audit: MediaAuditFact[];
}
export interface MediaCommandIdentity {
  readonly intentKeyDigest: string;
  readonly commandDigest: string;
}

/** Only trusted recovery/steward code reads attempts. A pending attempt is not quota.
 * Persist BEFORE Storage.put; reconcile against accepted revision references after
 * timeout/crash. Never automatically delete a content-addressed shared/history key. */
export interface MediaUploadAttempt {
  readonly id: string;
  readonly bookingId: string;
  readonly object: StoredObject;
  readonly intentKeyDigest: string;
  readonly commandDigest: string;
  readonly createdAt: string;
  readonly policyRevision: number;
}

export interface MediaRepository {
  /** One lock per booking across repository instances/processes; copy-on-write
   * transaction commits state, immutable files, receipt and audits atomically.
   * Failed callbacks roll back. Access and policy changes use this same lane. */
  runLocked<T>(
    bookingId: string,
    work: (state: MediaState, scopedContext?: MediaRequestContext) => Promise<T>,
    command?: MediaCommandIdentity,
    context?: MediaRequestContext,
  ): Promise<T>;
  recordUploadAttempt(attempt: MediaUploadAttempt): Promise<void>;
  recordDeniedAccess(bookingId: string, context: MediaRequestContext): Promise<void>;
}
