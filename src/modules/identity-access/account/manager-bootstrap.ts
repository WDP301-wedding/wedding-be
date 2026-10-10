import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { BackendConfig } from '../../../config/env.js';
import { createPrismaClient } from '../../../core/database/prisma.js';
import {
  createDatabaseReadiness,
  DATABASE_READINESS_TIMEOUT_MS,
} from '../../../core/database/database-readiness.js';
import { createReadinessCheck } from '../../../core/http/readiness.js';
import { hashPassword, verifyPassword } from '../crypto/password.js';
import { createPrismaAccountRepository } from './account.repository.js';
import { createAccountService, normalizeEmail } from './account.service.js';

type BootstrapInput = Parameters<
  ReturnType<typeof createAccountService>['bootstrapInitialManager']
>[0];

/** Hash only target identity, excluding password and certificate paths; never echo a DSN. */
export function databaseTargetFingerprint(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return createHash('sha256')
    .update(
      JSON.stringify({
        host: url.hostname,
        port: url.port || '5432',
        database: url.pathname,
        user: url.username,
        schema: url.searchParams.get('schema')?.trim() || 'public',
      }),
    )
    .digest('hex');
}

export async function runManagerBootstrap(
  args: readonly string[],
  dependencies: {
    readonly config: BackendConfig;
    readonly readPassword: (descriptor?: number) => Promise<string>;
    readonly execute: (input: BootstrapInput) => Promise<Readonly<{ accountId: string }>>;
    readonly write: (record: object) => void;
  },
): Promise<void> {
  const { config } = dependencies;
  const url = config.database.url;
  if (!url) throw new Error('Bootstrap requires a configured database.');
  const target = databaseTargetFingerprint(url);
  if (args.length === 1 && args[0] === '--inspect-target') {
    dependencies.write({
      event: 'manager_bootstrap_target',
      environment: config.runtime.environment,
      target,
    });
    return;
  }
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--(environment|operator|target|email|password-fd)=(.+)$/u.exec(argument);
    const key = match?.[1] ?? (argument === '--confirm-bootstrap' ? 'confirm' : undefined);
    if (!key || values.has(key)) throw new Error('Invalid bootstrap arguments.');
    values.set(key, match?.[2] ?? 'yes');
  }
  const operator = values.get('operator');
  const email = values.get('email');
  if (
    values.get('confirm') !== 'yes' ||
    values.get('environment') !== config.runtime.environment ||
    values.get('target') !== target ||
    !operator ||
    !/^[A-Za-z0-9._:@/-]{1,128}$/u.test(operator) ||
    !email
  ) {
    throw new Error(
      'Explicit matching target, environment, operator and confirmation are required.',
    );
  }
  normalizeEmail(email);
  const fd = values.get('password-fd');
  if (fd !== undefined && (!/^\d{1,6}$/u.test(fd) || Number(fd) > 65535))
    throw new Error('Invalid password descriptor.');
  const password = await dependencies.readPassword(fd === undefined ? undefined : Number(fd));
  const requestId = randomUUID();
  const result = await dependencies.execute({
    email,
    password,
    environment: config.runtime.environment,
    operatorReference: operator,
    requestId,
  });
  dependencies.write({
    event: 'manager_bootstrap_completed',
    accountId: result.accountId,
    requestId,
    environment: config.runtime.environment,
    target,
    operatorReference: operator,
  });
}

export async function executeManagerBootstrap(
  config: BackendConfig,
  input: BootstrapInput,
): Promise<Readonly<{ accountId: string }>> {
  const readiness = createDatabaseReadiness(config.database.url);
  const prisma = createPrismaClient(config.database.url);
  try {
    if (!(await createReadinessCheck(readiness.probe, DATABASE_READINESS_TIMEOUT_MS)()))
      throw new Error('Bootstrap database is not ready.');
    await prisma.$connect();
    const policy = config.identityAccess.password;
    const service = createAccountService({
      repository: createPrismaAccountRepository(prisma),
      passwordCrypto: {
        hash: (password) => hashPassword(password, policy),
        verify: (password, verifier) => verifyPassword(password, verifier, policy),
      },
      dummyPasswordVerifier: await hashPassword(randomBytes(32).toString('base64url'), policy),
      disabledAccountRetentionDays: config.identityAccess.retentionDays.disabledAccountPii,
    });
    return await service.bootstrapInitialManager(input);
  } finally {
    await Promise.allSettled([prisma.$disconnect(), readiness.resource.close()]);
  }
}
