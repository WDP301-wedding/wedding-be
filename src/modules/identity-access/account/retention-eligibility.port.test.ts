import { describe, expect, it, vi } from 'vitest';
import {
  createAccountRetentionEligibilityRecorder,
  createPrismaConsultationRetentionRecorder,
} from './retention-eligibility.port.js';

describe('account retention evidence port', () => {
  it.each([null, 'manager'])(
    'records terminal evidence with actor %s and preserves the waiting period',
    async (actorAccountId) => {
      const repository = { recordRetentionEligibility: vi.fn().mockResolvedValue(null) };
      const recorder = createAccountRetentionEligibilityRecorder(repository, {
        consultationId: 'consultation',
        requestId: 'request',
        actorAccountId,
        retentionDays: 365,
      });
      const eligibleAfter = new Date('2026-10-08T00:00:00Z');
      await recorder.record({
        accountId: 'account',
        sourceBusinessRecordId: 'booking',
        eligibleAfter,
      });
      expect(repository.recordRetentionEligibility).toHaveBeenCalledWith({
        accountId: 'account',
        sourceBusinessRecordId: 'booking',
        consultationId: 'consultation',
        eligibleAfter,
        piiEligibleAt: new Date('2027-10-08T00:00:00Z'),
        audit: { requestId: 'request', ...(actorAccountId === null ? {} : { actorAccountId }) },
      });
    },
  );
  it('rejects invalid waiting periods and dates', async () => {
    const repository = { recordRetentionEligibility: vi.fn() };
    const options = {
      consultationId: 'consultation',
      requestId: 'request',
      actorAccountId: null,
      retentionDays: 365,
    };
    for (const retentionDays of [0, -1, 1.5])
      expect(() =>
        createAccountRetentionEligibilityRecorder(repository, { ...options, retentionDays }),
      ).toThrow(RangeError);
    await expect(
      createAccountRetentionEligibilityRecorder(repository, options).record({
        accountId: 'account',
        sourceBusinessRecordId: 'booking',
        eligibleAfter: new Date('invalid'),
      }),
    ).rejects.toThrow(RangeError);
    expect(repository.recordRetentionEligibility).not.toHaveBeenCalled();
  });
  it('propagates provider failure instead of accepting partial evidence', async () => {
    const repository = {
      recordRetentionEligibility: vi.fn().mockRejectedValue(new Error('unavailable')),
    };
    await expect(
      createAccountRetentionEligibilityRecorder(repository, {
        consultationId: 'consultation',
        requestId: 'request',
        actorAccountId: null,
        retentionDays: 365,
      }).record({
        accountId: 'account',
        sourceBusinessRecordId: 'booking',
        eligibleAfter: new Date(),
      }),
    ).rejects.toThrow('unavailable');
  });
  it('handles a consultation with no linked account without inventing an account', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const recorder = createPrismaConsultationRetentionRecorder(
      { consultationAccess: { findMany } } as never,
      365,
    );
    await recorder.recordTerminal(
      {
        consultationId: 'consultation',
        sourceBusinessRecordId: 'booking',
        eligibleAfter: new Date(),
      },
      { requestId: 'request', actorAccountId: null },
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { consultationId: 'consultation' },
      select: { accountId: true },
    });
  });
});
