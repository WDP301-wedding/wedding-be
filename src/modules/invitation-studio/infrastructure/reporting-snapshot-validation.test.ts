import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { PrismaInvitationReportingReader } from './prisma-reporting.reader.js';

describe('immutable Invitation reporting snapshot validation', () => {
  const bookingId = randomUUID(),
    orderId = randomUUID();
  const context = {
    requestId: randomUUID(),
    causationId: randomUUID(),
    actorAccountId: null,
    authority: 'SYSTEM' as const,
    purpose: 'reporting:rebuild',
  };
  const snapshot = {
    bookingId,
    printOrderId: orderId,
    status: 'REQUESTED',
    commercialRevisionId: null,
    receivableChargeId: null,
    acceptedAmountVnd: 0,
    approvedAt: null,
    updatedAt: '2026-10-10T00:00:00.000Z',
  };
  it.each([
    ['missing snapshot', null],
    ['another booking', { ...snapshot, bookingId: randomUUID() }],
    ['another order', { ...snapshot, printOrderId: randomUUID() }],
    ['another transition', { ...snapshot, status: 'APPROVED' }],
  ])(
    'rejects %s instead of rebuilding an inconsistent projection',
    async (_name, reportingSnapshot) => {
      const prisma = {
        invitationPrintAudit: {
          findMany: () =>
            Promise.resolve([{ bookingId, orderId, toStatus: 'REQUESTED', reportingSnapshot }]),
        },
      } as unknown as PrismaClient;
      const reader = new PrismaInvitationReportingReader(prisma);
      await expect(
        reader.readPage({ afterSequence: 0, throughSequence: 1, limit: 100 }, context),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    },
  );
});
