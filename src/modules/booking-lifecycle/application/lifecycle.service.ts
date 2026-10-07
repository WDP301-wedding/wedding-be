import { randomUUID } from 'node:crypto';

import type { ConsultationAccessReader } from '../../identity-access/authorization/authorization.service.js';
import type { BookingLifecycleRepository } from '../infrastructure/lifecycle.repository.js';
import { BookingLifecycleNotFoundError } from '../infrastructure/consultation.repository.js';

type LifecycleActor = Readonly<{
  accountId: string;
  roles: readonly ('MANAGER' | 'STAFF' | 'COUPLE')[];
}>;

export function createBookingLifecycleService(
  options: Readonly<{
    repository: BookingLifecycleRepository;
    access: ConsultationAccessReader;
    createId?: () => string;
  }>,
) {
  const createId = options.createId ?? randomUUID;
  return Object.freeze({
    async cancel(
      input: Readonly<{
        bookingId: string;
        expectedBookingRevision: number;
        reason: string;
        actor: LifecycleActor;
        requestId: string;
      }>,
    ) {
      await requireOwningManager(options.repository, input.bookingId, input.actor);
      return options.repository.cancel({
        bookingId: input.bookingId,
        expectedBookingRevision: input.expectedBookingRevision,
        reason: input.reason,
        context: { requestId: input.requestId, actorAccountId: input.actor.accountId },
      });
    },

    async requestCancellation(
      input: Readonly<{
        bookingId: string;
        expectedBookingRevision: number;
        reason: string;
        actor: LifecycleActor;
        requestId: string;
      }>,
    ) {
      const authorization = await options.repository.getAuthorizationContext(input.bookingId);
      await options.access.requireAccess({
        accountId: input.actor.accountId,
        consultationId: authorization.consultationId,
        minimum: 'FULL',
      });
      return options.repository.requestCancellation({
        bookingId: input.bookingId,
        cancellationRequestId: createId(),
        expectedBookingRevision: input.expectedBookingRevision,
        reason: input.reason,
        context: { requestId: input.requestId, actorAccountId: input.actor.accountId },
      });
    },

    async decideCancellation(
      input: Readonly<{
        bookingId: string;
        cancellationRequestId: string;
        expectedBookingRevision: number;
        decision: 'APPROVE' | 'REJECT';
        reason: string;
        actor: LifecycleActor;
        requestId: string;
      }>,
    ) {
      await requireOwningManager(options.repository, input.bookingId, input.actor);
      return options.repository.decideCancellation({
        bookingId: input.bookingId,
        cancellationRequestId: input.cancellationRequestId,
        expectedBookingRevision: input.expectedBookingRevision,
        decision: input.decision,
        reason: input.reason,
        context: { requestId: input.requestId, actorAccountId: input.actor.accountId },
      });
    },

    async complete(
      input: Readonly<{
        bookingId: string;
        expectedBookingRevision: number;
        actor: LifecycleActor;
        requestId: string;
      }>,
    ) {
      await requireOwningManager(options.repository, input.bookingId, input.actor);
      return options.repository.complete({
        bookingId: input.bookingId,
        expectedBookingRevision: input.expectedBookingRevision,
        context: { requestId: input.requestId, actorAccountId: input.actor.accountId },
      });
    },

    completeAsSystem(
      input: Readonly<{
        bookingId: string;
        expectedBookingRevision: number;
        requestId: string;
      }>,
    ) {
      return options.repository.complete({
        bookingId: input.bookingId,
        expectedBookingRevision: input.expectedBookingRevision,
        context: { requestId: input.requestId, actorAccountId: null },
      });
    },
  });
}

async function requireOwningManager(
  repository: BookingLifecycleRepository,
  bookingId: string,
  actor: LifecycleActor,
): Promise<void> {
  const authorization = await repository.getAuthorizationContext(bookingId);
  if (authorization.managerAccountId !== actor.accountId || !actor.roles.includes('MANAGER')) {
    throw new BookingLifecycleNotFoundError();
  }
}
