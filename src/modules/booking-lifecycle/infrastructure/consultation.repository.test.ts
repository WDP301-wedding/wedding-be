/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../../generated/prisma/client.js';

import type { ConsultationRecord, InvitationIntent } from '../application/consultation.service.js';
import type { ProposalSnapshot } from '../domain/booking-policy.js';
import {
  BookingLifecycleConflictError,
  createPrismaConsultationRepository,
  createPrismaConsultationWorkspaceRepository,
} from './consultation.repository.js';

const proposal: ProposalSnapshot = Object.freeze({
  hall: Object.freeze({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Garden Hall',
    description: 'Garden venue',
    maxGuests: 500,
  }),
  shift: Object.freeze({ code: 'DINNER', startTime: '17:30', endTime: '22:00' }),
  menu: Object.freeze({
    versionId: '00000000-0000-4000-8000-000000000002',
    packageId: '00000000-0000-4000-8000-000000000003',
    versionNumber: 2,
    name: 'Autumn menu',
    description: 'Published menu snapshot',
    priceVndPerTable: 5_000_001,
  }),
  eventDate: '2026-12-20',
  tableCount: 3,
  planningHeadcount: 25,
  baseChargeVnd: 15_000_003,
  depositAmountVnd: 4_500_001,
});

const record: ConsultationRecord = Object.freeze({
  consultationId: '00000000-0000-4000-8000-000000000010',
  bookingId: '00000000-0000-4000-8000-000000000011',
  intendedEmail: ' Couple@Example.com ',
  displayName: 'Minh and An',
  note: null,
  managerAccountId: '00000000-0000-4000-8000-000000000012',
  revision: 1,
  phase: 'DRAFT',
  proposal,
  requestId: '00000000-0000-4000-8000-000000000013',
});

const intent: InvitationIntent = Object.freeze({
  consultationId: record.consultationId,
  invitationIntentId: '00000000-0000-4000-8000-000000000020',
  intendedEmail: 'Couple@Example.com',
  managerAccountId: record.managerAccountId,
  expectedRevision: 1,
  requestId: '00000000-0000-4000-8000-000000000021',
  status: 'PENDING',
  invitationId: null,
});

