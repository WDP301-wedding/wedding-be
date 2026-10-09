import { createHmac } from 'node:crypto';

export const controlledVnpay = Object.freeze({
  enabled: true as const,
  merchantCode: 'CTTVNP01',
  hashSecret: 'controlled-vnpay-fixture-key',
  returnUrl: 'https://wedding.example.com/payment-return',
  queryIp: '127.0.0.1',
});
let serial = 18_000_000;
// Field names follow the published PAY sample; all keys and transactions are controlled.
export function ipnFixture(attemptId: string, changes: Record<string, string | undefined> = {}) {
  const fields: Record<string, string> = {
    vnp_Amount: '1500000000',
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: 'VNP14226112',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: `Deposit ${attemptId}`,
    vnp_PayDate: '20261008210000',
    vnp_ResponseCode: '00',
    vnp_TmnCode: controlledVnpay.merchantCode,
    vnp_TransactionNo: String(++serial),
    vnp_TransactionStatus: '00',
    vnp_TxnRef: attemptId,
  };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete fields[key];
    else fields[key] = value;
  }
  const params = new URLSearchParams(fields);
  params.sort();
  const text = params.toString();
  return `${text}&vnp_SecureHash=${createHmac('sha512', controlledVnpay.hashSecret).update(text).digest('hex')}`;
}
export function queryFixture(
  attemptId: string,
  changes: Record<string, string | undefined> = {},
): Record<string, string> {
  const fields: Record<string, string> = {
    vnp_ResponseId: `response${++serial}`,
    vnp_Command: 'querydr',
    vnp_ResponseCode: '00',
    vnp_Message: 'Confirm Success',
    vnp_TmnCode: controlledVnpay.merchantCode,
    vnp_TxnRef: attemptId,
    vnp_Amount: '1500000000',
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261008210000',
    vnp_TransactionNo: String(++serial),
    vnp_TransactionType: '01',
    vnp_TransactionStatus: '00',
    vnp_OrderInfo: `Deposit ${attemptId}`,
    vnp_PromotionCode: '',
    vnp_PromotionAmount: '',
  };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete fields[key];
    else fields[key] = value;
  }
  const text = [
    'vnp_ResponseId',
    'vnp_Command',
    'vnp_ResponseCode',
    'vnp_Message',
    'vnp_TmnCode',
    'vnp_TxnRef',
    'vnp_Amount',
    'vnp_BankCode',
    'vnp_PayDate',
    'vnp_TransactionNo',
    'vnp_TransactionType',
    'vnp_TransactionStatus',
    'vnp_OrderInfo',
    'vnp_PromotionCode',
    'vnp_PromotionAmount',
  ]
    .map((key) => fields[key] ?? '')
    .join('|');
  return {
    ...fields,
    vnp_SecureHash:
      changes.vnp_SecureHash ??
      createHmac('sha512', controlledVnpay.hashSecret).update(text).digest('hex'),
  };
}
