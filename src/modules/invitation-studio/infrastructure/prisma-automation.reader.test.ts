import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import type { ContractContext } from '../../../core/database/booking-boundary.js';
import { PrismaInvitationAutomationReader } from './prisma-automation.reader.js';

describe('PrismaInvitationAutomationReader (IS-W6 / CONTRACT-BASELINE §21.6)', () => {
  const systemContext: ContractContext = {
    requestId: 'req-sys-1',
    causationId: 'req-sys-1',
    actorAccountId: null,
    authority: 'SYSTEM',
    purpose: 'automation:media-cutoff',
  };

  it('rejects unauthenticated non-system context with empty items', async () => {
    const reader = new PrismaInvitationAutomationReader({} as PrismaClient);
    const unauthContext: ContractContext = {
      requestId: 'req-anon',
      causationId: 'req-anon',
      actorAccountId: null,
      authority: 'AUTHENTICATED',
    };

    const res = await reader.listMediaCutoffs(
      { dueBefore: new Date().toISOString(), limit: 10 },
      unauthContext,
    );
    expect(res).toEqual({ nextCursor: null, items: [] });
  });

  it('rejects system context with invalid purpose', async () => {
    const reader = new PrismaInvitationAutomationReader({} as PrismaClient);
    const invalidSystemContext: ContractContext = {
      requestId: 'req-sys-2',
      causationId: 'req-sys-2',
      actorAccountId: null,
      authority: 'SYSTEM',
      purpose: 'invalid:purpose',
    };

    const res = await reader.listMediaCutoffs(
      { dueBefore: new Date().toISOString(), limit: 10 },
      invalidSystemContext,
    );
    expect(res).toEqual({ nextCursor: null, items: [] });
  });

  it('queries media cutoffs and excludes bookings without confirmed Couple account (no zero-UUID)', async () => {
    const bookingId1 = '11111111-1111-1111-1111-111111111111';
    const bookingId2 = '22222222-2222-2222-2222-222222222222';
    const coupleAccountId1 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const cutoffAt1 = new Date('2026-10-15T00:00:00.000Z');
    const cutoffAt2 = new Date('2026-10-16T00:00:00.000Z');

    const mockPrisma = {
      invitationMediaPolicy: {
        findMany: vi.fn().mockResolvedValue([
          { bookingId: bookingId1, revision: 1, cutoffAt: cutoffAt1 },
          { bookingId: bookingId2, revision: 2, cutoffAt: cutoffAt2 },
        ]),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([{ id: bookingId1 }]),
      },
      consultationAccess: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ bookingId: bookingId1, accountId: coupleAccountId1 }]),
      },
    } as unknown as PrismaClient;

    const reader = new PrismaInvitationAutomationReader(mockPrisma);
    const res = await reader.listMediaCutoffs(
      { dueBefore: '2026-10-20T00:00:00.000Z', limit: 10 },
      systemContext,
    );

    expect(res.nextCursor).toBeNull();
    // Only booking 1 is returned because booking 2 lacks confirmed Couple account / eligibility
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toEqual({
      bookingId: bookingId1,
      cutoffAt: cutoffAt1.toISOString(),
      policyRevision: 1,
      coupleAccountId: coupleAccountId1,
    });
  });

  it('paginates cutoffs and computes base64url nextCursor when records exceed limit', async () => {
    const cutoffDate = new Date('2026-10-15T00:00:00.000Z');
    const b1 = '11111111-1111-1111-1111-111111111111';
    const b2 = '22222222-2222-2222-2222-222222222222';
    const couple1 = 'c1111111-1111-1111-1111-111111111111';

    const mockPrisma = {
      invitationMediaPolicy: {
        findMany: vi.fn().mockResolvedValue([
          { bookingId: b1, revision: 1, cutoffAt: cutoffDate },
          { bookingId: b2, revision: 1, cutoffAt: cutoffDate },
        ]),
      },
      booking: {
        findMany: vi.fn().mockResolvedValue([{ id: b1 }, { id: b2 }]),
      },
      consultationAccess: {
        findMany: vi.fn().mockResolvedValue([{ bookingId: b1, accountId: couple1 }]),
      },
    } as unknown as PrismaClient;

    const reader = new PrismaInvitationAutomationReader(mockPrisma);
    // Limit is 1, but prisma returned 2 -> hasNext = true
    const res = await reader.listMediaCutoffs(
      { dueBefore: '2026-10-20T00:00:00.000Z', limit: 1 },
      systemContext,
    );

    expect(res.items).toHaveLength(1);
    expect(res.nextCursor).not.toBeNull();

    const decoded = JSON.parse(Buffer.from(res.nextCursor!, 'base64url').toString('utf8')) as {
      c: string;
      b: string;
    };
    expect(decoded.b).toBe(b1);
  });
});