describe('PrismaConsultationRepository', () => {
  it('conceals missing recipients and workspace ownership, and guards revisions and existing bookings', async () => {
    const consultation = {
      id: record.consultationId,
      managerAccountId: record.managerAccountId,
      intendedEmailNormalized: 'couple@example.com',
      intendedEmail: 'Couple@Example.com',
      revision: 1,
      booking: null,
    };
    const transaction = {
      consultation: {
        findUnique: vi.fn().mockResolvedValue(consultation),
        findFirst: vi.fn().mockResolvedValue(consultation),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      booking: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      consultation: transaction.consultation,
      $transaction: vi.fn(async (work: (tx: object) => Promise<unknown>) => work(transaction)),
    };
    const repository = createPrismaConsultationRepository(prisma as never);
    expect(
      await repository.getInvitationRecipient(record.consultationId, record.managerAccountId),
    ).toEqual({ intendedEmail: 'Couple@Example.com' });
    transaction.consultation.findFirst.mockResolvedValue(null);
    await expect(
      repository.getInvitationRecipient(record.consultationId, 'outsider'),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
    const workspace = createPrismaConsultationWorkspaceRepository(prisma as never);
    const input = {
      bookingId: record.bookingId,
      consultationId: record.consultationId,
      expectedConsultationRevision: 1,
      managerAccountId: record.managerAccountId,
      proposal,
      requestId: record.requestId,
    };
    for (const stored of [
      null,
      { ...consultation, managerAccountId: 'outsider' },
      { ...consultation, revision: 2 },
      { ...consultation, booking: { id: record.bookingId } },
    ]) {
      transaction.consultation.findUnique.mockResolvedValue(stored);
      await expect(workspace.createBooking(input)).rejects.toMatchObject({
        code:
          stored === null || stored.managerAccountId === 'outsider'
            ? 'BOOKING_NOT_FOUND'
            : 'STALE_BOOKING_REVISION',
      });
    }
    transaction.consultation.findUnique.mockResolvedValue(consultation);
    transaction.consultation.updateMany.mockResolvedValue({ count: 0 });
    await expect(workspace.createBooking(input)).rejects.toMatchObject({
      code: 'STALE_BOOKING_REVISION',
    });
  });

  it('preserves unexpected errors and maps duplicate consultation writes to a stable conflict', async () => {
    const prisma = { $transaction: vi.fn().mockRejectedValue(new Error('database unavailable')) };
    const legacy = createPrismaConsultationRepository(prisma as never);
    const workspace = createPrismaConsultationWorkspaceRepository(prisma as never);
    for (const create of [() => legacy.create(record), () => workspace.createConsultation(record)])
      await expect(create()).rejects.toThrow('database unavailable');
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    for (const create of [() => legacy.create(record), () => workspace.createConsultation(record)])
      await expect(create()).rejects.toMatchObject({ code: 'CONSULTATION_ALREADY_EXISTS' });
  });

  it('guards invitation ownership, recipient, revision, and durable replay evidence', async () => {
    const consultation = {
      id: record.consultationId,
      managerAccountId: record.managerAccountId,
      intendedEmailNormalized: 'couple@example.com',
      revision: 1,
    };
    const transaction = {
      consultation: { findUnique: vi.fn() },
      bookingInvitationIntent: { findUnique: vi.fn().mockResolvedValue(storedIntent(intent)) },
      auditLog: { create: vi.fn() },
    };
    const repository = createPrismaConsultationRepository(transactionClient(transaction));
    for (const stored of [
      null,
      { ...consultation, managerAccountId: 'outsider' },
      { ...consultation, intendedEmailNormalized: 'other@example.com' },
      { ...consultation, revision: 2 },
    ]) {
      transaction.consultation.findUnique.mockResolvedValue(stored);
      await expect(repository.getOrCreateInvitationIntent(intent)).rejects.toMatchObject({
        code: stored?.revision === 2 ? 'STALE_BOOKING_REVISION' : 'BOOKING_NOT_FOUND',
      });
    }
    transaction.consultation.findUnique.mockResolvedValue(consultation);
    for (const patch of [
      { managerAccountId: 'outsider' },
      { intendedEmail: 'other@example.com' },
      { expectedRevision: 2 },
    ]) {
      transaction.bookingInvitationIntent.findUnique.mockResolvedValue({
        ...storedIntent(intent),
        ...patch,
      });
      await expect(repository.getOrCreateInvitationIntent(intent)).rejects.toMatchObject({
        code: 'INVITATION_INTENT_CONFLICT',
      });
    }
    transaction.bookingInvitationIntent.findUnique.mockResolvedValue(null);
    await expect(
      repository.markInvitationIssued(record.consultationId, 'invitation'),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });
  });

  it('recovers the winning invitation intent after a uniqueness race and rejects absent winners', async () => {
    const prisma = {
      $transaction: vi.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
      bookingInvitationIntent: { findUnique: vi.fn().mockResolvedValue(storedIntent(intent)) },
    };
    const repository = createPrismaConsultationRepository(prisma as never);
    expect(await repository.getOrCreateInvitationIntent(intent)).toEqual(intent);
    prisma.bookingInvitationIntent.findUnique.mockResolvedValue(null);
    await expect(repository.getOrCreateInvitationIntent(intent)).rejects.toMatchObject({
      code: 'INVITATION_INTENT_CONFLICT',
    });
  });
  it('returns both server revisions after booking creation advances the consultation', async () => {
    const transaction = {
      consultation: {
        findUnique: vi.fn().mockResolvedValue({
          id: record.consultationId,
          revision: 1,
          managerAccountId: record.managerAccountId,
          booking: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      booking: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const result = await createPrismaConsultationWorkspaceRepository(
      transactionClient(transaction),
      fixedNow,
    ).createBooking({
      bookingId: record.bookingId,
      consultationId: record.consultationId,
      expectedConsultationRevision: 1,
      managerAccountId: record.managerAccountId,
      proposal,
      requestId: record.requestId,
    });
    expect(result.bookingRevision).toBe(1);
    expect(result.consultationRevision).toBe(2);
  });
  it('stores consultation, booking, proposal, and audit in one transaction', async () => {
    const transaction = {
      consultation: { create: vi.fn().mockResolvedValue({ id: record.consultationId }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = transactionClient(transaction);

    await expect(
      createPrismaConsultationRepository(prisma, fixedNow).create(record),
    ).resolves.toEqual(record);

    expect(transaction.consultation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: record.consultationId,
        intendedEmail: 'Couple@Example.com',
        intendedEmailNormalized: 'couple@example.com',
        booking: {
          create: expect.objectContaining({
            id: record.bookingId,
            eventDate: new Date('2026-12-20T00:00:00.000Z'),
            proposalSnapshot: {
              create: expect.objectContaining({
                menuPriceVndPerTable: 5_000_001,
                depositAmountVnd: 4_500_001,
              }),
            },
          }),
        },
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('reuses one pending invitation intent for an exact retry', async () => {
    const stored = storedIntent(intent);
    const transaction = {
      consultation: {
        findUnique: vi.fn().mockResolvedValue({
          id: record.consultationId,
          managerAccountId: record.managerAccountId,
          intendedEmailNormalized: 'couple@example.com',
          revision: 1,
        }),
      },
      bookingInvitationIntent: {
        findUnique: vi.fn().mockResolvedValue(stored),
        create: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };

    const result = await createPrismaConsultationRepository(
      transactionClient(transaction),
      fixedNow,
    ).getOrCreateInvitationIntent(intent);

    expect(result).toEqual(intent);
    expect(transaction.bookingInvitationIntent.create).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('preserves the durable invitation request across new HTTP trace IDs', async () => {
    const transaction = {
      consultation: {
        findUnique: vi.fn().mockResolvedValue({
          id: record.consultationId,
          managerAccountId: record.managerAccountId,
          intendedEmailNormalized: 'couple@example.com',
          revision: 1,
        }),
      },
      bookingInvitationIntent: {
        findUnique: vi.fn().mockResolvedValue(storedIntent(intent)),
        create: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };

    const repository = createPrismaConsultationRepository(transactionClient(transaction), fixedNow);
    await expect(
      repository.getOrCreateInvitationIntent({ ...intent, requestId: record.requestId }),
    ).resolves.toMatchObject({
      requestId: intent.requestId,
      invitationIntentId: intent.invitationIntentId,
    });
  });

  it('marks issuance once and treats an exact completion replay as success', async () => {
    const issuedInvitationId = '00000000-0000-4000-8000-000000000030';
    const pending = storedIntent(intent);
    const issued = {
      ...pending,
      status: 'ISSUED',
      invitationId: issuedInvitationId,
      issuedAt: fixedNow(),
    };
    const transaction = {
      bookingInvitationIntent: {
        findUnique: vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(issued),
        update: vi.fn().mockResolvedValue(issued),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const repository = createPrismaConsultationRepository(transactionClient(transaction), fixedNow);

    await expect(
      repository.markInvitationIssued(record.consultationId, issuedInvitationId),
    ).resolves.toMatchObject({ status: 'ISSUED', invitationId: issuedInvitationId });
    await expect(
      repository.markInvitationIssued(record.consultationId, issuedInvitationId),
    ).resolves.toMatchObject({ status: 'ISSUED', invitationId: issuedInvitationId });
    expect(transaction.bookingInvitationIntent.update).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('rejects an invitation completion with different evidence', async () => {
    const transaction = {
      bookingInvitationIntent: {
        findUnique: vi.fn().mockResolvedValue({
          ...storedIntent(intent),
          status: 'ISSUED',
          invitationId: '00000000-0000-4000-8000-000000000099',
          issuedAt: fixedNow(),
        }),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const repository = createPrismaConsultationRepository(transactionClient(transaction), fixedNow);

    await expect(
      repository.markInvitationIssued(
        record.consultationId,
        '00000000-0000-4000-8000-000000000030',
      ),
    ).rejects.toBeInstanceOf(BookingLifecycleConflictError);
  });
});

function fixedNow(): Date {
  return new Date('2026-10-07T10:00:00.000Z');
}

function storedIntent(value: InvitationIntent) {
  return {
    id: value.invitationIntentId,
    consultationId: value.consultationId,
    intendedEmail: value.intendedEmail,
    managerAccountId: value.managerAccountId,
    expectedRevision: value.expectedRevision,
    requestId: value.requestId,
    status: value.status,
    invitationId: value.invitationId,
    failureCount: 0,
    issuedAt: null,
    createdAt: fixedNow(),
    updatedAt: fixedNow(),
  };
}

function transactionClient(transaction: object) {
  return {
    $transaction: vi.fn(async (operation: (client: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as never;
}
