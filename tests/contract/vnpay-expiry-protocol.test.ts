import { describe, expect, it } from 'vitest';
import { createVnpayProtocol } from '../../src/modules/payments-billing/infrastructure/vnpay.protocol.js';
import { controlledVnpay, queryFixture } from '../integration/payments-billing/vnpay-fixture.js';

const protocol = createVnpayProtocol(controlledVnpay);
const attempt = { id: '10000000-0000-4000-8000-000000000001', amountVnd: 15_000_000 };
const missing = (changes: Record<string, string | undefined> = {}) =>
  queryFixture(attempt.id, {
    vnp_ResponseCode: '91',
    vnp_Message: 'Order not found',
    vnp_Amount: undefined,
    vnp_BankCode: undefined,
    vnp_PayDate: undefined,
    vnp_TransactionNo: undefined,
    vnp_TransactionType: undefined,
    vnp_TransactionStatus: undefined,
    ...changes,
  });

describe('authenticated VNPay nonpayment evidence', () => {
  it.each([undefined, '', '0', '1500000000'])(
    'binds a signed missing order to its persisted attempt with amount %s',
    (amount) => {
      expect(protocol.verifyQuery(missing({ vnp_Amount: amount }), attempt)).toMatchObject({
        paymentAttemptId: attempt.id,
        amountVnd: attempt.amountVnd,
        outcome: 'UNKNOWN',
        transactionId: '0',
        settledAt: null,
        nonPaymentReason: 'NOT_FOUND',
      });
    },
  );
  it('requires persisted correlation context for a sparse missing-order reply', () => {
    expect(() => protocol.verifyQuery(missing())).toThrow();
  });
  it.each([
    { vnp_SecureHash: 'invalid' },
    { vnp_TmnCode: 'OTHER001' },
    { vnp_TxnRef: '10000000-0000-4000-8000-000000000002' },
    { vnp_TxnRef: undefined },
    { vnp_ResponseId: '' },
    { vnp_Command: 'refund' },
    { vnp_Amount: '1500000001' },
    { vnp_Amount: 'invalid' },
    { vnp_TransactionNo: '123' },
    { vnp_TransactionNo: '0'.repeat(16) },
    { vnp_PayDate: '20261008130000' },
    { vnp_TransactionStatus: '00' },
    { vnp_TransactionStatus: '04' },
    { vnp_TransactionType: '02' },
  ])('rejects unauthenticated or contradictory missing-order reply %j', (changes) => {
    expect(() => protocol.verifyQuery(missing(changes), attempt)).toThrow();
  });
  it('retains a mismatched supplied amount for the persistence conflict check', () => {
    expect(protocol.verifyQuery(missing({ vnp_Amount: '100' }), attempt).amountVnd).toBe(1);
  });
  it('detects tampering in the signed missing-order response before local normalization', () => {
    const reply = missing();
    expect(() =>
      protocol.verifyQuery({ ...reply, vnp_TxnRef: attempt.id + 'x' }, attempt),
    ).toThrow();
  });
  it.each(['01', '04', '05', '07'])(
    'does not infer failure from transaction status %s',
    (status) => {
      const evidence = protocol.verifyQuery(
        queryFixture(attempt.id, { vnp_TransactionStatus: status }),
        attempt,
      );
      expect(evidence.outcome).toBe('UNKNOWN');
      expect(evidence).not.toHaveProperty('nonPaymentReason');
    },
  );
  it('recognizes unpaid with transaction zero but never treats provider errors as unpaid', () => {
    const fields = { vnp_TransactionNo: '0', vnp_TransactionStatus: '01', vnp_PayDate: undefined };
    expect(protocol.verifyQuery(queryFixture(attempt.id, fields), attempt)).toMatchObject({
      outcome: 'UNKNOWN',
      nonPaymentReason: 'UNPAID',
    });
    expect(
      protocol.verifyQuery(
        queryFixture(attempt.id, { ...fields, vnp_ResponseCode: '94' }),
        attempt,
      ),
    ).not.toHaveProperty('nonPaymentReason');
  });
  it('accepts authenticated unpaid responses with empty optional bank and payment date fields', () => {
    expect(
      protocol.verifyQuery(
        queryFixture(attempt.id, {
          vnp_TransactionStatus: '01',
          vnp_TransactionNo: '0',
          vnp_PayDate: '',
          vnp_BankCode: '',
        }),
        attempt,
      ),
    ).toMatchObject({ outcome: 'UNKNOWN', nonPaymentReason: 'UNPAID' });
  });
});
