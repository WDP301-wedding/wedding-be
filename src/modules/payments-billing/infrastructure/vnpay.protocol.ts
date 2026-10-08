import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import { z } from 'zod';

import type { ProviderEvidence, VnpaySettings } from '../application/vnpay.port.js';
import { VnpayProtocolError, type VnpayProtocol } from '../application/vnpay.port.js';
export { VnpayProtocolError } from '../application/vnpay.port.js';

export const VNPAY_CHECKOUT_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
export const VNPAY_QUERY_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';
export function createVnpayProtocol(config: VnpaySettings): VnpayProtocol {
  return Object.freeze<VnpayProtocol>({
    createCheckout: (attempt, ip) => createCheckout(attempt, ip, config),
    checkoutUrl: (parameters) => checkoutUrl(parameters, config),
    verifyIpn: (rawQuery) => verifyIpn(rawQuery, config),
    verifyQuery: (raw) => verifyQuery(raw, config),
    createQuery: (input) => createQuery(input, config),
  });
}

const field = z.string().max(255);
const responseSchema = z.object({
  vnp_TmnCode: z.string().regex(/^[A-Za-z0-9]{8}$/u),
  vnp_TxnRef: z.string().min(1).max(100),
  vnp_Amount: z.string().regex(/^\d{1,12}$/u),
  vnp_ResponseCode: z.string().regex(/^\d{2}$/u),
  vnp_TransactionStatus: z.string().regex(/^\d{2}$/u),
  vnp_TransactionNo: z.string().regex(/^\d{1,15}$/u),
  vnp_BankCode: z.string().regex(/^[A-Za-z0-9]{3,20}$/u),
  vnp_OrderInfo: field.min(1),
  vnp_PayDate: z
    .string()
    .regex(/^\d{14}$/u)
    .optional(),
  vnp_CurrCode: z
    .string()
    .regex(/^[A-Z]{3}$/u)
    .optional(),
});
const ipnKeys = new Set([
  ...Object.keys(responseSchema.shape),
  'vnp_BankTranNo',
  'vnp_CardType',
  'vnp_SecureHash',
  'vnp_SecureHashType',
]);
const queryFields = [
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
] as const;
const queryKeys = new Set<string>([...queryFields, 'vnp_SecureHash']);

function formEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/gu, '+');
}
export function canonicalParameters(parameters: Readonly<Record<string, string>>): string {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${formEncode(key)}=${formEncode(parameters[key]!)}`)
    .join('&');
}
function sign(text: string, secret: string): string {
  return createHmac('sha512', secret).update(text, 'utf8').digest('hex');
}
function verify(text: string, digest: string | undefined, config: VnpaySettings) {
  if (
    digest === undefined ||
    !/^[\da-f]{128}$/iu.test(digest) ||
    !timingSafeEqual(Buffer.from(sign(text, config.hashSecret), 'hex'), Buffer.from(digest, 'hex'))
  )
    throw new VnpayProtocolError('SIGNATURE');
}
export function formatVnpayDate(instant: string): string {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new VnpayProtocolError('FIELDS');
  return new Date(date.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace(/[-:T]/gu, '');
}
function parsePayDate(value: string): string {
  const text = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+07:00`;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || formatVnpayDate(date.toISOString()) !== value)
    throw new VnpayProtocolError('FIELDS');
  return date.toISOString();
}
export function createCheckout(
  attempt: Readonly<{
    id: string;
    amountVnd: number;
    createdAt: string;
    expiresAt: string;
    purpose?: 'DEPOSIT' | 'BALANCE';
  }>,
  ip: string,
  config: VnpaySettings,
) {
  if (
    !Number.isSafeInteger(attempt.amountVnd) ||
    attempt.amountVnd <= 0 ||
    BigInt(attempt.amountVnd) * 100n > 999_999_999_999n ||
    isIP(ip) === 0
  )
    throw new VnpayProtocolError('FIELDS');
  const parameters = Object.freeze({
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: config.merchantCode,
    vnp_Amount: (BigInt(attempt.amountVnd) * 100n).toString(),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: attempt.id,
    vnp_OrderInfo: `${attempt.purpose === 'BALANCE' ? 'Balance' : 'Deposit'} ${attempt.id}`,
    vnp_OrderType: 'other',
    vnp_Locale: 'vn',
    vnp_IpAddr: ip,
    vnp_ReturnUrl: config.returnUrl,
    vnp_CreateDate: formatVnpayDate(attempt.createdAt),
    vnp_ExpireDate: formatVnpayDate(attempt.expiresAt),
  });
  return { parameters, url: checkoutUrl(parameters, config) };
}
export function checkoutUrl(
  parameters: Readonly<Record<string, string>>,
  config: VnpaySettings,
): string {
  const canonical = canonicalParameters(parameters);
  return `${VNPAY_CHECKOUT_URL}?${canonical}&vnp_SecureHash=${sign(canonical, config.hashSecret)}`;
}
export function verifyIpn(rawQuery: string, config: VnpaySettings): ProviderEvidence {
  if (rawQuery.length > 8192) throw new VnpayProtocolError('FIELDS');
  const parameters: Record<string, string> = {};
  for (const part of rawQuery.replace(/^\?/u, '').split('&')) {
    const separator = part.indexOf('=');
    if (separator <= 0) throw new VnpayProtocolError('FIELDS');
    let key: string, value: string;
    try {
      key = decodeURIComponent(part.slice(0, separator).replace(/\+/gu, ' '));
      value = decodeURIComponent(part.slice(separator + 1).replace(/\+/gu, ' '));
    } catch {
      throw new VnpayProtocolError('FIELDS');
    }
    if (!ipnKeys.has(key) || Object.hasOwn(parameters, key) || value.length > 512)
      throw new VnpayProtocolError('FIELDS');
    parameters[key] = value;
  }
  const digest = parameters.vnp_SecureHash;
  delete parameters.vnp_SecureHash;
  delete parameters.vnp_SecureHashType;
  const canonical = canonicalParameters(parameters);
  verify(canonical, digest, config);
  return normalize(parameters, canonical, 'IPN', config);
}
export function createQuery(
  input: Readonly<{
    paymentAttemptId: string;
    transactionDate: string;
    requestId: string;
    createdAt: string;
  }>,
  config: VnpaySettings,
): Readonly<Record<string, string>> {
  const parameters = {
    vnp_RequestId: input.requestId,
    vnp_Version: '2.1.0',
    vnp_Command: 'querydr',
    vnp_TmnCode: config.merchantCode,
    vnp_TxnRef: input.paymentAttemptId,
    vnp_TransactionDate: input.transactionDate,
    vnp_CreateDate: formatVnpayDate(input.createdAt),
    vnp_IpAddr: config.queryIp,
    vnp_OrderInfo: `Query ${input.paymentAttemptId}`,
  };
  return Object.freeze({
    ...parameters,
    vnp_SecureHash: sign(Object.values(parameters).join('|'), config.hashSecret),
  });
}
export function verifyQuery(raw: unknown, config: VnpaySettings): ProviderEvidence {
  const parsed = z.record(z.string(), z.string().max(512)).safeParse(raw);
  if (!parsed.success) throw new VnpayProtocolError('FIELDS');
  const parameters = parsed.data;
  if (Object.keys(parameters).some((key) => !queryKeys.has(key)))
    throw new VnpayProtocolError('FIELDS');
  const canonical = queryFields.map((key) => parameters[key] ?? '').join('|');
  verify(canonical, parameters.vnp_SecureHash, config);
  if (
    parameters.vnp_Command !== 'querydr' ||
    parameters.vnp_TransactionType !== '01' ||
    !/^[A-Za-z0-9]{1,32}$/u.test(parameters.vnp_ResponseId ?? '')
  )
    throw new VnpayProtocolError('CORRELATION');
  return normalize(parameters, canonical, 'QUERY', config);
}
function normalize(
  parameters: Record<string, string>,
  canonical: string,
  channel: ProviderEvidence['channel'],
  config: VnpaySettings,
): ProviderEvidence {
  const parsed = responseSchema.safeParse(parameters);
  if (!parsed.success) throw new VnpayProtocolError('FIELDS');
  const fields = parsed.data;
  if (fields.vnp_TmnCode !== config.merchantCode) throw new VnpayProtocolError('CORRELATION');
  const scaled = BigInt(fields.vnp_Amount);
  if (scaled <= 0n || scaled % 100n !== 0n) throw new VnpayProtocolError('FIELDS');
  const outcome =
    fields.vnp_ResponseCode === '00' && fields.vnp_TransactionStatus === '00'
      ? 'SUCCEEDED'
      : fields.vnp_TransactionStatus === '02' &&
          (channel === 'QUERY'
            ? fields.vnp_ResponseCode === '00'
            : fields.vnp_ResponseCode !== '00')
        ? 'FAILED'
        : 'UNKNOWN';
  const settledAt = fields.vnp_PayDate === undefined ? null : parsePayDate(fields.vnp_PayDate);
  if (outcome === 'SUCCEEDED' && (settledAt === null || BigInt(fields.vnp_TransactionNo) === 0n))
    throw new VnpayProtocolError('FIELDS');
  return Object.freeze({
    paymentAttemptId: fields.vnp_TxnRef,
    merchantCode: fields.vnp_TmnCode,
    transactionId: BigInt(fields.vnp_TransactionNo).toString(),
    amountVnd: Number(scaled / 100n),
    outcome,
    settledAt: outcome === 'SUCCEEDED' ? settledAt : null,
    payloadHash: createHash('sha256').update(canonical).digest('hex'),
    channel,
    ...(fields.vnp_CurrCode !== undefined && fields.vnp_CurrCode !== 'VND'
      ? { correlationConflict: 'CURRENCY' as const }
      : {}),
  });
}
