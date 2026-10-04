import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { NotFoundError } from '../../../core/errors/app-error.js';
import type { AuthenticatedActor } from './authenticated-actor.middleware.js';
import {
  authorizeConsultationCapability,
  createConsultationAccessReader,
  createPrismaConsultationAccessRepository,
  ForbiddenIdentityAccessError,
  requireAnyRole,
  type ConsultationAccessRepository,
} from './authorization.service.js';

class FakeAccessRepository implements ConsultationAccessRepository {
  level: 'RESTRICTED' | 'FULL' | null = null;

  findLevel(): Promise<'RESTRICTED' | 'FULL' | null> {
    return Promise.resolve(this.level);
  }
}

function actor(roles: AuthenticatedActor['roles']): AuthenticatedActor {
  return Object.freeze({
    accountId: randomUUID(),
    sessionId: randomUUID(),
    displayEmail: 'couple@example.com',
    roles,
  });
}

describe('identity authorization policy', () => {
  it.each(['PROPOSAL_READ', 'TIMELINE_READ', 'TIMELINE_EDIT', 'TIMELINE_APPROVE'] as const)(
    'allows ACC-003 restricted consultation capability %s',
    async (capability) => {
      const repository = new FakeAccessRepository();
      repository.level = 'RESTRICTED';
      const reader = createConsultationAccessReader(repository);

      await expect(
        authorizeConsultationCapability(reader, actor([]), {
          consultationId: randomUUID(),
          capability,
        }),
      ).resolves.toEqual({ level: 'RESTRICTED', resourceOwnershipRequired: false });
    },
  );

  it.each(['MEDIA', 'INVITATION', 'GUEST', 'SEATING', 'PRINT', 'EVENT_OPERATIONS'] as const)(
    'denies restricted access to ACC-004 capability %s',
    async (capability) => {
      const repository = new FakeAccessRepository();
      repository.level = 'RESTRICTED';
      const reader = createConsultationAccessReader(repository);

      await expect(
        authorizeConsultationCapability(reader, actor([]), {
          consultationId: randomUUID(),
          capability,
        }),
      ).rejects.toBeInstanceOf(ForbiddenIdentityAccessError);
    },
  );

  it('requires owning-module resource checks even after FULL identity access', async () => {
    const repository = new FakeAccessRepository();
    repository.level = 'FULL';
    const reader = createConsultationAccessReader(repository);

    await expect(
      authorizeConsultationCapability(reader, actor(['COUPLE']), {
        consultationId: randomUUID(),
        capability: 'MEDIA',
      }),
    ).resolves.toEqual({ level: 'FULL', resourceOwnershipRequired: true });
  });

  it('conceals a missing or cross-consultation grant as 404', async () => {
    const reader = createConsultationAccessReader(new FakeAccessRepository());

    await expect(
      reader.requireAccess({
        accountId: randomUUID(),
        consultationId: randomUUID(),
        minimum: 'RESTRICTED',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('evaluates Manager and Staff roles only from the immutable actor', () => {
    const manager = actor(['MANAGER']);
    const staff = actor(['STAFF']);
    expect(requireAnyRole(manager, ['MANAGER'])).toBe(manager);
    expect(requireAnyRole(staff, ['STAFF'])).toBe(staff);
    expect(() => requireAnyRole(actor(['COUPLE']), ['MANAGER', 'STAFF'])).toThrow(
      ForbiddenIdentityAccessError,
    );
  });

  it('reads consultation access from the unique account/consultation key', async () => {
    const findUnique = () => Promise.resolve({ level: 'FULL' as const });
    const repository = createPrismaConsultationAccessRepository({
      consultationAccess: { findUnique },
    } as never);
    await expect(repository.findLevel(randomUUID(), randomUUID())).resolves.toBe('FULL');

    const missing = createPrismaConsultationAccessRepository({
      consultationAccess: { findUnique: () => Promise.resolve(null) },
    } as never);
    await expect(missing.findLevel(randomUUID(), randomUUID())).resolves.toBeNull();
  });
});
