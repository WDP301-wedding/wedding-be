import { describe, expect, it } from 'vitest';
import { cancellationRefundPolicy } from './cancellation-refund-policy.js';

const start = new Date('2026-12-31T03:00:00Z');
const facts = {
  initiator: 'COUPLE' as const,
  requestedAt: new Date(start.getTime() - 30 * 86_400_000),
  eventStartsAt: start,
  contractRevisionId: 'contract',
  contractTermsVersion: 'WEDDING_STANDARD_V1',
  depositPaymentId: 'payment',
  depositReceivedVnd: 16_740_000,
};
describe('frozen cancellation refund policy', () => {
  it.each([
    [30, 100],
    [29.999, 50],
    [7, 50],
    [6.999, 0],
  ] as const)('uses exact request-to-shift interval %s days => %s percent', (days, percent) => {
    const result = cancellationRefundPolicy({
      ...facts,
      requestedAt: new Date(start.getTime() - days * 86_400_000),
    });
    expect(result.ratePercent).toBe(percent);
    expect(result.entitledVnd).toBe((facts.depositReceivedVnd * percent) / 100);
  });
  it('restaurant cancellation always returns only the received deposit', () => {
    expect(
      cancellationRefundPolicy({ ...facts, initiator: 'RESTAURANT', requestedAt: start }),
    ).toMatchObject({ ratePercent: 100, entitledVnd: 16_740_000 });
  });
  it('requires review for unknown origin, missing request time or legacy contract', () => {
    for (const override of [
      { initiator: null },
      { requestedAt: null },
      { contractTermsVersion: null },
    ]) {
      expect(cancellationRefundPolicy({ ...facts, ...override }).entitledVnd).toBeNull();
    }
  });
  it('does not invent money before deposit and rounds a half dong down', () => {
    expect(cancellationRefundPolicy({ ...facts, depositReceivedVnd: 0 }).entitledVnd).toBe(0);
    expect(
      cancellationRefundPolicy({
        ...facts,
        depositReceivedVnd: 101,
        requestedAt: new Date(start.getTime() - 10 * 86_400_000),
      }).entitledVnd,
    ).toBe(50);
  });
});
