import { AppError } from '../../../core/errors/app-error.js';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { normalizeEmail } from '../../identity-access/account/account.service.js';
import type { ConsultationWorkspaceRepository } from '../application/consultation-workspace.service.js';
import type {
  ConsultationRecord,
  ConsultationRepository,
  InvitationIntent,
} from '../application/consultation.service.js';

type BookingLifecycleConflictCode =
  | 'CONSULTATION_ALREADY_EXISTS'
  | 'STALE_BOOKING_REVISION'
  | 'INVITATION_INTENT_CONFLICT'
  | 'BOOKING_ALREADY_EXISTS';

const conflictMessages: Readonly<Record<BookingLifecycleConflictCode, string>> = {
  CONSULTATION_ALREADY_EXISTS: 'The consultation already exists.',
  BOOKING_ALREADY_EXISTS: 'This consultation already has a booking. Resume its existing booking.',
  STALE_BOOKING_REVISION: 'The booking changed after it was loaded.',
  INVITATION_INTENT_CONFLICT: 'The invitation request conflicts with its durable intent.',
};

export class BookingLifecycleConflictError extends AppError {
  constructor(code: BookingLifecycleConflictCode) {
    super({ status: 409, code, message: conflictMessages[code] });
  }
}

export class BookingLifecycleNotFoundError extends AppError {
  constructor() {
    super({
      status: 404,
      code: 'BOOKING_NOT_FOUND',
      message: 'The requested booking was not found.',
    });
  }
}

