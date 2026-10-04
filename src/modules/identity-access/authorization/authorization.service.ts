import type { PrismaClient } from '../../../generated/prisma/client.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor } from './authenticated-actor.middleware.js';

export type ConsultationAccessLevel = 'RESTRICTED' | 'FULL';
export type ConsultationCapability =
  | 'PROPOSAL_READ'
  | 'TIMELINE_READ'
  | 'TIMELINE_EDIT'
  | 'TIMELINE_APPROVE'
  | 'MEDIA'
  | 'INVITATION'
  | 'GUEST'
  | 'SEATING'
  | 'PRINT'
  | 'EVENT_OPERATIONS';

export interface ConsultationAccessRepository {
  findLevel(accountId: string, consultationId: string): Promise<ConsultationAccessLevel | null>;
}

export interface ConsultationAccessReader {
  requireAccess(
    input: Readonly<{
      accountId: string;
      consultationId: string;
      minimum: ConsultationAccessLevel;
    }>,
  ): Promise<Readonly<{ level: ConsultationAccessLevel }>>;
}

export class ForbiddenIdentityAccessError extends AppError {
  constructor() {
    super({
      status: 403,
      code: 'FORBIDDEN',
      message: 'The request is forbidden.',
    });
  }
}

const restrictedCapabilities = new Set<ConsultationCapability>([
  'PROPOSAL_READ',
  'TIMELINE_READ',
  'TIMELINE_EDIT',
  'TIMELINE_APPROVE',
]);

export function createPrismaConsultationAccessRepository(
  prisma: Pick<PrismaClient, 'consultationAccess'>,
): ConsultationAccessRepository {
  return Object.freeze({
    async findLevel(
      accountId: string,
      consultationId: string,
    ): Promise<ConsultationAccessLevel | null> {
      const access = await prisma.consultationAccess.findUnique({
        where: { accountId_consultationId: { accountId, consultationId } },
        select: { level: true },
      });
      return access?.level ?? null;
    },
  });
}

export function createConsultationAccessReader(
  repository: ConsultationAccessRepository,
): ConsultationAccessReader {
  return Object.freeze({
    async requireAccess(
      input: Readonly<{
        accountId: string;
        consultationId: string;
        minimum: ConsultationAccessLevel;
      }>,
    ): Promise<Readonly<{ level: ConsultationAccessLevel }>> {
      const level = await repository.findLevel(input.accountId, input.consultationId);
      if (level === null) {
        throw new NotFoundError();
      }
      if (input.minimum === 'FULL' && level !== 'FULL') {
        throw new ForbiddenIdentityAccessError();
      }
      return Object.freeze({ level });
    },
  });
}

export async function authorizeConsultationCapability(
  reader: ConsultationAccessReader,
  actor: AuthenticatedActor,
  input: Readonly<{ consultationId: string; capability: ConsultationCapability }>,
): Promise<Readonly<{ level: ConsultationAccessLevel; resourceOwnershipRequired: boolean }>> {
  const restricted = restrictedCapabilities.has(input.capability);
  const access = await reader.requireAccess({
    accountId: actor.accountId,
    consultationId: input.consultationId,
    minimum: restricted ? 'RESTRICTED' : 'FULL',
  });
  return Object.freeze({
    level: access.level,
    resourceOwnershipRequired: !restricted,
  });
}

export function requireAnyRole(
  actor: AuthenticatedActor,
  allowedRoles: readonly AuthenticatedActor['roles'][number][],
): AuthenticatedActor {
  if (!actor.roles.some((role) => allowedRoles.includes(role))) {
    throw new ForbiddenIdentityAccessError();
  }
  return actor;
}
