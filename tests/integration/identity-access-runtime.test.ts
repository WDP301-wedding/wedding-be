import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { BackendConfig } from '../../src/config/env.js';
import { parseEnvironment } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import { hashPassword, verifyPassword } from '../../src/modules/identity-access/crypto/password.js';
import { createPasswordOtpService } from '../../src/modules/identity-access/password-otp/password-otp.service.js';
import {
  createIdentityRuntime,
  type IdentityRuntime,
} from '../../src/modules/identity-access/identity.runtime.js';
import { issuedSessionResponseSchema } from '../../src/modules/identity-access/identity.schemas.js';
import { createPrismaWorkspaceInvitationRepository } from '../../src/modules/identity-access/workspace-invitation/workspace-invitation.repository.js';
import { hashOpaqueToken } from '../../src/modules/identity-access/crypto/token.js';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithDatabase = migrationDatabaseUrl ? describe : describe.skip;
const baseUrl = migrationDatabaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';
const testScrypt = {
  cost: 2,
  blockSize: 1,
  parallelization: 1,
  keyLengthBytes: 16,
  maxMemoryBytes: 4096,
} as const;

describeWithDatabase('IA-08 identity runtime composition', () => {
  const schemaName = `identity_runtime_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = withSchema(baseUrl, schemaName);
  const admin = new Client({ connectionString: baseUrl });
  const runtimeConfig = withTestScrypt(
    parseEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: scopedUrl,
      CORS_ALLOWED_ORIGINS: 'https://couple.example.com',
    }),
  );
  let runtime: IdentityRuntime;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await deployMigrations(scopedUrl);
    const seed = createPrismaClient(scopedUrl);
    await seed.$connect();
    const verifier = await hashPassword('correct-password', {
      minimumCharacters: 12,
      maximumCharacters: 128,
      maximumBytes: 512,
      scrypt: testScrypt,
    });
    await seed.account.create({
      data: {
        emailNormalized: 'couple@example.com',
        displayEmail: 'Couple@example.com',
        roles: { create: { role: 'COUPLE' } },
        passwordCredential: {
          create: {
            algorithm: verifier.algorithm,
            version: verifier.version,
            cost: verifier.parameters.cost,
            blockSize: verifier.parameters.blockSize,
            parallelization: verifier.parameters.parallelization,
            keyLengthBytes: verifier.parameters.keyLengthBytes,
            maxMemoryBytes: verifier.parameters.maxMemoryBytes,
            saltEncoded: verifier.saltEncoded,
            derivedKeyEncoded: verifier.derivedKeyEncoded,
          },
        },
      },
    });
    await seed.$disconnect();
    runtime = await createIdentityRuntime(runtimeConfig);
  }, 60_000);

  afterAll(async () => {
    await runtime.resource.close();
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
    await admin.end();
  });

  it('composes the real login, actor resolver, audit, and session routes', async () => {
    const app = createApp({
      corsConfig: { allowedOrigins: ['https://couple.example.com'] },
      registerRoutes: (expressApp) => expressApp.use('/api/v1', runtime.router),
      runtimeEnvironment: 'test',
    });

    const login = await request(app)
      .post('/api/v1/auth/web-sessions')
      .send({ email: 'couple@example.com', password: 'correct-password' });
    const responseBody: unknown = login.body;
    const accessToken = issuedSessionResponseSchema.parse(responseBody).data.accessToken;
    const currentUser = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    const failedLogin = await request(app)
      .post('/api/v1/auth/android-sessions')
      .send({ email: 'unknown@example.com', password: 'wrong-password' });

    expect(login.status).toBe(201);
    expect(login.headers['set-cookie']?.[0]).toContain('__Host-wedding-refresh=');
    expect(currentUser.status).toBe(200);
    expect(currentUser.body).toMatchObject({
      data: { displayEmail: 'Couple@example.com', roles: ['COUPLE'] },
    });
    expect(failedLogin.status).toBe(401);
  });

  it('accepts, logs in and refreshes a pre-deposit Couple on Android without granting FULL', async () => {
    const prisma = createPrismaClient(scopedUrl);
    try {
      const issuer = await prisma.account.findUniqueOrThrow({
        where: { emailNormalized: 'couple@example.com' },
      });
      const consultationId = randomUUID();
      const invitationToken = `wii_${'n'.repeat(43)}`;
      const now = new Date();
      await createPrismaWorkspaceInvitationRepository(prisma).issue({
        consultationId,
        recipientEmailNormalized: 'native-prospect@example.com',
        issuedByAccountId: issuer.id,
        tokenHash: hashOpaqueToken(invitationToken, 'invitation'),
        expiresAt: new Date(now.getTime() + 3600_000),
        now,
        requestId: randomUUID(),
        reissueLimit: 3,
        reissueWindowSeconds: 86400,
      });
      const app = createApp({
        runtimeEnvironment: 'test',
        registerRoutes: (server) => server.use('/api/v1', runtime.router),
      });
      const path = '/api/v1/auth/android-workspace-invitation-acceptances';
      const body = { invitationToken, password: 'native-password-123' };
      const accepted = await request(app).post(path).send(body);
      expect(accepted.status).toBe(201);
      expect(accepted.headers['set-cookie']).toBeUndefined();
      const issued = issuedSessionResponseSchema.parse(accepted.body).data;
      expect(issued).toMatchObject({ clientKind: 'ANDROID', account: { roles: ['COUPLE'] } });
      expect(issued.refreshToken).toMatch(/^wir_/u);
      const me = await request(app)
        .get('/api/v1/auth/me')
        .auth(issued.accessToken, { type: 'bearer' });
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ data: { roles: ['COUPLE'] } });
      const login = await request(app)
        .post('/api/v1/auth/android-sessions')
        .send({ email: 'native-prospect@example.com', password: body.password });
      expect(login.status).toBe(201);
      expect(login.body).toMatchObject({
        data: { account: { accountId: issued.account.accountId, roles: ['COUPLE'] } },
      });
      const refreshed = await request(app)
        .post('/api/v1/auth/android-session-refreshes')
        .send({ refreshToken: issued.refreshToken });
      expect(refreshed.status).toBe(200);
      expect(refreshed.body).toMatchObject({ data: { clientKind: 'ANDROID' } });
      for (const replayPath of [path, '/api/v1/workspace-invitation-acceptances']) {
        const replay = await request(app).post(replayPath).send(body);
        expect(replay.status).toBe(401);
        expect(replay.body).toMatchObject({ error: { code: 'INVALID_OR_EXPIRED_TOKEN' } });
      }
      const grant = await prisma.consultationAccess.findUniqueOrThrow({
        where: {
          accountId_consultationId: { accountId: issued.account.accountId, consultationId },
        },
      });
      expect(grant).toMatchObject({
        level: 'RESTRICTED',
        bookingId: null,
        sourcePaymentId: null,
        promotedAt: null,
      });
      expect(await prisma.identityOutbox.count({ where: { consultationId } })).toBe(0);
      const session = await prisma.session.findUniqueOrThrow({ where: { id: issued.sessionId } });
      expect(session.clientKind).toBe('ANDROID');
    } finally {
      await prisma.$disconnect();
    }
  });

  it('locks profile and OTP mutations inside the configured schema', async () => {
    const app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes: (server) => server.use('/api/v1', runtime.router),
    });
    const login = await request(app)
      .post('/api/v1/auth/web-sessions')
      .send({ email: 'couple@example.com', password: 'correct-password' });
    const issued = issuedSessionResponseSchema.parse(login.body).data;
    const profile = await request(app)
      .patch('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${issued.accessToken}`)
      .send({ displayName: 'Lan & Minh', expectedRevision: 1 });
    expect(profile.status).toBe(200);
    expect(profile.body).toMatchObject({ data: { displayName: 'Lan & Minh', revision: 2 } });
    const prisma = createPrismaClient(scopedUrl);
    let deliveredCode = '';
    const crypto = {
      hash: (value: string) => hashPassword(value, runtimeConfig.identityAccess.password),
      verify: (value: string, verifier: unknown) =>
        verifyPassword(value, verifier, runtimeConfig.identityAccess.password),
    };
    const otp = createPasswordOtpService({
      prisma,
      schema: schemaName,
      passwordCrypto: crypto,
      hashKey: 'a'.repeat(64),
      emailEnabled: true,
      emailProvider: {
        send(command) {
          deliveredCode = command.text.match(/\b\d{6}\b/u)![0];
          return Promise.resolve({
            idempotencyKey: command.idempotencyKey,
            messageId: randomUUID(),
          });
        },
      },
    });
    try {
      const actor = { ...issued.account, sessionId: issued.sessionId };
      const challenge = await otp.request({
        actor,
        currentPassword: 'correct-password',
        clientIp: '127.0.0.1',
        requestId: randomUUID(),
      });
      await otp.complete({
        actor,
        challengeId: challenge.challengeId,
        code: deliveredCode,
        newPassword: 'replacement-password-123',
        clientIp: '127.0.0.1',
        requestId: randomUUID(),
      });
      expect(
        (
          await request(app)
            .get('/api/v1/auth/me')
            .set('Authorization', `Bearer ${issued.accessToken}`)
        ).status,
      ).toBe(401);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('disconnects the database when runtime initialization fails', async () => {
    const invalidConfig: BackendConfig = {
      ...runtimeConfig,
      identityAccess: {
        ...runtimeConfig.identityAccess,
        password: { ...runtimeConfig.identityAccess.password, minimumCharacters: 0 },
      },
    };

    await expect(createIdentityRuntime(invalidConfig)).rejects.toMatchObject({
      name: 'PasswordConfigurationError',
    });
  });

  it.each(['brevo', 'resend'] as const)(
    'composes %s with the local notification origin fallback',
    async (provider) => {
      const emailRuntime = await createIdentityRuntime(
        withTestScrypt(
          parseEnvironment({
            NODE_ENV: 'test',
            DATABASE_URL: scopedUrl,
            ...(provider === 'brevo'
              ? {
                  BREVO_API_KEY: 'test_only_brevo',
                  BREVO_FROM_EMAIL: 'Wedding Test <sender@gmail.com>',
                }
              : {
                  RESEND_API_KEY: 're_test_only',
                  RESEND_FROM_EMAIL: 'Wedding Test <notifications@example.com>',
                }),
          }),
        ),
      );

      try {
        expect(emailRuntime.router).toBeTypeOf('function');
      } finally {
        await emailRuntime.resource.close();
      }
    },
  );
});

function withTestScrypt(config: BackendConfig): BackendConfig {
  return {
    ...config,
    identityAccess: {
      ...config.identityAccess,
      password: {
        ...config.identityAccess.password,
        scrypt: testScrypt,
      },
    },
  };
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}
async function deployMigrations(databaseUrl: string): Promise<void> {
  const cli = join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  await execFileAsync(
    process.execPath,
    [cli, 'migrate', 'deploy', '--config', 'prisma.config.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATION_DATABASE_URL: databaseUrl },
      maxBuffer: 1024 * 1024,
    },
  );
}
