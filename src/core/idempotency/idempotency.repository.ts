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

function isKnownRequestError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function toIdempotencyRecord(record: PrismaIdempotencyRecord): IdempotencyRecord {
  return {
    id: record.id,
    namespace: record.namespace,
    idempotencyKey: record.idempotencyKey,
    requestHash: record.requestHash,
    status: record.status,
    responseStatus: record.responseStatus,
    responseBody: record.responseBody as IdempotencyJsonValue | null,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    lockedAt: record.lockedAt,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createPrismaIdempotencyRepository(
  prisma: Pick<PrismaClient, 'idempotencyRecord'>,
): IdempotencyRepository {
  return {
    async claim(claim) {
      try {
        const stored = await prisma.idempotencyRecord.create({
          data: {
            ...claim,
            status: 'IN_PROGRESS',
            responseStatus: null,
            responseBody: Prisma.DbNull,
            resourceType: null,
            resourceId: null,
          },
        });

        return { outcome: 'CLAIMED', record: toIdempotencyRecord(stored) };
      } catch (error) {
        if (!isKnownRequestError(error, 'P2002')) {
          throw error;
        }

        const existing = await prisma.idempotencyRecord.findUnique({
          where: {
            namespace_idempotencyKey: {
              namespace: claim.namespace,
              idempotencyKey: claim.idempotencyKey,
            },
          },
        });

        if (existing === null) {
          throw error;
        }

        return { outcome: 'EXISTING', record: toIdempotencyRecord(existing) };
      }
    },

    async transition(input) {
      try {
        const stored = await prisma.idempotencyRecord.update({
          where: { id: input.id, status: 'IN_PROGRESS' },
          data: {
            status: input.status,
            responseStatus: input.responseStatus,
            responseBody: input.responseBody ?? Prisma.DbNull,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
          },
        });

        return toIdempotencyRecord(stored);
      } catch (error) {
        if (isKnownRequestError(error, 'P2025')) {
          return null;
        }

        throw error;
      }
    },
  };
}
import {
  Prisma,
  type IdempotencyRecord as PrismaIdempotencyRecord,
  type PrismaClient,
} from '../../generated/prisma/client.js';
