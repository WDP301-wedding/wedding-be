import 'dotenv/config';

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  ActiveInvitationExistsError,
  createPrismaWorkspaceInvitationRepository,
  InvitationReissueLimitError,
} from '../../src/modules/identity-access/workspace-invitation/workspace-invitation.repository.js';

const execFileAsync = promisify(execFile);
const migrationDatabaseUrl = process.env.TEST_MIGRATION_DATABASE_URL?.trim();
const describeWithDatabase = migrationDatabaseUrl ? describe : describe.skip;
const baseUrl = migrationDatabaseUrl ?? 'postgresql://unused:unused@127.0.0.1:1/unused';

describeWithDatabase('IA-10 workspace invitation persistence', () => {
  const schemaName = `identity_invitation_${randomUUID().replaceAll('-', '')}`;
  const scopedUrl = withSchema(baseUrl, schemaName);
  const admin = new Client({ connectionString: baseUrl });
  const prisma = createPrismaClient(scopedUrl);
  const repository = createPrismaWorkspaceInvitationRepository(prisma);
  const consultationId = randomUUID();
  let issuerId: string;

  beforeAll(async () => {
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await deployMigrations(scopedUrl);
    await prisma.$connect();
    const issuer = await prisma.account.create({
      data: { emailNormalized: 'manager@example.com', displayEmail: 'manager@example.com' },
    });
    issuerId = issuer.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await admin.query(`DROP SCHEMA ${quoteIdentifier(schemaName)} CASCADE`);
    await admin.end();
  });

  it('lets the database choose one concurrent issue winner and persists no raw token', async () => {
    const now = new Date('2026-10-03T00:00:00.000Z');
    const base = input({ consultationId, issuerId, now });
    const outcomes = await Promise.allSettled([
      repository.issue({ ...base, tokenHash: 'a'.repeat(43) }),
      repository.issue({ ...base, tokenHash: 'b'.repeat(43) }),
    ]);

    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(
      (outcomes.find(({ status }) => status === 'rejected') as PromiseRejectedResult).reason,
    ).toBeInstanceOf(ActiveInvitationExistsError);
    const stored = await prisma.workspaceInvitation.findMany({ where: { consultationId } });
    expect(stored.filter(({ status }) => status === 'ACTIVE')).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toMatch(/wii_/u);
  });

  it('atomically supersedes reissues, enforces the rolling limit, and retains terminal rows', async () => {
    const start = new Date('2026-10-03T01:00:00.000Z');
    for (let index = 0; index < 3; index += 1) {
      await repository.reissue({
        ...input({ consultationId, issuerId, now: addSeconds(start, index) }),
        tokenHash: String.fromCharCode(99 + index).repeat(43),
      });
    }
    await expect(
      repository.reissue({
        ...input({ consultationId, issuerId, now: addSeconds(start, 4) }),
        tokenHash: 'z'.repeat(43),
      }),
    ).rejects.toBeInstanceOf(InvitationReissueLimitError);

    const rows = await prisma.workspaceInvitation.findMany({
      where: { consultationId },
      orderBy: { sequence: 'asc' },
    });
    expect(rows.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4]);
    expect(rows.filter(({ status }) => status === 'ACTIVE')).toHaveLength(1);
    expect(rows.filter(({ status }) => status === 'SUPERSEDED')).toHaveLength(3);
  });

  it('makes revoke idempotent while preserving invitation and audit references', async () => {
    const active = await prisma.workspaceInvitation.findFirstOrThrow({
      where: { consultationId, status: 'ACTIVE' },
    });
    const command = {
      invitationId: active.id,
      actorAccountId: issuerId,
      now: new Date('2026-10-03T02:00:00.000Z'),
      requestId: randomUUID(),
    };

    await expect(repository.revoke(command)).resolves.toBe(true);
    await expect(repository.revoke({ ...command, requestId: randomUUID() })).resolves.toBe(true);
    await expect(
      prisma.workspaceInvitation.findUnique({ where: { id: active.id } }),
    ).resolves.toMatchObject({
      consultationId,
      status: 'REVOKED',
    });
    const audits = await prisma.auditLog.findMany({
      where: { entityId: active.id, action: 'workspace-invitation.revoked' },
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toMatch(/manager@example|wii_|tokenHash/iu);
  });

  it('expires stale state before issuing a replacement sequence', async () => {
    const expiringConsultationId = randomUUID();
    const issuedAt = new Date('2026-10-01T00:00:00.000Z');
    const first = await repository.issue({
      ...input({ consultationId: expiringConsultationId, issuerId, now: issuedAt }),
      tokenHash: 'm'.repeat(43),
      expiresAt: addSeconds(issuedAt, 60),
    });
    const replacement = await repository.issue({
      ...input({
        consultationId: expiringConsultationId,
        issuerId,
        now: addSeconds(issuedAt, 60),
      }),
      tokenHash: 'n'.repeat(43),
    });

    expect(first.sequence).toBe(1);
    expect(replacement.sequence).toBe(2);
    await expect(
      prisma.workspaceInvitation.findUnique({ where: { id: first.invitationId } }),
    ).resolves.toMatchObject({ status: 'EXPIRED' });
  });

  it('keeps one active invitation under concurrent reissue operations', async () => {
    const concurrentConsultationId = randomUUID();
    const now = new Date('2026-10-05T00:00:00.000Z');
    await repository.issue({
      ...input({ consultationId: concurrentConsultationId, issuerId, now }),
      tokenHash: 'p'.repeat(43),
    });

    const outcomes = await Promise.allSettled([
      repository.reissue({
        ...input({ consultationId: concurrentConsultationId, issuerId, now: addSeconds(now, 1) }),
        tokenHash: 'q'.repeat(43),
      }),
      repository.reissue({
        ...input({ consultationId: concurrentConsultationId, issuerId, now: addSeconds(now, 1) }),
        tokenHash: 'r'.repeat(43),
      }),
    ]);

    expect(outcomes.some(({ status }) => status === 'fulfilled')).toBe(true);
    const rows = await prisma.workspaceInvitation.findMany({
      where: { consultationId: concurrentConsultationId },
    });
    expect(rows.filter(({ status }) => status === 'ACTIVE')).toHaveLength(1);
  });
});

function input(options: { consultationId: string; issuerId: string; now: Date }) {
  return {
    consultationId: options.consultationId,
    recipientEmailNormalized: 'couple@example.com',
    issuedByAccountId: options.issuerId,
    tokenHash: 'x'.repeat(43),
    expiresAt: addSeconds(options.now, 259_200),
    now: options.now,
    requestId: randomUUID(),
    reissueLimit: 3,
    reissueWindowSeconds: 86_400,
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
function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
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
