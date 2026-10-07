import { randomUUID } from 'node:crypto';

import { AppError } from '../../../core/errors/app-error.js';
import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import type { BookingPhase } from '../domain/booking-policy.js';
import {
  approveTimelineRevision,
  createTimelineRevision,
  withdrawTimelineApproval,
  type TimelineItem,
  type TimelineParty,
  type TimelineRevision,
} from '../domain/timeline.policy.js';

export type TimelineActor = Readonly<{
  accountId: string;
  roles: readonly ('MANAGER' | 'STAFF' | 'COUPLE')[];
}>;

export type TimelineContext = Readonly<{
  consultationId: string;
  managerAccountId: string;
  bookingRevision: number;
  phase: BookingPhase;
  shift: Readonly<{ startTime: string; endTime: string }>;
  currentRevision: TimelineRevision | null;
}>;

export interface TimelineRepository {
  getContext(bookingId: string): Promise<TimelineContext>;
  save(
    input: Readonly<{
      revision: TimelineRevision;
      expectedBookingRevision: number;
      actorAccountId: string;
      party: TimelineParty;
      requestId: string;
    }>,
  ): Promise<Readonly<{ changed: true; revision: TimelineRevision; bookingRevision: number }>>;
  approve(
    input: Readonly<{
      bookingId: string;
      timelineRevisionId: string;
      expectedBookingRevision: number;
      approvedRevision: TimelineRevision;
      decisionAt: Date;
      actorAccountId: string;
      party: TimelineParty;
      requestId: string;
    }>,
  ): Promise<Readonly<{ revision: TimelineRevision; bookingRevision: number }>>;
  withdraw(
    input: Readonly<{
      bookingId: string;
      timelineRevisionId: string;
      expectedBookingRevision: number;
      withdrawnRevision: TimelineRevision;
      decisionAt: Date;
      reason: string;
      actorAccountId: string;
      party: TimelineParty;
      requestId: string;
    }>,
  ): Promise<Readonly<{ revision: TimelineRevision; bookingRevision: number }>>;
}

export class TimelineConflictError extends AppError {
  constructor(
    code: 'STALE_BOOKING_REVISION' | 'TIMELINE_REVISION_SUPERSEDED' | 'DEPOSIT_INTENT_ACTIVE',
  ) {
    super({
      status: 409,
      code,
      message:
        code === 'STALE_BOOKING_REVISION'
          ? 'The booking changed after it was loaded.'
          : code === 'DEPOSIT_INTENT_ACTIVE'
            ? 'An unresolved deposit attempt blocks this operation.'
            : 'The timeline revision is no longer current.',
    });
  }
}

export function createTimelineService(
  options: Readonly<{
    repository: TimelineRepository;
    access: ConsultationAccessReader;
    createId?: () => string;
    now?: () => Date;
  }>,
) {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async save(
      input: Readonly<{
        bookingId: string;
        expectedBookingRevision: number;
        predecessorRevisionId: string | null;
        items: readonly Readonly<{
          itemId?: string;
          order: number;
          startTime: string;
          title: string;
          description: string | null;
        }>[];
        actor: TimelineActor;
        requestId: string;
      }>,
    ) {
      const context = await options.repository.getContext(input.bookingId);
      const party = await authorize(options.access, context, input.actor);
      requireBookingRevision(context, input.expectedBookingRevision);
      if ((context.currentRevision?.revisionId ?? null) !== input.predecessorRevisionId) {
        throw new TimelineConflictError('TIMELINE_REVISION_SUPERSEDED');
      }
      const candidate = createTimelineRevision({
        revisionId: createId(),
        bookingId: input.bookingId,
        predecessor: context.currentRevision,
        items: input.items.map((item) => ({ ...item, itemId: item.itemId ?? createId() })),
        shift: context.shift,
        createdAt: now(),
      });
      if (!candidate.changed) {
        return Object.freeze({
          changed: false as const,
          revision: candidate.revision,
          bookingRevision: context.bookingRevision,
        });
      }
      return options.repository.save({
        revision: candidate.revision,
        expectedBookingRevision: input.expectedBookingRevision,
        actorAccountId: input.actor.accountId,
        party,
        requestId: input.requestId,
      });
    },

    async approve(
      input: Readonly<{
        bookingId: string;
        timelineRevisionId: string;
        expectedBookingRevision: number;
        actor: TimelineActor;
        requestId: string;
      }>,
    ) {
      const context = await options.repository.getContext(input.bookingId);
      const party = await authorize(options.access, context, input.actor);
      requireBookingRevision(context, input.expectedBookingRevision);
      const current = requireExactCurrent(context, input.timelineRevisionId);
      const existingApproval =
        party === 'MANAGER' ? current.managerApprovedAt : current.coupleApprovedAt;
      if (existingApproval !== null) {
        return Object.freeze({ revision: current, bookingRevision: context.bookingRevision });
      }
      const decisionAt = now();
      return options.repository.approve({
        bookingId: input.bookingId,
        timelineRevisionId: input.timelineRevisionId,
        expectedBookingRevision: input.expectedBookingRevision,
        approvedRevision: approveTimelineRevision(current, party, decisionAt),
        decisionAt,
        actorAccountId: input.actor.accountId,
        party,
        requestId: input.requestId,
      });
    },

    async withdraw(
      input: Readonly<{
        bookingId: string;
        timelineRevisionId: string;
        expectedBookingRevision: number;
        reason: string;
        actor: TimelineActor;
        requestId: string;
      }>,
    ) {
      const context = await options.repository.getContext(input.bookingId);
      const party = await authorize(options.access, context, input.actor);
      requireBookingRevision(context, input.expectedBookingRevision);
      const current = requireExactCurrent(context, input.timelineRevisionId);
      const reason = input.reason.trim().normalize('NFC');
      if (reason.length < 1 || reason.length > 500) {
        throw new RangeError('Timeline withdrawal reason must contain 1 through 500 characters.');
      }
      const existingApproval =
        party === 'MANAGER' ? current.managerApprovedAt : current.coupleApprovedAt;
      if (existingApproval === null) {
        return Object.freeze({ revision: current, bookingRevision: context.bookingRevision });
      }
      return options.repository.withdraw({
        bookingId: input.bookingId,
        timelineRevisionId: input.timelineRevisionId,
        expectedBookingRevision: input.expectedBookingRevision,
        withdrawnRevision: withdrawTimelineApproval(current, party, context.phase),
        decisionAt: now(),
        reason,
        actorAccountId: input.actor.accountId,
        party,
        requestId: input.requestId,
      });
    },
  });
}

async function authorize(
  access: ConsultationAccessReader,
  context: TimelineContext,
  actor: TimelineActor,
): Promise<TimelineParty> {
  if (actor.accountId === context.managerAccountId && actor.roles.includes('MANAGER')) {
    return 'MANAGER';
  }
  await access.requireAccess({
    accountId: actor.accountId,
    consultationId: context.consultationId,
    minimum: 'RESTRICTED',
  });
  return 'COUPLE';
}

function requireBookingRevision(context: TimelineContext, expected: number): void {
  if (context.bookingRevision !== expected) {
    throw new TimelineConflictError('STALE_BOOKING_REVISION');
  }
}

function requireExactCurrent(context: TimelineContext, revisionId: string): TimelineRevision {
  if (context.currentRevision === null || context.currentRevision.revisionId !== revisionId) {
    throw new TimelineConflictError('TIMELINE_REVISION_SUPERSEDED');
  }
  return context.currentRevision;
}

export function timelineItems(value: readonly TimelineItem[]): readonly TimelineItem[] {
  return value;
}
