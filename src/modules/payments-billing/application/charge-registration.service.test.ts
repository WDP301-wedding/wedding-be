import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { BillingLedgerRepository } from './billing-ledger.port.js';
import { createChargeRegistrationService } from './charge-registration.service.js';

const context = {
  requestId: randomUUID(),
  causationId: randomUUID(),
  actorAccountId: null,
  authority: 'SYSTEM' as const,
};

describe('approved print charge and decision credit mapping', () => {
  function setup() {
    const append = vi
      .fn<BillingLedgerRepository['append']>()
      .mockImplementation((fact) =>
        Promise.resolve({ entry: { ...fact, revision: 1 }, replayed: false }),
      );
    return {
      append,
      service: createChargeRegistrationService({ ledger: { append }, context: () => context }),
    };
  }

  it('maps PRN-006 to one accepted immutable print source without making a payment', async () => {
    const { service, append } = setup();
    const input = {
      bookingId: randomUUID(),
      sourceType: 'PRINT_ORDER' as const,
      sourceRevisionId: randomUUID(),
      amountVnd: 100_000,
      acceptedAt: new Date('2026-10-08T06:00:00Z'),
    };
    const result = await service.registerAcceptedCharge(input);
    const fact = append.mock.calls[0]![0];
    expect(fact).toMatchObject({
      bookingId: input.bookingId,
      sourceRevisionId: input.sourceRevisionId,
      amountVnd: input.amountVnd,
      kind: 'CHARGE',
      occurredAt: input.acceptedAt.toISOString(),
      sourceEntryId: null,
      paymentAttemptId: null,
    });
    expect(result).toEqual({ receivableChargeId: fact.id, replayed: false });
    append.mockResolvedValue({ entry: { ...fact, revision: 1 }, replayed: true });
    expect(await service.registerAcceptedCharge(input)).toEqual({ ...result, replayed: true });
  });

  it.each(['PRINT_CANCELLED', 'PRINT_REPLACED'] as const)(
    'links %s to the original charge and immutable adjustment decision',
    async (reason) => {
      const { service, append } = setup();
      const input = {
        bookingId: randomUUID(),
        receivableChargeId: randomUUID(),
        sourceAdjustmentId: randomUUID(),
        amountVnd: 50_000,
        reason,
        acceptedAt: '2026-10-08T07:00:00Z',
      };
      const result = await service.registerCredit(input, context);
      expect(append.mock.calls[0]).toEqual([
        expect.objectContaining({
          kind: 'CREDIT_ADJUSTMENT',
          sourceType: 'PRINT_CREDIT',
          sourceRevisionId: input.sourceAdjustmentId,
          sourceEntryId: input.receivableChargeId,
          reason,
          amountVnd: input.amountVnd,
        }),
        context,
      ]);
      expect(result.adjustmentId).toBe(append.mock.calls[0]![0].id);
    },
  );

  it('propagates source conflicts and provider failure without pretending registration succeeded', async () => {
    const { service, append } = setup();
    append.mockRejectedValue(new Error('storage unavailable'));
    await expect(
      service.registerAcceptedCharge({
        bookingId: randomUUID(),
        sourceType: 'PRINT_ORDER',
        sourceRevisionId: randomUUID(),
        amountVnd: 1,
        acceptedAt: new Date(),
      }),
    ).rejects.toThrow('storage unavailable');
  });

  it('rejects invalid amounts and dates before calling storage', async () => {
    const { service, append } = setup();
    const input = {
      bookingId: randomUUID(),
      sourceType: 'PRINT_ORDER' as const,
      sourceRevisionId: randomUUID(),
      amountVnd: 0,
      acceptedAt: new Date(),
    };
    await expect(service.registerAcceptedCharge(input)).rejects.toThrow();
    await expect(
      service.registerAcceptedCharge({ ...input, amountVnd: 1, acceptedAt: new Date('invalid') }),
    ).rejects.toThrow();
    expect(append).not.toHaveBeenCalled();
  });
});
