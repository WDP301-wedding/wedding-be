import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/core/database/prisma.js';
import {
  DiagnosticPool,
  newDatabaseDiagnostics,
  withDatabaseDiagnostics,
} from '../../src/core/database/diagnostics.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';
import { createAuthenticatedActorResolver } from '../../src/modules/identity-access/authorization/authenticated-actor.middleware.js';
import { issueOpaqueToken } from '../../src/modules/identity-access/crypto/token.js';
import { PrismaBookingBoundary } from '../../src/core/database/booking-boundary.js';
import { createScopedIdentityReaders } from '../../src/modules/identity-access/authorization/scoped-identity.reader.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';

const databaseDescribe = catalogMigrationDatabaseUrl ? describe : describe.skip;
databaseDescribe('Identity driver budget and fresh authority', () => {
  const db = new CatalogTestDatabase('identity_read_perf');
  let measured: ReturnType<typeof createPrismaClient>;
  beforeAll(async () => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(catalogMigrationDatabaseUrl!).hostname))
      throw new Error('Only disposable loopback databases are allowed.');
    await db.connect();
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    url.searchParams.delete('schema');
    url.searchParams.set('application_name', 'identity_perf_measured');
    measured = createPrismaClient(url.toString(), true);
  }, 60_000);
  afterAll(async () => {
    await measured?.$disconnect();
    await db.disconnect();
  });

  async function fixture() {
    const account = await db.prisma.account.create({
      data: {
        emailNormalized: `${randomUUID()}@example.test`,
        displayEmail: 'Synthetic identity',
        roles: { create: [{ role: 'COUPLE' }, { role: 'STAFF' }] },
      },
    });
    const token = issueOpaqueToken('access', 32);
    const expiry = new Date(Date.now() + 60_000);
    const session = await createPrismaSessionRepository(db.prisma).createSession({
      accountId: account.id,
      clientKind: 'WEB',
      accessTokenHash: token.tokenHash,
      refreshTokenHash: issueOpaqueToken('refresh', 32).tokenHash,
      now: new Date(),
      accessExpiresAt: expiry,
      idleExpiresAt: expiry,
      absoluteExpiresAt: expiry,
    });
    const clock = { now: new Date() };
    const resolver = createAuthenticatedActorResolver(
      createPrismaSessionRepository(measured),
      () => clock.now,
    );
    return { account, token, session, resolver, clock };
  }

  it('resolves all authority fields in one driver query and observes role removal immediately', async () => {
    const f = await fixture();
    const state = newDatabaseDiagnostics();
    const actor = await withDatabaseDiagnostics(state, () => f.resolver.resolve(f.token.token));
    expect(new Set(actor.roles)).toEqual(new Set(['COUPLE', 'STAFF']));
    expect(actor.accountId).toBe(f.account.id);
    expect(state.queries).toBe(1);
    expect(state.acquires).toBe(1);
    await db.prisma.accountRole.deleteMany({ where: { accountId: f.account.id, role: 'STAFF' } });
    expect((await f.resolver.resolve(f.token.token)).roles).toEqual(['COUPLE']);
  });

  it.each(['credential', 'session', 'disabled', 'accessExpiry', 'idleExpiry', 'absoluteExpiry'])(
    'rejects changed %s on the next read without cached authority',
    async (change) => {
      const f = await fixture();
      await f.resolver.resolve(f.token.token);
      const expiry = new Date(f.clock.now.getTime() + 5000);
      if (change === 'credential' || change === 'accessExpiry') {
        await db.prisma.accessCredential.update({
          where: { tokenHash: f.token.tokenHash },
          data: change === 'credential' ? { status: 'REVOKED' } : { expiresAt: expiry },
        });
      } else if (change === 'disabled') {
        await db.prisma.account.update({
          where: { id: f.account.id },
          data: { status: 'DISABLED', disabledAt: new Date() },
        });
      } else {
        await db.prisma.session.update({
          where: { id: f.session.sessionId },
          data:
            change === 'session'
              ? { status: 'REVOKED' }
              : change === 'idleExpiry'
                ? { idleExpiresAt: expiry }
                : { idleExpiresAt: expiry, absoluteExpiresAt: expiry },
        });
      }
      f.clock.now = new Date(f.clock.now.getTime() + 10000);
      await expect(f.resolver.resolve(f.token.token)).rejects.toMatchObject({ status: 401 });
    },
  );

  it.each(['Account', 'AccountRole', 'Session', 'AccessCredential'] as const)(
    'rechecks authority after a concurrent %s writer wins the lock',
    async (table) => {
      const f = await fixture();
      const boundary = new PrismaBookingBoundary(measured);
      const scoped = createScopedIdentityReaders(measured, boundary);
      let locked!: () => void, release!: () => void;
      const hasLock = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const writer = db.prisma.$transaction(
        async (tx) => {
          if (table === 'Account' || table === 'AccountRole') {
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE ${Prisma.raw(table === 'Account' ? 'id' : '"accountId"')}=${f.account.id}::uuid FOR UPDATE`,
            );
          } else if (table === 'Session') {
            await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${f.session.sessionId}::uuid FOR UPDATE`;
          } else {
            await tx.$queryRaw`SELECT id FROM "AccessCredential" WHERE "tokenHash"=${f.token.tokenHash} FOR UPDATE`;
          }
          locked();
          await gate;
          if (table === 'Account')
            await tx.account.update({
              where: { id: f.account.id },
              data: { status: 'DISABLED', disabledAt: new Date() },
            });
          if (table === 'AccountRole')
            await tx.accountRole.deleteMany({ where: { accountId: f.account.id } });
          if (table === 'Session')
            await tx.session.update({
              where: { id: f.session.sessionId },
              data: { status: 'REVOKED' },
            });
          if (table === 'AccessCredential')
            await tx.accessCredential.update({
              where: { tokenHash: f.token.tokenHash },
              data: { status: 'REVOKED' },
            });
        },
        { timeout: 15000 },
      );
      await hasLock;
      const reader = boundary.runRead(
        {
          bookingId: randomUUID(),
          context: {
            authority: 'AUTHENTICATED',
            actorAccountId: f.account.id,
            requestId: randomUUID(),
            causationId: randomUUID(),
          },
        },
        () => scoped.resolver.resolve(f.token.token),
      );
      // Attach rejection handling before unblocking the writer.
      const result = reader.then(
        (actor) => ({ actor }),
        (error) => ({ error: error as { status: number } }),
      );
      try {
        const deadline = performance.now() + 5000;
        let waiting = false;
        while (performance.now() < deadline) {
          const [row] = await db.prisma.$queryRaw<{ waiting: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='identity_perf_measured' AND wait_event_type='Lock') AS waiting`;
          if (row?.waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
      } finally {
        release();
      }
      await writer;
      const outcome = await result;
      if (table === 'AccountRole') expect(outcome).toMatchObject({ actor: { roles: [] } });
      else expect(outcome).toMatchObject({ error: { status: 401 } });
    },
    20000,
  );

  it('counts transaction control commands and callback-pool waiting without losing request scope', async () => {
    const transaction = newDatabaseDiagnostics();
    await withDatabaseDiagnostics(transaction, () =>
      measured.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1`;
      }),
    );
    expect(transaction.queries).toBeGreaterThanOrEqual(3); // BEGIN, SELECT, COMMIT
    expect(transaction.acquires).toBe(1);
    const url = new URL(catalogMigrationDatabaseUrl!);
    url.pathname = '/' + db.databaseName;
    const pool = new DiagnosticPool({ connectionString: url.toString(), max: 1 });
    try {
      const held = await pool.connect();
      const state = newDatabaseDiagnostics();
      const pending = withDatabaseDiagnostics(
        state,
        () =>
          new Promise<void>((resolve, reject) => {
            pool.query('SELECT 1', (error) => {
              if (error) reject(error);
              else resolve();
            });
          }),
      );
      expect(pool.waitingCount).toBe(1);
      held.release();
      await pending;
      expect(state).toMatchObject({ queries: 1, acquires: 1, maxWaiting: 1, errors: 0 });
      expect(state.acquireMs).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });
});
