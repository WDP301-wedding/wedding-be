import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type OpaqueTokenPurpose = 'access' | 'refresh' | 'invitation' | 'password-reset';

export type IssuedOpaqueToken = Readonly<{
  token: string;
  tokenHash: string;
}>;

const tokenPrefixes: Readonly<Record<OpaqueTokenPurpose, string>> = Object.freeze({
  access: 'wia',
  refresh: 'wir',
  invitation: 'wii',
  'password-reset': 'wip',
});

const hashDomain = 'wedding.identity-token.v1';
const minimumEntropyBytes = 32;

export function issueOpaqueToken(
  purpose: OpaqueTokenPurpose,
  entropyBytes: number,
): IssuedOpaqueToken {
  if (!Number.isSafeInteger(entropyBytes) || entropyBytes < minimumEntropyBytes) {
    throw new Error('Invalid opaque token configuration.');
  }

  const token = `${tokenPrefixes[purpose]}_${randomBytes(entropyBytes).toString('base64url')}`;

  return Object.freeze({ token, tokenHash: hashOpaqueToken(token, purpose) });
}

export function hashOpaqueToken(token: string, purpose: OpaqueTokenPurpose): string {
  return createHash('sha256')
    .update(hashDomain, 'utf8')
    .update('\0', 'utf8')
    .update(purpose, 'utf8')
    .update('\0', 'utf8')
    .update(token, 'utf8')
    .digest('base64url');
}

export function verifyOpaqueToken(
  token: string,
  expectedHash: string,
  purpose: OpaqueTokenPurpose,
): boolean {
  if (!token.startsWith(`${tokenPrefixes[purpose]}_`) || !isSha256Base64Url(expectedHash)) {
    return false;
  }

  const actual = Buffer.from(hashOpaqueToken(token, purpose), 'base64url');
  const expected = Buffer.from(expectedHash, 'base64url');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isCredentialExpired(expiresAt: Date, now: Date = new Date()): boolean {
  const expiryMilliseconds = expiresAt.getTime();
  const nowMilliseconds = now.getTime();

  return (
    !Number.isFinite(expiryMilliseconds) ||
    !Number.isFinite(nowMilliseconds) ||
    expiryMilliseconds <= nowMilliseconds
  );
}

function isSha256Base64Url(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    return false;
  }

  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === value;
}
