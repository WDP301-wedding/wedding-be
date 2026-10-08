import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalParameters,
  createCheckout,
  verifyIpn,
  formatVnpayDate,
  createQuery,
  verifyQuery,
} from './vnpay.protocol.js';

const secret = 'controlled-vnpay-test-secret';
const merchantCode = 'CTTVNP01';
const attemptId = '10000000-0000-4000-8000-000000000001';
const config = {
  merchantCode,
  hashSecret: secret,
  returnUrl: 'https://wedding.example.com/payment-return',
  queryIp: '127.0.0.1',
};
// Official PAY example fields, with our immutable order ID and a controlled key.
const officialFields = {
  vnp_Amount: '1000000',
  vnp_BankCode: 'NCB',
  vnp_BankTranNo: 'VNP14226112',
  vnp_CardType: 'ATM',
  vnp_OrderInfo: 'Thanh toan don hang thoi gian: 2023-12-07 17:00:44',
  vnp_PayDate: '20231207170112',
  vnp_ResponseCode: '00',
  vnp_TmnCode: merchantCode,
  vnp_TransactionNo: '14226112',
  vnp_TransactionStatus: '00',
  vnp_TxnRef: attemptId,
};
const expectedCanonical = `vnp_Amount=1000000&vnp_BankCode=NCB&vnp_BankTranNo=VNP14226112&vnp_CardType=ATM&vnp_OrderInfo=Thanh+toan+don+hang+thoi+gian%3A+2023-12-07+17%3A00%3A44&vnp_PayDate=20231207170112&vnp_ResponseCode=00&vnp_TmnCode=CTTVNP01&vnp_TransactionNo=14226112&vnp_TransactionStatus=00&vnp_TxnRef=${attemptId}`;
const signed = `${expectedCanonical}&vnp_SecureHash=${createHmac('sha512', secret).update(expectedCanonical).digest('hex')}`;

