export const REDACTED_VALUE = '[Redacted]';
const CIRCULAR_VALUE = '[Circular]';

const sensitiveKeys = new Set([
  'accountnumber',
  'address',
  'apikey',
  'authorization',
  'bankaccount',
  'body',
  'cardcvc',
  'cardcvv',
  'cardholdername',
  'cardnumber',
  'cause',
  'contact',
  'contactdata',
  'credential',
  'capability',
  'cookie',
  'cookies',
  'cvc',
  'cvv',
  'email',
  'emailaddress',
  'firstname',
  'fullname',
  'fragment',
  'iban',
  'lastname',
  'message',
  'messagebody',
  'messagetext',
  'mobile',
  'mobilenumber',
  'name',
  'operationalnote',
  'recipientgreeting',
  'passcode',
  'password',
  'passwordhash',
  'payment',
  'paymentdata',
  'paymentdetails',
  'paymentintent',
  'paymentintentid',
  'paymentmethod',
  'paymentmethodid',
  'paymentsecret',
  'phone',
  'phonenumber',
  'proxyauthorization',
  'requestbody',
  'responsebody',
  'routingnumber',
  'securitycode',
  'setcookie',
  'stack',
  'token',
]);
const sensitiveSuffixes = ['apikey', 'password', 'secret', 'token'] as const;

export function redactSensitiveData(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}

export function redactLogRecord(record: Record<string, unknown>): Record<string, unknown> {
  try {
    return redactValue(record, new WeakSet<object>()) as Record<string, unknown>;
  } catch {
    return { event: 'log_redaction_failed' };
  }
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Error) {
    return { name: value.name };
  }

  if (seen.has(value)) {
    return CIRCULAR_VALUE;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactValue(nestedValue, seen);
  }

  return redacted;
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
  return (
    sensitiveKeys.has(normalizedKey) ||
    sensitiveSuffixes.some((suffix) => normalizedKey.endsWith(suffix))
  );
}
