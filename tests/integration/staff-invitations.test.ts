import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import {
  createStaffInvitationIssuer,
  createStaffInvitationAcceptance,
} from '../../src/modules/identity-access/staff-invitation/staff-invitation.service.js';
import { createStaffInvitationRouter } from '../../src/modules/identity-access/staff-invitation/staff-invitation.router.js';
import { createStaffServices } from '../../src/modules/staff-operations/infrastructure/staff.composition.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { hashPassword, verifyPassword } from '../../src/modules/identity-access/crypto/password.js';
import type { SendEmailCommand } from '../../src/integrations/email/email-provider.js';
import { EmailRequestRejectedError } from '../../src/integrations/email/email-provider.js';
import { createApp } from '../../src/app.js';

const suite = catalogMigrationDatabaseUrl ? describe : describe.skip;
suite('Staff email invitations', () => {
  const db = new CatalogTestDatabase('staff_invitation');
  const messages: SendEmailCommand[] = [];
  let clock = new Date('2026-11-09T01:00:00Z');
  let deliveryFailure: Error | undefined;
  const policy = {
    minimumCharacters: 1,
    maximumCharacters: 128,
    maximumBytes: 512,
    scrypt: {
      cost: 1024,
      blockSize: 8,
      parallelization: 1,
      keyLengthBytes: 32,
      maxMemoryBytes: 67108864,
    },
  };
  const crypto = {
    hash: (password: string) => hashPassword(password, policy),
    verify: (password: string, verifier: unknown) => verifyPassword(password, verifier, policy),
  };
  beforeAll(() => db.connect(), 60000);
  afterAll(() => db.disconnect());
  async function fixture() {
    const f = await studioFixture(db.prisma);
    clock = f.now;
    deliveryFailure = undefined;
    const issuer = createStaffInvitationIssuer(
      db.prisma,
      {
        manageWebOrigin: 'https://manage.example.test',
        emailProvider: {
          send(message) {
            messages.push(message);
            if (deliveryFailure) return Promise.reject(deliveryFailure);
            return Promise.resolve({
              idempotencyKey: message.idempotencyKey,
              messageId: randomUUID(),
            });
          },
        },
      },
      () => clock,
    );
    const s = createStaffServices(db.prisma, () => clock, undefined, undefined, issuer);
    const acceptance = createStaffInvitationAcceptance(db.prisma, crypto, () => clock);
    return { f, s, acceptance };
  }
  const token = () =>
    new URL(messages.at(-1)!.text.match(/https:\/\/manage[^\s]+/u)![0]).hash.slice(1);
  it('emails a single-use Manager Web link, defers Staff authority, and accepts a first password', async () => {
    const { f, s, acceptance } = await fixture();
    const email = `${randomUUID()}@example.test`,
      key = randomUUID();
    const before = messages.length;
    const issued = await s.accounts.provision(email, key, f.manager);
    expect(issued.invitation).toMatchObject({ status: 'PENDING', deliveryStatus: 'ACCEPTED' });
    const secret = token();
    expect(messages.at(-1)!.html).toContain('https://manage.example.test/staff-invitation#wis_');
    expect(JSON.stringify(issued)).not.toContain(secret);
    expect(
      await db.prisma.accountRole.count({ where: { accountId: issued.accountId, role: 'STAFF' } }),
    ).toBe(0);
    await s.staff.assign(
      f.bookingId,
      { staffAccountId: issued.accountId, expectedRevision: 0 },
      randomUUID(),
      f.manager,
    );
    expect(
      (await s.staff.directory({ q: email, limit: 25 }, f.manager)).items[0]!.invitation?.status,
    ).toBe('PENDING');
    await s.accounts.provision(email, key, f.manager);
    expect(messages).toHaveLength(before + 1);
    expect(await acceptance.details(secret)).toMatchObject({ hasExistingPassword: false });
    expect(await acceptance.details(secret)).toMatchObject({ hasExistingPassword: false });
    await acceptance.accept(secret, 'New-password-123', randomUUID());
    expect(
      await db.prisma.accountRole.count({ where: { accountId: issued.accountId, role: 'STAFF' } }),
    ).toBe(1);
    await expect(
      acceptance.accept(secret, 'Different-password', randomUUID()),
    ).rejects.toMatchObject({ code: 'STAFF_INVITATION_INVALID_OR_EXPIRED' });
    const commands = await db.prisma.identityStaffCommand.findMany();
    expect(JSON.stringify(commands)).not.toContain(secret);
  });
  it('uses existing credentials without resetting a Couple password and preserves roles', async () => {
    const { f, s, acceptance } = await fixture();
    const existing = await db.prisma.account.findUniqueOrThrow({ where: { id: f.couple.actorId } });
    const verifier = await crypto.hash('Existing-password');
    await db.prisma.passwordCredential.create({
      data: {
        accountId: existing.id,
        algorithm: verifier.algorithm,
        version: verifier.version,
        ...verifier.parameters,
        saltEncoded: verifier.saltEncoded,
        derivedKeyEncoded: verifier.derivedKeyEncoded,
      },
    });
    await s.accounts.provision(existing.emailNormalized, randomUUID(), f.manager);
    const secret = token();
    await expect(acceptance.accept(secret, 'Wrong-password', randomUUID())).rejects.toMatchObject({
      status: 422,
    });
    await acceptance.accept(secret, 'Existing-password', randomUUID());
    expect(await db.prisma.accountRole.findMany({ where: { accountId: existing.id } })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'COUPLE' }),
        expect.objectContaining({ role: 'STAFF' }),
      ]),
    );
    expect(
      (await db.prisma.passwordCredential.findUniqueOrThrow({ where: { accountId: existing.id } }))
        .saltEncoded,
    ).toBe(verifier.saltEncoded);
  });
  it('rotates on explicit resend, expires, revokes on disable and denies bypass', async () => {
    const { f, s, acceptance } = await fixture();
    const email = `${randomUUID()}@example.test`;
    const issued = await s.accounts.provision(email, randomUUID(), f.manager);
    const old = token();
    await expect(s.accounts.provision(email, randomUUID(), f.manager)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    clock = new Date(clock.getTime() + 61000);
    await s.accounts.provision(email, randomUUID(), f.manager);
    const latest = token();
    await expect(acceptance.details(old)).rejects.toMatchObject({ status: 422 });
    await expect(
      s.accounts.setOperationalAccess(
        issued.accountId,
        { enabled: true, reason: 'Attempt bypass invitation' },
        randomUUID(),
        f.manager,
      ),
    ).rejects.toMatchObject({ code: 'STAFF_INVITATION_REQUIRED' });
    await s.accounts.setOperationalAccess(
      issued.accountId,
      { enabled: false, reason: 'Stop synthetic invitation' },
      randomUUID(),
      f.manager,
    );
    await expect(acceptance.accept(latest, 'Password', randomUUID())).rejects.toMatchObject({
      status: 422,
    });
    clock = new Date(clock.getTime() + 61000);
    await s.accounts.provision(email, randomUUID(), f.manager);
    const expired = token();
    clock = new Date(clock.getTime() + 72 * 3600_000);
    await expect(acceptance.details(expired)).rejects.toMatchObject({ status: 422 });
  });
  it('records rejected and ambiguous email outcomes without sending again on command replay', async () => {
    const { f, s } = await fixture();
    for (const [error, expected] of [
      [new EmailRequestRejectedError(400), 'FAILED'],
      [new Error('timeout'), 'UNKNOWN'],
    ] as const) {
      deliveryFailure = error;
      const email = `${randomUUID()}@example.test`,
        key = randomUUID(),
        before = messages.length;
      expect((await s.accounts.provision(email, key, f.manager)).invitation?.deliveryStatus).toBe(
        expected,
      );
      await s.accounts.provision(email, key, f.manager);
      expect(messages).toHaveLength(before + 1);
    }
  });
  it('keeps public token operations no-store, rejects role input and rate limits guessing', async () => {
    const { f, s, acceptance } = await fixture();
    await s.accounts.provision(`${randomUUID()}@example.test`, randomUUID(), f.manager);
    const secret = token();
    const app = createApp({
      runtimeEnvironment: 'test',
      registerRoutes: (e) => e.use('/api/v1', createStaffInvitationRouter(acceptance)),
    });
    await request(app)
      .post('/api/v1/auth/staff-invitation-details')
      .send({ invitationToken: secret })
      .expect('Cache-Control', 'no-store')
      .expect(200);
    await request(app)
      .post('/api/v1/auth/staff-invitation-acceptances')
      .send({ invitationToken: secret, password: 'Valid', role: 'MANAGER' })
      .expect(422);
    await request(app)
      .post('/api/v1/auth/staff-invitation-acceptances')
      .send({ invitationToken: secret, password: 'Valid' })
      .expect(200);
    for (let i = 0; i < 9; i++)
      await request(app)
        .post('/api/v1/auth/staff-invitation-details')
        .send({ invitationToken: secret });
    await request(app)
      .post('/api/v1/auth/staff-invitation-details')
      .send({ invitationToken: secret })
      .expect(429);
  });
});
