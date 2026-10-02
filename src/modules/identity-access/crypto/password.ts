import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export type ScryptParameters = Readonly<{
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLengthBytes: number;
  maxMemoryBytes: number;
}>;

export type PasswordPolicy = Readonly<{
  minimumCharacters: number;
  maximumCharacters: number;
  maximumBytes: number;
  scrypt: ScryptParameters;
}>;

export type ScryptPasswordVerifier = Readonly<{
  algorithm: 'scrypt';
  version: 1;
  parameters: ScryptParameters;
  saltEncoded: string;
  derivedKeyEncoded: string;
}>;

export type PasswordVerification = Readonly<{
  matches: boolean;
  needsRehash: boolean;
}>;

export class PasswordPolicyError extends Error {
  override readonly name = 'PasswordPolicyError';

  constructor() {
    super('Password does not satisfy the configured policy.');
  }
}

export class PasswordConfigurationError extends Error {
  override readonly name = 'PasswordConfigurationError';

  constructor() {
    super('Invalid password crypto configuration.');
  }
}

export async function hashPassword(
  password: string,
  policy: PasswordPolicy,
): Promise<ScryptPasswordVerifier> {
  assertValidPolicy(policy);
  assertValidPassword(password, policy);

  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, policy.scrypt);

  return Object.freeze({
    algorithm: 'scrypt' as const,
    version: 1 as const,
    parameters: Object.freeze({ ...policy.scrypt }),
    saltEncoded: salt.toString('base64url'),
    derivedKeyEncoded: derivedKey.toString('base64url'),
  });
}

export async function verifyPassword(
  password: string,
  candidate: unknown,
  currentPolicy: PasswordPolicy,
): Promise<PasswordVerification> {
  assertValidPolicy(currentPolicy);

  if (
    !isPasswordWithinPolicy(password, currentPolicy) ||
    !isScryptPasswordVerifier(candidate, currentPolicy.scrypt)
  ) {
    return failedVerification;
  }

  const salt = Buffer.from(candidate.saltEncoded, 'base64url');
  const expected = Buffer.from(candidate.derivedKeyEncoded, 'base64url');
  const actual = await deriveKey(password, salt, candidate.parameters);
  const matches = actual.length === expected.length && timingSafeEqual(actual, expected);

  return Object.freeze({
    matches,
    needsRehash: matches && !sameParameters(candidate.parameters, currentPolicy.scrypt),
  });
}

const failedVerification: PasswordVerification = Object.freeze({
  matches: false,
  needsRehash: false,
});

function deriveKey(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      parameters.keyLengthBytes,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelization,
        maxmem: parameters.maxMemoryBytes,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

function assertValidPassword(password: string, policy: PasswordPolicy): void {
  if (!isPasswordWithinPolicy(password, policy)) {
    throw new PasswordPolicyError();
  }
}

function isPasswordWithinPolicy(password: string, policy: PasswordPolicy): boolean {
  const characterCount = Array.from(password).length;
  const byteCount = Buffer.byteLength(password, 'utf8');

  return (
    characterCount >= policy.minimumCharacters &&
    characterCount <= policy.maximumCharacters &&
    byteCount <= policy.maximumBytes
  );
}

function assertValidPolicy(policy: PasswordPolicy): void {
  if (
    !Number.isInteger(policy.minimumCharacters) ||
    !Number.isInteger(policy.maximumCharacters) ||
    !Number.isInteger(policy.maximumBytes) ||
    policy.minimumCharacters < 1 ||
    policy.maximumCharacters < policy.minimumCharacters ||
    policy.maximumBytes < policy.maximumCharacters ||
    !isValidScryptParameters(policy.scrypt)
  ) {
    throw new PasswordConfigurationError();
  }
}

function isScryptPasswordVerifier(
  candidate: unknown,
  maximumParameters: ScryptParameters,
): candidate is ScryptPasswordVerifier {
  if (!isRecord(candidate) || candidate.algorithm !== 'scrypt' || candidate.version !== 1) {
    return false;
  }

  if (
    !isValidScryptParameters(candidate.parameters) ||
    !isWithinResourceBounds(candidate.parameters, maximumParameters) ||
    !isCanonicalBase64Url(candidate.saltEncoded) ||
    !isCanonicalBase64Url(candidate.derivedKeyEncoded)
  ) {
    return false;
  }

  const salt = Buffer.from(candidate.saltEncoded, 'base64url');
  const derivedKey = Buffer.from(candidate.derivedKeyEncoded, 'base64url');

  return (
    salt.length >= 16 &&
    salt.length <= 64 &&
    derivedKey.length === candidate.parameters.keyLengthBytes
  );
}

function isValidScryptParameters(candidate: unknown): candidate is ScryptParameters {
  if (!isRecord(candidate)) {
    return false;
  }

  const { cost, blockSize, parallelization, keyLengthBytes, maxMemoryBytes } = candidate;
  if (
    !isPositiveInteger(cost) ||
    !isPositiveInteger(blockSize) ||
    !isPositiveInteger(parallelization) ||
    !isPositiveInteger(keyLengthBytes) ||
    !isPositiveInteger(maxMemoryBytes)
  ) {
    return false;
  }

  return (
    cost > 1 &&
    Number.isInteger(Math.log2(cost)) &&
    keyLengthBytes <= 128 &&
    maxMemoryBytes > 128 * cost * blockSize + 1024 * blockSize * parallelization
  );
}

function isWithinResourceBounds(candidate: ScryptParameters, maximum: ScryptParameters): boolean {
  return (
    candidate.cost <= maximum.cost &&
    candidate.blockSize <= maximum.blockSize &&
    candidate.parallelization <= maximum.parallelization &&
    candidate.keyLengthBytes <= maximum.keyLengthBytes &&
    candidate.maxMemoryBytes <= maximum.maxMemoryBytes
  );
}

function isCanonicalBase64Url(candidate: unknown): candidate is string {
  if (typeof candidate !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(candidate)) {
    return false;
  }

  return Buffer.from(candidate, 'base64url').toString('base64url') === candidate;
}

function sameParameters(left: ScryptParameters, right: ScryptParameters): boolean {
  return (
    left.cost === right.cost &&
    left.blockSize === right.blockSize &&
    left.parallelization === right.parallelization &&
    left.keyLengthBytes === right.keyLengthBytes &&
    left.maxMemoryBytes === right.maxMemoryBytes
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
