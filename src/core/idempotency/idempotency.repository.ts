export type IdempotencyStatus = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

export type IdempotencyJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly IdempotencyJsonValue[]
  | Readonly<{ [key: string]: IdempotencyJsonValue }>;

export interface NewIdempotencyClaim {
  readonly namespace: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly lockedAt: Date;
  readonly expiresAt: Date;
}

export interface IdempotencyRecord extends NewIdempotencyClaim {
  readonly id: string;
  readonly status: IdempotencyStatus;
  readonly responseStatus: number | null;
  readonly responseBody: IdempotencyJsonValue | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type RepositoryClaimResult =
  | Readonly<{ outcome: 'CLAIMED'; record: IdempotencyRecord }>
  | Readonly<{ outcome: 'EXISTING'; record: IdempotencyRecord }>;

export interface TransitionIdempotencyRecord {
  readonly id: string;
  readonly status: Exclude<IdempotencyStatus, 'IN_PROGRESS'>;
  readonly responseStatus: number;
  readonly responseBody: IdempotencyJsonValue | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
}

export interface IdempotencyRepository {
  claim(claim: NewIdempotencyClaim): Promise<RepositoryClaimResult>;
  transition(input: TransitionIdempotencyRecord): Promise<IdempotencyRecord | null>;
}
