import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { PrismaInvitationReportingReader } from './prisma-reporting.reader.js';

describe('PrismaInvitationReportingReader (IS-W6 / CONTRACT-BASELINE §21.5)', () => {
  const managerContext: ContractContext = {
    requestId: 'req-mgr-1',
    causationId: 'req-mgr-1',
    actorAccountId: '00000000-0000-0000-0000-000000000099',
    authority: 'AUTHENTICATED',
  };

  const systemContext: ContractContext = {
    requestId: 'req-sys-1',
    causationId: 'req-sys-1',
    actorAccountId: null,
    authority: 'SYSTEM',
    purpose: 'reporting:invitation-studio',
  };

  it('rejects unauthorized context with empty rows', async () => {
    const reader = new PrismaInvitationReportingReader({} as PrismaClient);
    const unauthContext: ContractContext = {
      requestId: 'req-anon',
      causationId: 'req-anon',
      actorAccountId: null,
      authority: 'AUTHENTICATED',
    };

    const res = await reader.readPage({ afterSequence: 0, limit: 100 }, unauthContext);
    expect(res).toEqual({
      throughSequence: 0,
      nextCursor: null,
      rows: [],
    });
  });

  it('rejects system context with invalid purpose', async () => {
    const reader = new PrismaInvitationReportingReader({} as PrismaClient);
    const invalidSystemContext: ContractContext = {
      requestId: 'req-sys-2',
      causationId: 'req-sys-2',
      actorAccountId: null,
      authority: 'SYSTEM',
      purpose: 'invalid:purpose',
    };

    const res = await reader.readPage({ afterSequence: 0, limit: 100 }, invalidSystemContext);
    expect(res).toEqual({
      throughSequence: 0,
      nextCursor: null,
      rows: [],
    });
  });

  it('reads page of invitation reporting rows with monotonic sequence and real approvedAt', async () => {
    const tCreated = new Date('2026-10-10T10:00:00.000Z');
    const tApproved = new Date('2026-10-10T10:30:00.000Z');
    const tLaterUpdate = new Date('2026-10-10T12:00:00.000Z');
    const revId = '33333333-3333-4333-8333-333333333333';
    const orderId1 = '11111111-1111-4111-8111-111111111111';
    const orderId2 = '22222222-2222-4222-8222-222222222222';

    const mockAudits = [
      {
        sequence: BigInt(101),
        id: 'audit-1',
        bookingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        orderId: orderId1,
        actorId: 'aaaa-1',
        action: 'invitation.print-order-requested',
        fromStatus: null,
        toStatus: 'REQUESTED',
        createdAt: tCreated,
      },
      {
        sequence: BigInt(102),
        id: 'audit-2',
        bookingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        orderId: orderId2,
        actorId: 'aaaa-2',
        action: 'invitation.print-order-approved',
        fromStatus: 'QUOTED',
        toStatus: 'APPROVED',
        createdAt: tApproved,
      },
    ];

    const mockOrders = [
      {
        id: orderId1,
        bookingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'REQUESTED',
        revision: 1,
        currentCommercialRevisionId: null,
        receivableChargeId: null,
        approvedAt: null,
        updatedAt: tCreated,
      },
      {
        id: orderId2,
        bookingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'IN_PRODUCTION', // Order has updated to IN_PRODUCTION later
        revision: 3,
        currentCommercialRevisionId: revId,
        receivableChargeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        approvedAt: tApproved, // Real approved timestamp preserved
        updatedAt: tLaterUpdate, // Later mutation time
      },
    ];

    const mockRevisions = [
      {
        id: revId,
        orderTotalVnd: '7500000',
      },
    ];

    const liveOrders = vi.fn().mockResolvedValue(mockOrders);
    const liveRevisions = vi.fn().mockResolvedValue(mockRevisions);
    const mockPrisma = {
      invitationPrintAudit: {
        findFirst: vi.fn().mockResolvedValue({ sequence: BigInt(102) }),
        findMany: vi.fn().mockImplementation((args: { where: { action?: string } }) => {
          if (args?.where?.action === 'invitation.print-order-approved') {
            return Promise.resolve([{ orderId: orderId2, createdAt: tApproved }]);
          }
          return Promise.resolve(
            mockAudits.map((a) => ({
              ...a,
              reportingSnapshot: {
                bookingId: a.bookingId,
                printOrderId: a.orderId,
                status: a.toStatus,
                commercialRevisionId:
                  a.toStatus === 'APPROVED' ? '33333333-3333-4333-8333-333333333333' : null,
                receivableChargeId:
                  a.toStatus === 'APPROVED' ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' : null,
                acceptedAmountVnd: a.toStatus === 'APPROVED' ? 7500000 : 0,
                approvedAt: a.toStatus === 'APPROVED' ? a.createdAt.toISOString() : null,
                updatedAt: a.createdAt.toISOString(),
              },
            })),
          );
        }),
      },
      invitationPrintOrder: {
        findMany: liveOrders,
      },
      invitationCommercialRevision: {
        findMany: liveRevisions,
      },
    } as unknown as PrismaClient;

    const reader = new PrismaInvitationReportingReader(mockPrisma);
    const res = await reader.readPage({ afterSequence: 0, limit: 10 }, managerContext);

    expect(res.throughSequence).toBe(102);
    expect(res.nextCursor).toBeNull();
    expect(res.rows).toHaveLength(2);

    // Row 1: REQUESTED -> sequence 101, acceptedAmountVnd: 0, approvedAt: null
    const row0 = res.rows[0];
    expect(row0?.recordId).toBe(orderId1);
    expect(row0?.sequence).toBe(101);
    expect(row0?.value.status).toBe('REQUESTED');
    expect(row0?.value.acceptedAmountVnd).toBe(0);
    expect(row0?.value.approvedAt).toBeNull();

    // Row 2: APPROVED / IN_PRODUCTION -> sequence 102, acceptedAmountVnd: 7500000
    // Real approvedAt is tApproved, NOT tLaterUpdate!
    const row1 = res.rows[1];
    expect(row1?.recordId).toBe(orderId2);
    expect(row1?.sequence).toBe(102);
    expect(row1?.value.acceptedAmountVnd).toBe(7500000);
    expect(row1?.value.approvedAt).toBe(tApproved.toISOString());
    expect(row1?.value.updatedAt).toBe(tApproved.toISOString());
    expect(liveOrders).not.toHaveBeenCalled();
    expect(liveRevisions).not.toHaveBeenCalled();
    expect(row1?.value.approvedAt).not.toBe(tLaterUpdate.toISOString());
  });

  it('respects supplied throughSequence and generates nextCursor when page is bounded', async () => {
    const tCreated = new Date('2026-10-10T10:00:00.000Z');
    const orderId1 = '11111111-1111-4111-8111-111111111111';
    const orderId2 = '22222222-2222-4222-8222-222222222222';

    const mockAudits = [
      {
        sequence: BigInt(50),
        id: 'audit-50',
        bookingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        orderId: orderId1,
        actorId: 'aaaa-1',
        action: 'invitation.print-order-requested',
        fromStatus: null,
        toStatus: 'REQUESTED',
        createdAt: tCreated,
      },
      {
        sequence: BigInt(51),
        id: 'audit-51',
        bookingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        orderId: orderId2,
        actorId: 'aaaa-2',
        action: 'invitation.print-order-quoted',
        fromStatus: 'REQUESTED',
        toStatus: 'QUOTED',
        createdAt: tCreated,
      },
    ];

    const mockOrders = [
      {
        id: orderId1,
        bookingId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'REQUESTED',
        revision: 1,
        currentCommercialRevisionId: null,
        receivableChargeId: null,
        approvedAt: null,
        updatedAt: tCreated,
      },
    ];

    const mockPrisma = {
      invitationPrintAudit: {
        findMany: vi.fn().mockImplementation((args: { where: { action?: string } }) => {
          if (args?.where?.action === 'invitation.print-order-approved') {
            return Promise.resolve([]);
          }
          return Promise.resolve(
            mockAudits.map((a) => ({
              ...a,
              reportingSnapshot: {
                bookingId: a.bookingId,
                printOrderId: a.orderId,
                status: a.toStatus,
                commercialRevisionId:
                  a.toStatus === 'APPROVED' ? '33333333-3333-4333-8333-333333333333' : null,
                receivableChargeId:
                  a.toStatus === 'APPROVED' ? 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' : null,
                acceptedAmountVnd: a.toStatus === 'APPROVED' ? 7500000 : 0,
                approvedAt: a.toStatus === 'APPROVED' ? a.createdAt.toISOString() : null,
                updatedAt: a.createdAt.toISOString(),
              },
            })),
          );
        }),
      },
      invitationPrintOrder: {
        findMany: vi.fn().mockResolvedValue(mockOrders),
      },
      invitationCommercialRevision: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaClient;

    const reader = new PrismaInvitationReportingReader(mockPrisma);
    const fixedThrough = 55;

    // limit = 1, but prisma returned 2 -> paged to 1 item + nextCursor
    const res = await reader.readPage(
      { afterSequence: 0, throughSequence: fixedThrough, limit: 1 },
      systemContext,
    );

    expect(res.throughSequence).toBe(fixedThrough);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.recordId).toBe(orderId1);
    expect(res.rows[0]?.sequence).toBe(50);
    expect(res.nextCursor).not.toBeNull();

    const decoded = JSON.parse(Buffer.from(res.nextCursor!, 'base64url').toString('utf8')) as {
      s: number;
      id: string;
    };
    expect(decoded.s).toBe(50);
    expect(decoded.id).toBe('audit-50');
  });
});
