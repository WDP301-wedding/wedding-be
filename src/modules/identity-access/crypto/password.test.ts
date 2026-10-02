import { describe, expect, it } from 'vitest';

import {
  PasswordPolicyError,
  hashPassword,
  verifyPassword,
  type PasswordPolicy,
} from './password.js';

const testPolicy: PasswordPolicy = Object.freeze({
  minimumCharacters: 12,
  maximumCharacters: 128,
  maximumBytes: 512,
  scrypt: Object.freeze({
    cost: 1_024,
    blockSize: 8,
    parallelization: 1,
    keyLengthBytes: 32,
    maxMemoryBytes: 4_194_304,
  }),
});

describe('password crypto', () => {
  it('hashes and verifies the correct password with versioned parameters', async () => {
    const verifier = await hashPassword('a correct horse battery', testPolicy);

    expect(verifier).toMatchObject({
      algorithm: 'scrypt',
      version: 1,
      parameters: testPolicy.scrypt,
    });
    expect(verifier.saltEncoded).not.toContain('a correct horse battery');
    expect(verifier.derivedKeyEncoded).not.toContain('a correct horse battery');
    await expect(verifyPassword('a correct horse battery', verifier, testPolicy)).resolves.toEqual({
      matches: true,
      needsRehash: false,
    });
  });

  it('rejects an incorrect password through the constant-time comparison path', async () => {
    const verifier = await hashPassword('a correct horse battery', testPolicy);

    await expect(verifyPassword('the wrong horse battery', verifier, testPolicy)).resolves.toEqual({
      matches: false,
      needsRehash: false,
    });
  });

  it('marks valid legacy parameters for rehash', async () => {
    const legacyPolicy: PasswordPolicy = {
      ...testPolicy,
      scrypt: { ...testPolicy.scrypt, cost: 512 },
    };
    const verifier = await hashPassword('a correct horse battery', legacyPolicy);

    await expect(verifyPassword('a correct horse battery', verifier, testPolicy)).resolves.toEqual({
      matches: true,
      needsRehash: true,
    });
  });

  it.each([
    null,
    {},
    { algorithm: 'bcrypt', version: 1 },
    { algorithm: 'scrypt', version: 2 },
    {
      algorithm: 'scrypt',
      version: 1,
      parameters: testPolicy.scrypt,
      saltEncoded: 'not base64url!',
      derivedKeyEncoded: 'also invalid!',
    },
    {
      algorithm: 'scrypt',
      version: 1,
      parameters: { ...testPolicy.scrypt, cost: 3 },
      saltEncoded: 'YWJjZGVmZ2hpamtsbW5vcA',
      derivedKeyEncoded: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU',
    },
  ])('fails closed for a malformed verifier without exposing it: %j', async (verifier) => {
    await expect(verifyPassword('a correct horse battery', verifier, testPolicy)).resolves.toEqual({
      matches: false,
      needsRehash: false,
    });
  });

  it.each([
    ['too short', 'eleven-char'],
    ['too long', 'x'.repeat(129)],
  ])('rejects a password that is %s', async (_case, password) => {
    await expect(hashPassword(password, testPolicy)).rejects.toBeInstanceOf(PasswordPolicyError);
  });

  it('enforces the UTF-8 byte boundary independently of character count', async () => {
    const byteConstrainedPolicy = { ...testPolicy, maximumCharacters: 20, maximumBytes: 20 };

    await expect(hashPassword('🦄'.repeat(12), byteConstrainedPolicy)).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
  });

  it('counts Unicode code points rather than UTF-16 code units', async () => {
    const verifier = await hashPassword(`${'🦄'.repeat(11)}a`, testPolicy);

    await expect(
      verifyPassword(`${'🦄'.repeat(11)}a`, verifier, testPolicy),
    ).resolves.toMatchObject({
      matches: true,
    });
  });

  it('never includes the supplied password in policy errors', async () => {
    const password = 'private';

    try {
      await hashPassword(password, testPolicy);
      throw new Error('Expected password policy validation to fail.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PasswordPolicyError);
      expect(String(error)).not.toContain(password);
    }
  });
});
