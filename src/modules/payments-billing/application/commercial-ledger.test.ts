import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ledgerFactSchema } from './billing-ledger.port.js';

const fact = {
  id: randomUUID(),
  bookingId: randomUUID(),
  kind: 'CHARGE',
  sourceType: 'CONTRACT_APPENDIX',
  sourceRevisionId: randomUUID(),
  amountVnd: 1000,
  occurredAt: '2026-10-11T10:00:00Z',
  sourceEntryId: null,
  paymentAttemptId: null,
  decisionId: null,
  approvedRefundableVnd: null,
  reason: 'Thay đổi hợp đồng',
  evidenceReference: null,
};
it('accepts reasoned signed commercial sources without impersonating a print credit', () => {
  for (const sourceType of ['CONTRACT_APPENDIX', 'INVOICE_ADJUSTMENT'])
    for (const kind of ['CHARGE', 'CREDIT_ADJUSTMENT'])
      expect(ledgerFactSchema.safeParse({ ...fact, sourceType, kind }).success).toBe(true);
  expect(
    ledgerFactSchema.safeParse({ ...fact, sourceType: 'INCIDENTAL_FINALIZATION' }).success,
  ).toBe(true);
  expect(
    ledgerFactSchema.safeParse({
      ...fact,
      sourceType: 'INCIDENTAL_FINALIZATION',
      kind: 'CREDIT_ADJUSTMENT',
    }).success,
  ).toBe(false);
  expect(
    ledgerFactSchema.safeParse({ ...fact, kind: 'CREDIT_ADJUSTMENT', reason: null }).success,
  ).toBe(false);
  expect(ledgerFactSchema.safeParse({ ...fact, sourceEntryId: randomUUID() }).success).toBe(false);
  expect(ledgerFactSchema.safeParse({ ...fact, amountVnd: 0 }).success).toBe(false);
});