describe('VNPay official 2.1.0 PAY/querydr protocol', () => {
  it('signs a balance using its frozen amount and purpose', () => {
    const checkout = createCheckout(
      {
        id: attemptId,
        purpose: 'BALANCE',
        amountVnd: 35_000_000,
        createdAt: '2026-10-08T16:00:00Z',
        expiresAt: '2026-10-08T16:15:00Z',
      },
      '127.0.0.1',
      config,
    );
    expect(checkout.parameters).toMatchObject({
      vnp_OrderInfo: `Balance ${attemptId}`,
      vnp_Amount: '3500000000',
      vnp_TxnRef: attemptId,
    });
    expect(new URL(checkout.url).searchParams.get('vnp_SecureHash')).toHaveLength(128);
  });
  function ipn(changes: Record<string, string | undefined>) {
    const fields: Record<string, string> = { ...officialFields };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete fields[key];
      else fields[key] = value;
    }
    const canonical = canonicalParameters(fields);
    return `${canonical}&vnp_SecureHash=${createHmac('sha512', secret).update(canonical).digest('hex')}`;
  }
  it.each([
    { vnp_Amount: '0' },
    { vnp_Amount: '1000001' },
    { vnp_Amount: '1000000000000' },
    { vnp_PayDate: undefined },
    { vnp_PayDate: '20230230120000' },
    { vnp_TransactionNo: '0' },
    { vnp_ResponseCode: 'abc' },
  ])('rejects signed but invalid money/currency/date/transaction evidence %j', (fields) => {
    expect(() => verifyIpn(ipn(fields), config)).toThrow();
  });
  it.each(['01', '04', '05', '06', '07', '09'])(
    'does not infer failure from pending status %s',
    (status) => {
      expect(verifyIpn(ipn({ vnp_TransactionStatus: status }), config).outcome).toBe('UNKNOWN');
    },
  );
  it('requires both success codes, recognizes proven failure and normalizes transaction aliases', () => {
    expect(verifyIpn(ipn({ vnp_CurrCode: 'USD' }), config)).toMatchObject({
      correlationConflict: 'CURRENCY',
    });
    expect(
      verifyIpn(
        ipn({ vnp_ResponseCode: '24', vnp_TransactionStatus: '02', vnp_PayDate: undefined }),
        config,
      ).outcome,
    ).toBe('FAILED');
    expect(verifyIpn(ipn({ vnp_ResponseCode: '24' }), config).outcome).toBe('UNKNOWN');
    expect(verifyIpn(ipn({ vnp_TransactionStatus: '02' }), config).outcome).toBe('UNKNOWN');
    expect(verifyIpn(ipn({ vnp_TransactionNo: '014226112' }), config).transactionId).toBe(
      '14226112',
    );
    expect(verifyIpn(`?${signed}&vnp_SecureHashType=SHA512`, config).outcome).toBe('SUCCEEDED');
    expect(() => verifyIpn('x'.repeat(8193), config)).toThrow();
    expect(() => verifyIpn('noequals', config)).toThrow();
    expect(() => verifyIpn(`vnp_OrderInfo=${'x'.repeat(513)}`, config)).toThrow();
    expect(() => verifyIpn(expectedCanonical, config)).toThrow();
    expect(() => formatVnpayDate('invalid')).toThrow();
    expect(() => verifyQuery(null, config)).toThrow();
    expect(() => verifyQuery({ extra: 'value' }, config)).toThrow();
  });
  it('matches the official form-encoding example and rejects duplicate/ambiguous keys', () => {
    expect(canonicalParameters(officialFields)).toBe(expectedCanonical);
    expect(canonicalParameters({ z: " !'()*~+/%", a: 'Tieng Viet' })).toBe(
      'a=Tieng+Viet&z=+%21%27%28%29%2A~%2B%2F%25',
    );
    expect(verifyIpn(signed, config)).toMatchObject({
      paymentAttemptId: attemptId,
      amountVnd: 10_000,
      transactionId: '14226112',
      outcome: 'SUCCEEDED',
      settledAt: '2023-12-07T10:01:12.000Z',
    });
    expect(() => verifyIpn(`${signed}&vnp_Amount=1`, config)).toThrow();
    expect(() => verifyIpn(`${signed}&vnp_%41mount=1`, config)).toThrow();
    expect(() => verifyIpn(`${signed}&extra=x`, config)).toThrow();
    expect(() => verifyIpn(signed.replace('%3A', '%ZZ'), config)).toThrow();
  });

  it('verifies signing input before trusting fields and uses timing-safe fixed-length digest comparison', () => {
    expect(() => verifyIpn(signed.replace('1000000', '1000001'), config)).toThrow();
    expect(() =>
      verifyIpn(signed.replace(/vnp_SecureHash=.*/u, 'vnp_SecureHash=x'), config),
    ).toThrow();
    expect(() => verifyIpn(signed, { ...config, merchantCode: 'OTHER001' })).toThrow();
    const reversed = new URLSearchParams([...new URLSearchParams(signed)].reverse()).toString();
    expect(verifyIpn(reversed, config).payloadHash).toBe(verifyIpn(signed, config).payloadHash);
  });

  it('derives VND x100 with exact arithmetic and fixed GMT+7 dates for persisted checkout', () => {
    expect(formatVnpayDate('2026-10-08T06:00:00Z')).toBe('20261008130000');
    const checkout = createCheckout(
      {
        id: attemptId,
        amountVnd: 15_000_000,
        createdAt: '2026-10-08T06:00:00Z',
        expiresAt: '2026-10-08T06:15:00Z',
      },
      '127.0.0.1',
      config,
    );
    const query = new URL(checkout.url).searchParams;
    expect(query.get('vnp_Amount')).toBe('1500000000');
    expect(query.get('vnp_ExpireDate')).toBe('20261008131500');
    expect(query.get('vnp_Command')).toBe('pay');
    expect(query.get('vnp_CurrCode')).toBe('VND');
    expect(() =>
      createCheckout(
        {
          id: attemptId,
          amountVnd: Number.MAX_SAFE_INTEGER,
          createdAt: '2026-10-08T06:00:00Z',
          expiresAt: '2026-10-08T06:15:00Z',
        },
        '127.0.0.1',
        config,
      ),
    ).toThrow();
  });

  it('uses official pipe-field checksum order for querydr request and signed response', () => {
    const request = createQuery(
      {
        paymentAttemptId: attemptId,
        transactionDate: '20261008130000',
        requestId: 'testrequest1',
        createdAt: '2026-10-08T07:00:00Z',
      },
      config,
    );
    const text = `testrequest1|2.1.0|querydr|CTTVNP01|${attemptId}|20261008130000|20261008140000|127.0.0.1|Query ${attemptId}`;
    expect(request.vnp_SecureHash).toBe(createHmac('sha512', secret).update(text).digest('hex'));
    const response = {
      vnp_ResponseId: 'response1',
      vnp_Command: 'querydr',
      vnp_ResponseCode: '00',
      vnp_Message: 'Confirm Success',
      vnp_TmnCode: merchantCode,
      vnp_TxnRef: attemptId,
      vnp_Amount: '1000000',
      vnp_BankCode: 'NCB',
      vnp_PayDate: '20231207170112',
      vnp_TransactionNo: '14226112',
      vnp_TransactionType: '01',
      vnp_TransactionStatus: '00',
      vnp_OrderInfo: 'Query test',
      vnp_PromotionCode: '',
      vnp_PromotionAmount: '',
    };
    const data = `response1|querydr|00|Confirm Success|CTTVNP01|${attemptId}|1000000|NCB|20231207170112|14226112|01|00|Query test||`;
    const proof = {
      ...response,
      vnp_SecureHash: createHmac('sha512', secret).update(data).digest('hex'),
    };
    expect(verifyQuery(proof, config)).toMatchObject({ outcome: 'SUCCEEDED', amountVnd: 10_000 });
    expect(() => verifyQuery({ ...proof, vnp_Amount: '1' }, config)).toThrow();
    expect(() => verifyQuery({ ...proof, vnp_TransactionType: '02' }, config)).toThrow();
  });
});
