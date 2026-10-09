/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { describe, expect, it, vi } from 'vitest';

import type {
  BookingProposalRecord,
  ConsultationWorkspaceRecord,
} from '../application/consultation-workspace.service.js';
import { createPrismaConsultationWorkspaceRepository } from './consultation.repository.js';

const consultation: ConsultationWorkspaceRecord = Object.freeze({
  consultationId: '00000000-0000-4000-8000-000000000001',
  intendedEmail: ' Couple@Example.com ',
  displayName: 'Minh and An',
  note: null,
  managerAccountId: '00000000-0000-4000-8000-000000000002',
  revision: 1,
  requestId: '00000000-0000-4000-8000-000000000003',
});

const booking: BookingProposalRecord = Object.freeze({
  bookingId: '00000000-0000-4000-8000-000000000004',
  consultationId: consultation.consultationId,
  expectedConsultationRevision: 1,
  managerAccountId: consultation.managerAccountId,
  requestId: consultation.requestId,
  proposal: Object.freeze({
    hall: Object.freeze({
      id: '00000000-0000-4000-8000-000000000005',
      name: 'Hall',
      description: 'Hall',
      maxGuests: 500,
    }),
    shift: Object.freeze({ code: 'DINNER', startTime: '17:30', endTime: '22:00' }),
    menu: Object.freeze({
      versionId: '00000000-0000-4000-8000-000000000006',
      packageId: '00000000-0000-4000-8000-000000000007',
      versionNumber: 1,
      name: 'Menu',
      description: 'Menu',
      priceVndPerTable: 5_000_000,
    }),
    eventDate: '2026-12-20',
    tableCount: 10,
    planningHeadcount: 100,
    baseChargeVnd: 50_000_000,
    depositAmountVnd: 15_000_000,
  }),
});

describe('PrismaConsultationWorkspaceRepository', () => {
  it('persists an independent consultation with normalized contact', async () => {
    const transaction = fixture();
    await createPrismaConsultationWorkspaceRepository(
      client(transaction),
      fixedNow,
    ).createConsultation(consultation);
    expect(transaction.consultation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: consultation.consultationId,
        intendedEmail: 'Couple@Example.com',
        intendedEmailNormalized: 'couple@example.com',
      }),
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });

  it('attaches one immutable booking proposal by consultation revision', async () => {
    const transaction = fixture();
    await createPrismaConsultationWorkspaceRepository(client(transaction), fixedNow).createBooking(
      booking,
    );
    expect(transaction.booking.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: booking.bookingId,
        consultationId: booking.consultationId,
        proposalSnapshot: {
          create: expect.objectContaining({ depositAmountVnd: 15_000_000 }),
        },
      }),
    });
    expect(transaction.consultation.updateMany).toHaveBeenCalledWith({
      where: { id: booking.consultationId, revision: 1 },
      data: { revision: { increment: 1 } },
    });
  });
});

function fixture() {
  return {
    consultation: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({
        id: consultation.consultationId,
        revision: 1,
        managerAccountId: consultation.managerAccountId,
        booking: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    booking: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

function client(transaction: object) {
  return {
    $transaction: vi.fn(async (operation: (value: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  } as never;
}

function fixedNow(): Date {
  return new Date('2026-10-07T10:00:00.000Z');
}
