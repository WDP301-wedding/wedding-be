import { describe, expect, it, vi } from 'vitest';

import type { ConsultationRecord, InvitationIntent } from '../application/consultation.service.js';
import type { ProposalSnapshot } from '../domain/booking-policy.js';
import {
  BookingLifecycleConflictError,
  createPrismaConsultationRepository,
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

  it('rejects a retry that changes the durable invitation request', async () => {
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
    ).rejects.toMatchObject({ code: 'INVITATION_INTENT_CONFLICT' });
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
