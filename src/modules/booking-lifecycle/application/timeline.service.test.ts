/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method -- Vitest asymmetric matchers and method spies intentionally cross the typed mock boundary. */
import { describe, expect, it, vi } from 'vitest';

import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import type { TimelineRevision } from '../domain/timeline.policy.js';
import { createTimelineService, type TimelineRepository } from './timeline.service.js';

const current = Object.freeze({
  revisionId: '00000000-0000-4000-8000-000000000001',
  bookingId: '00000000-0000-4000-8000-000000000002',
  revisionNumber: 1,
  predecessorRevisionId: null,
  state: 'CURRENT' as const,
  managerApprovedAt: null,
  coupleApprovedAt: null,
  mutuallyApproved: false,
  items: Object.freeze([
    Object.freeze({
      itemId: '00000000-0000-4000-8000-000000000003',
      order: 0,
      startTime: '18:00',
      title: 'Welcome',
      description: null,
    }),
  ]),
  createdAt: new Date('2026-10-07T10:00:00.000Z'),
}) satisfies TimelineRevision;

describe('TimelineService', () => {
  it('allows an own restricted collaborator to create a successor', async () => {
    const repository = repositoryFixture();
    const access = accessReader();
    const service = createTimelineService({
      repository,
      access,
      createId: () => '00000000-0000-4000-8000-000000000010',
      now: () => new Date('2026-10-07T11:00:00.000Z'),
    });

    await service.save({
      bookingId: current.bookingId,
      expectedBookingRevision: 1,
      predecessorRevisionId: current.revisionId,
      items: [{ ...current.items[0]!, title: 'Updated welcome' }],
      actor: { accountId: '00000000-0000-4000-8000-000000000020', roles: ['COUPLE'] },
      requestId: '00000000-0000-4000-8000-000000000021',
    });

    expect(access.requireAccess).toHaveBeenCalledWith({
      accountId: '00000000-0000-4000-8000-000000000020',
      consultationId: '00000000-0000-4000-8000-000000000030',
      minimum: 'RESTRICTED',
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        party: 'COUPLE',
        revision: expect.objectContaining({ revisionNumber: 2 }),
      }),
    );
  });

  it('derives Manager approval from the booking owner and exact revision', async () => {
    const repository = repositoryFixture();
    const service = createTimelineService({ repository, access: accessReader() });
    await service.approve({
      bookingId: current.bookingId,
      timelineRevisionId: current.revisionId,
      expectedBookingRevision: 1,
      actor: { accountId: 'manager', roles: ['MANAGER'] },
      requestId: '00000000-0000-4000-8000-000000000021',
    });

    expect(repository.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        party: 'MANAGER',
        timelineRevisionId: current.revisionId,
      }),
    );
  });

  it('returns a canonical no-op without writing a successor', async () => {
    const repository = repositoryFixture();
    const service = createTimelineService({ repository, access: accessReader() });
    const result = await service.save({
      bookingId: current.bookingId,
      expectedBookingRevision: 1,
      predecessorRevisionId: current.revisionId,
      items: current.items,
      actor: { accountId: 'manager', roles: ['MANAGER'] },
      requestId: '00000000-0000-4000-8000-000000000021',
    });

    expect(result).toEqual({ changed: false, revision: current, bookingRevision: 1 });
    expect(repository.save).not.toHaveBeenCalled();
  });
});

function repositoryFixture(): TimelineRepository {
  return {
    getContext: vi.fn().mockResolvedValue({
      consultationId: '00000000-0000-4000-8000-000000000030',
      managerAccountId: 'manager',
      bookingRevision: 1,
      phase: 'DRAFT',
      shift: { startTime: '17:30', endTime: '22:00' },
      currentRevision: current,
    }),
    save: vi
      .fn()
      .mockImplementation(({ revision }) =>
        Promise.resolve({ changed: true, revision, bookingRevision: 2 }),
      ),
    approve: vi
      .fn()
      .mockImplementation(({ approvedRevision }) =>
        Promise.resolve({ revision: approvedRevision, bookingRevision: 2 }),
      ),
    withdraw: vi.fn(),
  };
}

function accessReader(): ConsultationAccessReader {
  return { requireAccess: vi.fn().mockResolvedValue({ level: 'RESTRICTED' }) };
}
