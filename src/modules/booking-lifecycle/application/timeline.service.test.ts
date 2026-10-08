/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method -- Vitest asymmetric matchers and method spies intentionally cross the typed mock boundary. */
import { describe, expect, it, vi } from 'vitest';

import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import type { TimelineRevision } from '../domain/timeline.policy.js';
import {
  createTimelineService,
  timelineItems,
  type TimelineRepository,
  type TimelineContext,
} from './timeline.service.js';

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
  const actor = { accountId: 'manager', roles: ['MANAGER'] as const };
  const command = {
    bookingId: current.bookingId,
    timelineRevisionId: current.revisionId,
    predecessorRevisionId: current.revisionId,
    items: current.items,
    expectedBookingRevision: 1,
    actor,
    requestId: 'request',
    reason: 'Changed plans',
  };
  async function setup(overrides: Partial<TimelineContext> = {}) {
    const repository = repositoryFixture();
    const original = await repository.getContext(current.bookingId);
    vi.mocked(repository.getContext).mockResolvedValue({ ...original, ...overrides });
    vi.mocked(repository.withdraw).mockImplementation(({ withdrawnRevision }) =>
      Promise.resolve({ revision: withdrawnRevision, bookingRevision: 2 }),
    );
    return { repository, service: createTimelineService({ repository, access: accessReader() }) };
  }

  it('saves a confirmed replacement with a normalized reason and new item identity', async () => {
    const { repository, service } = await setup({ phase: 'CONFIRMED' });
    await service.save({
      ...command,
      changeReason: '  Lịch gia đình  ',
      items: [{ order: 0, startTime: '18:00', title: 'Ceremony', description: null }],
    });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        changeReason: 'Lịch gia đình',
        revision: expect.objectContaining({ revisionNumber: 2 }),
      }),
    );
    expect(timelineItems(current.items)).toBe(current.items);
  });

  it.each(['', 'x'.repeat(501)])(
    'rejects invalid replacement reason length %i',
    async (changeReason) => {
      const { service } = await setup({ phase: 'CONFIRMED' });
      await expect(service.save({ ...command, changeReason })).rejects.toMatchObject({
        status: 422,
      });
    },
  );

  it('rejects stale booking revisions and predecessor pointers', async () => {
    const { service, repository } = await setup();
    await expect(service.save({ ...command, expectedBookingRevision: 9 })).rejects.toMatchObject({
      code: 'STALE_BOOKING_REVISION',
    });
    await expect(service.save({ ...command, predecessorRevisionId: null })).rejects.toMatchObject({
      code: 'TIMELINE_REVISION_SUPERSEDED',
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('creates the first immutable empty draft without a predecessor', async () => {
    const { service, repository } = await setup({ currentRevision: null });
    await service.save({ ...command, predecessorRevisionId: null, items: [] });
    expect(repository.save).toHaveBeenCalledOnce();
    await expect(service.approve(command)).rejects.toMatchObject({
      code: 'TIMELINE_REVISION_SUPERSEDED',
    });
  });

  it('replays existing own-party approvals and withdrawals without additional writes', async () => {
    const { service, repository } = await setup({
      currentRevision: {
        ...current,
        managerApprovedAt: new Date(),
        coupleApprovedAt: new Date(),
        mutuallyApproved: true,
      },
    });
    await service.approve(command);
    await service.approve({ ...command, actor: { accountId: 'couple', roles: ['COUPLE'] } });
    expect(repository.approve).not.toHaveBeenCalled();
    const empty = await setup();
    await empty.service.withdraw(command);
    await empty.service.withdraw({ ...command, actor: { accountId: 'couple', roles: ['COUPLE'] } });
    expect(empty.repository.withdraw).not.toHaveBeenCalled();
  });

  it.each(['MANAGER', 'COUPLE'] as const)(
    'withdraws only the %s approval before settlement',
    async (party) => {
      const { service, repository } = await setup({
        currentRevision: {
          ...current,
          managerApprovedAt: new Date(),
          coupleApprovedAt: new Date(),
          mutuallyApproved: true,
        },
      });
      await service.withdraw({
        ...command,
        actor: party === 'MANAGER' ? actor : { accountId: 'couple', roles: ['COUPLE'] },
      });
      expect(repository.withdraw).toHaveBeenCalledWith(
        expect.objectContaining({ party, reason: 'Changed plans' }),
      );
    },
  );

  it('requires an exact current approval revision and refuses effective withdrawal', async () => {
    const { service } = await setup();
    await expect(
      service.approve({ ...command, timelineRevisionId: 'successor' }),
    ).rejects.toMatchObject({ code: 'TIMELINE_REVISION_SUPERSEDED' });
    await expect(service.withdraw({ ...command, reason: '' })).rejects.toBeInstanceOf(RangeError);
    const confirmed = await setup({ phase: 'CONFIRMED' });
    await expect(confirmed.service.withdraw(command)).rejects.toMatchObject({
      code: 'TIMELINE_WITHDRAWAL_NOT_ALLOWED',
    });
  });
  it.each(['CANCELLED', 'COMPLETED'] as const)(
    'rejects even a no-op save after %s',
    async (phase) => {
      const repository = repositoryFixture();
      const context = await repository.getContext(current.bookingId);
      vi.mocked(repository.getContext).mockResolvedValue({ ...context, phase });
      await expect(
        createTimelineService({ repository, access: accessReader() }).save({
          bookingId: current.bookingId,
          expectedBookingRevision: 1,
          predecessorRevisionId: current.revisionId,
          items: current.items,
          actor: { accountId: 'manager', roles: ['MANAGER'] },
          requestId: 'request',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_BOOKING_TRANSITION' });
      expect(repository.save).not.toHaveBeenCalled();
    },
  );

  it('requires a change reason for a confirmed replacement', async () => {
    const repository = repositoryFixture();
    const context = await repository.getContext(current.bookingId);
    vi.mocked(repository.getContext).mockResolvedValue({ ...context, phase: 'CONFIRMED' });
    await expect(
      createTimelineService({ repository, access: accessReader() }).save({
        bookingId: current.bookingId,
        expectedBookingRevision: 1,
        predecessorRevisionId: current.revisionId,
        items: [{ ...current.items[0]!, title: 'Changed' }],
        actor: { accountId: 'manager', roles: ['MANAGER'] },
        requestId: 'request',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BOOKING_TRANSITION' });
  });
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