export function createPrismaConsultationRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): ConsultationRepository {
  return Object.freeze({
    async getInvitationRecipient(consultationId: string, managerAccountId: string) {
      const consultation = await prisma.consultation.findFirst({
        where: { id: consultationId, managerAccountId },
        select: { intendedEmail: true },
      });
      if (consultation === null) throw new BookingLifecycleNotFoundError();
      return Object.freeze({ intendedEmail: consultation.intendedEmail });
    },

    async create(record: Parameters<ConsultationRepository['create']>[0]) {
      const email = normalizeEmail(record.intendedEmail);
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.consultation.create({
            data: {
              id: record.consultationId,
              managerAccountId: record.managerAccountId,
              intendedEmailNormalized: email.normalized,
              intendedEmail: email.display,
              displayName: record.displayName,
              brideName: record.brideName ?? null,
              groomName: record.groomName ?? null,
              note: record.note,
              revision: record.revision,
              booking: {
                create: {
                  id: record.bookingId,
                  hallId: record.proposal.hall.id,
                  eventDate: localDate(record.proposal.eventDate),
                  shiftCode: record.proposal.shift.code,
                  phase: record.phase,
                  revision: record.revision,
                  planningHeadcount: record.proposal.planningHeadcount,
                  proposalSnapshot: { create: proposalData(record) },
                },
              },
            },
          });
          await transaction.auditLog.create({
            data: {
              occurredAt: now(),
              requestId: record.requestId,
              actorType: 'USER',
              actorId: record.managerAccountId,
              action: 'booking.consultation-created',
              entityType: 'consultation',
              entityId: record.consultationId,
              metadata: {
                bookingId: record.bookingId,
                hallId: record.proposal.hall.id,
                menuPackageVersionId: record.proposal.menu.versionId,
                menuPackageVersionIds: record.proposal.menus?.map((line) => line.versionId) ?? [
                  record.proposal.menu.versionId,
                ],
              },
            },
          });
        });
      } catch (error: unknown) {
        if (isKnownRequestError(error, 'P2002')) {
          throw new BookingLifecycleConflictError('CONSULTATION_ALREADY_EXISTS');
        }
        throw error;
      }
      return immutable(record);
    },

    async getOrCreateInvitationIntent(
      input: Parameters<ConsultationRepository['getOrCreateInvitationIntent']>[0],
    ) {
      try {
        return await prisma.$transaction(
          async (transaction) => {
            const consultation = await transaction.consultation.findUnique({
              where: { id: input.consultationId },
              select: {
                id: true,
                managerAccountId: true,
                intendedEmailNormalized: true,
                revision: true,
              },
            });
            const requestedEmail = normalizeEmail(input.intendedEmail);
            if (
              consultation === null ||
              consultation.managerAccountId !== input.managerAccountId ||
              consultation.intendedEmailNormalized !== requestedEmail.normalized
            ) {
              throw new BookingLifecycleNotFoundError();
            }
            const existing = await transaction.bookingInvitationIntent.findUnique({
              where: { consultationId: input.consultationId },
            });
            if (existing !== null) {
              return validateIntentReplay(existing, input, consultation.revision);
            }
            if (consultation.revision !== input.expectedRevision) {
              throw new BookingLifecycleConflictError('STALE_BOOKING_REVISION');
            }

            const created = await transaction.bookingInvitationIntent.create({
              data: {
                id: input.invitationIntentId,
                consultationId: input.consultationId,
                intendedEmail: requestedEmail.display,
                managerAccountId: input.managerAccountId,
                expectedRevision: input.expectedRevision,
                requestId: input.requestId,
                status: 'PENDING',
              },
            });
            await transaction.auditLog.create({
              data: {
                occurredAt: now(),
                requestId: input.requestId,
                actorType: 'USER',
                actorId: input.managerAccountId,
                action: 'booking.workspace-invitation-requested',
                entityType: 'consultation',
                entityId: input.consultationId,
                metadata: { invitationIntentId: input.invitationIntentId },
              },
            });
            return toInvitationIntent(created);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error: unknown) {
        if (isKnownRequestError(error, 'P2002')) {
          const winner = await prisma.bookingInvitationIntent.findUnique({
            where: { consultationId: input.consultationId },
          });
          if (winner !== null) return validateIntentReplay(winner, input);
          throw new BookingLifecycleConflictError('INVITATION_INTENT_CONFLICT');
        }
        throw error;
      }
    },

    markInvitationIssued(
      consultationId: Parameters<ConsultationRepository['markInvitationIssued']>[0],
      invitationId: Parameters<ConsultationRepository['markInvitationIssued']>[1],
    ) {
      return prisma.$transaction(
        async (transaction) => {
          const current = await transaction.bookingInvitationIntent.findUnique({
            where: { consultationId },
          });
          if (current === null) throw new BookingLifecycleNotFoundError();
          if (current.status === 'ISSUED') {
            if (current.invitationId !== invitationId) {
              throw new BookingLifecycleConflictError('INVITATION_INTENT_CONFLICT');
            }
            return toInvitationIntent(current);
          }

          const issued = await transaction.bookingInvitationIntent.update({
            where: { consultationId },
            data: { status: 'ISSUED', invitationId, issuedAt: now() },
          });
          await transaction.auditLog.create({
            data: {
              occurredAt: now(),
              requestId: current.requestId,
              actorType: 'USER',
              actorId: current.managerAccountId,
              action: 'booking.workspace-invitation-issued',
              entityType: 'consultation',
              entityId: consultationId,
              metadata: { invitationIntentId: current.id, invitationId },
            },
          });
          return toInvitationIntent(issued);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  });
}

export function createPrismaConsultationWorkspaceRepository(
  prisma: PrismaClient,
  now: () => Date = () => new Date(),
): ConsultationWorkspaceRepository {
  return Object.freeze({
    async createConsultation(
      record: Parameters<ConsultationWorkspaceRepository['createConsultation']>[0],
    ) {
      const email = normalizeEmail(record.intendedEmail);
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.consultation.create({
            data: {
              id: record.consultationId,
              managerAccountId: record.managerAccountId,
              intendedEmailNormalized: email.normalized,
              intendedEmail: email.display,
              displayName: record.displayName,
              brideName: record.brideName ?? null,
              groomName: record.groomName ?? null,
              note: record.note,
              revision: record.revision,
            },
          });
          await transaction.auditLog.create({
            data: {
              occurredAt: now(),
              requestId: record.requestId,
              actorType: 'USER',
              actorId: record.managerAccountId,
              action: 'booking.consultation-created',
              entityType: 'consultation',
              entityId: record.consultationId,
              metadata: {},
            },
          });
        });
      } catch (error: unknown) {
        if (isKnownRequestError(error, 'P2002')) {
          throw new BookingLifecycleConflictError('CONSULTATION_ALREADY_EXISTS');
        }
        throw error;
      }
      return immutable({ ...record, intendedEmail: email.display });
    },

    async createBooking(record: Parameters<ConsultationWorkspaceRepository['createBooking']>[0]) {
      return prisma.$transaction(
        async (transaction) => {
          const consultation = await transaction.consultation.findUnique({
            where: { id: record.consultationId },
            select: {
              id: true,
              revision: true,
              managerAccountId: true,
              booking: { select: { id: true } },
            },
          });
          if (consultation === null || consultation.managerAccountId !== record.managerAccountId) {
            throw new BookingLifecycleNotFoundError();
          }
          if (consultation.booking !== null)
            throw new BookingLifecycleConflictError('BOOKING_ALREADY_EXISTS');
          if (consultation.revision !== record.expectedConsultationRevision) {
            throw new BookingLifecycleConflictError('STALE_BOOKING_REVISION');
          }
          await transaction.booking.create({
            data: {
              id: record.bookingId,
              consultationId: record.consultationId,
              hallId: record.proposal.hall.id,
              eventDate: localDate(record.proposal.eventDate),
              shiftCode: record.proposal.shift.code,
              phase: 'DRAFT',
              revision: 1,
              planningHeadcount: record.proposal.planningHeadcount,
              proposalSnapshot: { create: proposalSnapshotData(record.proposal) },
              commercialContract: { create: { modelVersion: 'FULL_CONTRACT_V1' } },
            },
          });
          const updated = await transaction.consultation.updateMany({
            where: { id: record.consultationId, revision: record.expectedConsultationRevision },
            data: { revision: { increment: 1 } },
          });
          if (updated.count !== 1) {
            throw new BookingLifecycleConflictError('STALE_BOOKING_REVISION');
          }
          await transaction.auditLog.create({
            data: {
              occurredAt: now(),
              requestId: record.requestId,
              actorType: 'USER',
              actorId: record.managerAccountId,
              action: 'booking.proposal-created',
              entityType: 'booking',
              entityId: record.bookingId,
              metadata: {
                consultationId: record.consultationId,
                hallId: record.proposal.hall.id,
                menuPackageVersionId: record.proposal.menu.versionId,
                menuPackageVersionIds: record.proposal.menus?.map((line) => line.versionId) ?? [
                  record.proposal.menu.versionId,
                ],
              },
            },
          });
          return immutable({
            ...record,
            bookingRevision: 1,
            consultationRevision: record.expectedConsultationRevision + 1,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    },
  });
}

function proposalData(record: ConsultationRecord) {
  return proposalSnapshotData(record.proposal);
}

function proposalSnapshotData(proposal: ConsultationRecord['proposal']) {
  return {
    hallId: proposal.hall.id,
    hallName: proposal.hall.name,
    hallDescription: proposal.hall.description,
    hallMaxGuests: proposal.hall.maxGuests,
    shiftCode: proposal.shift.code,
    shiftStartTime: localTime(proposal.shift.startTime),
    shiftEndTime: localTime(proposal.shift.endTime),
    menuPackageId: proposal.menu.packageId,
    menuPackageVersionId: proposal.menu.versionId,
    menuVersionNumber: proposal.menu.versionNumber,
    menuName: proposal.menu.name,
    menuDescription: proposal.menu.description,
    menuPriceVndPerTable: proposal.menu.priceVndPerTable,
    ...(proposal.menus === undefined ? {} : { menus: proposal.menus.map((line) => ({ ...line })) }),
    tableCount: proposal.tableCount,
    planningHeadcount: proposal.planningHeadcount,
    baseChargeVnd: proposal.baseChargeVnd,
    depositAmountVnd: proposal.depositAmountVnd,
  };
}

type StoredIntent = Readonly<{
  id: string;
  consultationId: string;
  intendedEmail: string;
  managerAccountId: string;
  expectedRevision: number;
  requestId: string;
  status: 'PENDING' | 'ISSUED';
  invitationId: string | null;
}>;

function validateIntentReplay(
  stored: StoredIntent,
  input: InvitationIntent,
  currentRevision: number = input.expectedRevision,
): InvitationIntent {
  if (
    stored.consultationId !== input.consultationId ||
    stored.managerAccountId !== input.managerAccountId ||
    normalizeEmail(stored.intendedEmail).normalized !==
      normalizeEmail(input.intendedEmail).normalized ||
    stored.expectedRevision > currentRevision
  ) {
    throw new BookingLifecycleConflictError('INVITATION_INTENT_CONFLICT');
  }
  // A durable request survives unrelated workspace writes. Accept its original
  // revision or the refreshed workspace revision without replacing its evidence.
  if (
    input.expectedRevision !== stored.expectedRevision &&
    input.expectedRevision !== currentRevision
  ) {
    throw new BookingLifecycleConflictError('STALE_BOOKING_REVISION');
  }
  return toInvitationIntent(stored);
}

function toInvitationIntent(stored: StoredIntent): InvitationIntent {
  return immutable({
    consultationId: stored.consultationId,
    invitationIntentId: stored.id,
    intendedEmail: stored.intendedEmail,
    managerAccountId: stored.managerAccountId,
    expectedRevision: stored.expectedRevision,
    requestId: stored.requestId,
    status: stored.status,
    invitationId: stored.invitationId,
  });
}

function localDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function localTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function isKnownRequestError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function immutable<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
