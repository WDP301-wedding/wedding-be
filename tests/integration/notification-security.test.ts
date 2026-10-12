import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { createNotificationIdentityReader } from '../../src/modules/identity-access/authorization/notification-recipient.reader.js';
import { createPrismaSessionRepository } from '../../src/modules/identity-access/session/session.repository.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { NotificationSettings } from '../../src/modules/notifications-automation/application/notification-settings.js';
import { NotificationRetention } from '../../src/modules/notifications-automation/infrastructure/notification-retention.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'notification authorization and private retention boundaries',
  () => {
    let db: CatalogTestDatabase;
    beforeEach(async () => {
      db = new CatalogTestDatabase('notification_security');
      await db.connect();
    }, 60000);
    afterEach(() => db.disconnect());
    it('reads current owner facts and denies missing, disabled, expired and non-Android identities', async () => {
      const f = await studioFixture(db.prisma);
      let clock = f.now;
      const identity = createNotificationIdentityReader(db.prisma, () => clock);
      const booking = createNotificationBookingReader(db.prisma);
      expect(await identity.account(randomUUID())).toBeNull();
      expect(await identity.account(f.couple.actorId)).toMatchObject({
        accountId: f.couple.actorId,
      });
      expect(await identity.androidSession(f.couple.actorId, f.android.sessionId)).toBe(true);
      expect(await identity.androidSession(f.manager.actorId, f.android.sessionId)).toBe(false);
      expect(await identity.androidSession(f.couple.actorId, f.couple.sessionId)).toBe(false);
      expect(await identity.androidSession(f.couple.actorId, randomUUID())).toBe(false);
      clock = new Date(f.now.getTime() + 2 * 86400000);
      expect(await identity.androidSession(f.couple.actorId, f.android.sessionId)).toBe(false);
      clock = f.now;
      await createPrismaSessionRepository(db.prisma).revokeSession({
        sessionId: f.android.sessionId,
        accountId: f.couple.actorId,
        reason: 'notification-test',
        now: clock,
      });
      expect(await identity.androidSession(f.couple.actorId, f.android.sessionId)).toBe(false);
      await db.prisma.account.update({
        where: { id: f.couple.actorId },
        data: { status: 'DISABLED', disabledAt: clock },
      });
      expect(await identity.account(f.couple.actorId)).toBeNull();
      expect(await booking.read(randomUUID())).toBeNull();
      expect(await booking.fromConsultation(randomUUID())).toBeNull();
      expect(await booking.fromConsultation(f.consultationId)).toMatchObject({ id: f.bookingId });
      expect(await booking.notificationBookingIds(f.manager.actorId, true)).toContain(f.bookingId);
      expect(await booking.notificationBookingIds(randomUUID(), false)).toEqual([]);
      const consultation = await db.prisma.consultation.create({
        data: {
          id: randomUUID(),
          intendedEmailNormalized: 'test@example.invalid',
          intendedEmail: 'test@example.invalid',
          displayName: 'Test',
          brideName: 'An',
          groomName: 'Bình',
          managerAccountId: f.manager.actorId,
        },
      });
      const draft = await db.prisma.booking.create({
        data: {
          id: randomUUID(),
          consultationId: consultation.id,
          hallId: f.hallId,
          eventDate: new Date('2028-01-01'),
          shiftCode: 'LUNCH',
          planningHeadcount: 0,
        },
      });
      expect(await booking.read(draft.id)).toMatchObject({ scheduleRevision: null, couples: [] });
    }, 30000);
    it('protects revision/key/role/device authority, token ownership and explicit recipient configuration', async () => {
      const f = await studioFixture(db.prisma);
      const guests = createGuestServices(db.prisma, () => f.now);
      const settings = new NotificationSettings(
        new NotificationFoundation(db.prisma, () => f.now),
        guests.identity.resolver,
        createNotificationBookingReader(db.prisma),
      );
      const body = { expectedRevision: 0, reminderPush: false };
      await expect(
        settings.patchPreferences(f.couple.accessToken, body, undefined),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
      await expect(settings.patchPreferences(f.couple.accessToken, body, '')).rejects.toMatchObject(
        { code: 'INVALID_IDEMPOTENCY_KEY' },
      );
      expect(await settings.patchPreferences(f.couple.accessToken, body, randomUUID())).toEqual({
        revision: 1,
        reminderPush: false,
        reminderEmail: true,
      });
      expect(await settings.preferences(f.couple.accessToken)).toEqual({
        revision: 1,
        reminderPush: false,
        reminderEmail: true,
      });
      await expect(
        settings.patchPreferences(f.couple.accessToken, body, randomUUID()),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_REVISION_STALE' });
      expect(
        await settings.patchPreferences(
          f.couple.accessToken,
          { expectedRevision: 1, reminderEmail: false },
          randomUUID(),
        ),
      ).toEqual({ revision: 2, reminderPush: false, reminderEmail: false });
      expect(await settings.registry(f.manager.accessToken)).toBeNull();
      const registered = await settings.patchRegistry(
        f.manager.accessToken,
        { expectedRevision: 0, enabled: true, purposes: ['PAYMENT', 'PAYMENT'] },
        randomUUID(),
      );
      expect(registered.purposes).toEqual(['PAYMENT']);
      expect(await settings.registry(f.manager.accessToken)).toEqual(registered);
      await expect(
        settings.patchRegistry(
          f.manager.accessToken,
          { expectedRevision: 0, enabled: true, purposes: ['PAYMENT'] },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_REVISION_STALE' });
      await expect(
        settings.patchRegistry(
          f.manager.accessToken,
          { expectedRevision: 1, enabled: true, purposes: ['GUEST_INVITATION'] },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      const changed = await settings.patchRegistry(
        f.manager.accessToken,
        {
          expectedRevision: 1,
          enabled: true,
          purposes: ['PAYMENT'],
          intendedEmail: 'consented@example.invalid',
        },
        randomUUID(),
      );
      const kept = await settings.patchRegistry(
        f.manager.accessToken,
        { expectedRevision: changed.revision, enabled: true, purposes: ['REFUND'] },
        randomUUID(),
      );
      expect(
        (await db.prisma.notificationRecipient.findUniqueOrThrow({ where: { id: kept.id } }))
          .deliveryEmail,
      ).toBe('consented@example.invalid');
      await settings.patchRegistry(
        f.manager.accessToken,
        { expectedRevision: kept.revision, enabled: false, purposes: ['REFUND'] },
        randomUUID(),
      );
      expect(
        (await db.prisma.notificationRecipient.findUniqueOrThrow({ where: { id: kept.id } }))
          .deliveryEmail,
      ).toBeNull();
      const token = 'controlled-private-token';
      const install = await settings.register(
        f.android.accessToken,
        { expectedRevision: 0, installationId: randomUUID(), pushToken: token },
        randomUUID(),
      );
      expect(await settings.installations(f.android.accessToken)).toContainEqual(install);
      const other = await f.actor('COUPLE', 'ANDROID');
      await expect(
        settings.register(
          other.accessToken,
          { expectedRevision: 0, installationId: randomUUID(), pushToken: token },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'ANDROID_TOKEN_IN_USE' });
      await expect(
        settings.revoke(other.accessToken, install.id, { expectedRevision: 1 }, randomUUID()),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        settings.revoke(f.android.accessToken, install.id, { expectedRevision: 0 }, randomUUID()),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_REVISION_STALE' });
      await expect(
        settings.register(
          f.android.accessToken,
          { expectedRevision: 0, installationId: install.installationId, pushToken: 'new-token' },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_REVISION_STALE' });
      await createPrismaSessionRepository(db.prisma).revokeSession({
        sessionId: f.android.sessionId,
        accountId: f.couple.actorId,
        reason: 'notification-test',
        now: f.now,
      });
      expect(
        await settings.register(
          other.accessToken,
          { expectedRevision: 0, installationId: randomUUID(), pushToken: token },
          randomUUID(),
        ),
      ).toMatchObject({ enabled: true });
      expect(
        (await db.prisma.notificationInstallation.findUniqueOrThrow({ where: { id: install.id } }))
          .pushToken,
      ).toBeNull();
      const authorizedKey = randomUUID();
      await settings.patchPreferences(
        f.couple.accessToken,
        { expectedRevision: 2, reminderEmail: true },
        authorizedKey,
      );
      await db.prisma.accountRole.deleteMany({ where: { accountId: f.couple.actorId } });
      // Existing consultation access permits pre-promotion Couples without a global role.
      expect(await settings.preferences(f.couple.accessToken)).toMatchObject({
        reminderEmail: true,
      });
      await db.prisma.consultationAccess.deleteMany({ where: { accountId: f.couple.actorId } });
      await expect(
        settings.patchPreferences(
          f.couple.accessToken,
          { expectedRevision: 2, reminderEmail: true },
          authorizedKey,
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }, 30000);
    it('paginates scoped reads and refuses stale, unknown or credential requeue without changing business state', async () => {
      const f = await studioFixture(db.prisma);
      const foundation = new NotificationFoundation(db.prisma, () => f.now);
      const settings = new NotificationSettings(
        foundation,
        createGuestServices(db.prisma, () => f.now).identity.resolver,
        createNotificationBookingReader(db.prisma),
      );
      const recipient = await db.prisma.notificationRecipient.create({
        data: { accountId: f.couple.actorId, purposes: ['CONTRACT'] },
      });
      const input = () => ({
        eventId: randomUUID(),
        owner: 'booking-lifecycle',
        bookingId: f.bookingId,
        recipientId: recipient.id,
        channel: 'IN_APP',
        purpose: 'CONTRACT',
        templateVersion: 1,
        scheduledAt: f.now.toISOString(),
        data: {},
      });
      const intents = [];
      for (let n = 0; n < 3; n++) {
        const intent = await foundation.enqueue(input());
        await db.prisma.notificationInbox.create({
          data: {
            intentId: intent.id,
            accountId: f.couple.actorId,
            bookingId: f.bookingId,
            createdAt: f.now,
          },
        });
        intents.push(intent);
      }
      const first = await settings.inbox(f.couple.accessToken, { limit: 1 });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      const next = await settings.inbox(f.couple.accessToken, {
        limit: 1,
        cursor: first.nextCursor,
      });
      expect(next.items[0]?.id).not.toBe(first.items[0]?.id);
      await expect(
        settings.inbox(f.couple.accessToken, { cursor: randomUUID() }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      const item = first.items[0]!;
      const read = await settings.markRead(
        f.couple.accessToken,
        item.id,
        { expectedRevision: 1 },
        randomUUID(),
      );
      expect(
        await settings.markRead(
          f.couple.accessToken,
          item.id,
          { expectedRevision: read.revision },
          randomUUID(),
        ),
      ).toEqual(read);
      await expect(
        settings.markRead(f.couple.accessToken, item.id, { expectedRevision: 1 }, randomUUID()),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_REVISION_STALE' });
      expect(
        (await settings.inbox(f.couple.accessToken, {})).items.some((i) => i.readAt !== null),
      ).toBe(true);
      await expect(
        settings.readAll(
          f.couple.accessToken,
          { throughCreatedAt: new Date(f.now.getTime() + 1000).toISOString() },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      const statuses = await settings.statuses(f.manager.accessToken, {
        purpose: 'CONTRACT',
        state: 'QUEUED',
        limit: 1,
      });
      expect(statuses.items).toHaveLength(1);
      expect(statuses.nextCursor).not.toBeNull();
      expect(
        (
          await settings.statuses(f.manager.accessToken, {
            purpose: 'CONTRACT',
            state: 'QUEUED',
            limit: 1,
            cursor: statuses.nextCursor,
          })
        ).items[0]?.id,
      ).not.toBe(statuses.items[0]?.id);
      await expect(
        settings.statuses(f.manager.accessToken, { cursor: randomUUID() }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        settings.requeue(
          f.manager.accessToken,
          randomUUID(),
          { expectedRevision: 1, reason: 'Missing test intent' },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        settings.requeue(
          f.manager.accessToken,
          intents[0]!.id,
          { expectedRevision: 999, reason: 'Stale test intent' },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_REVISION_STALE' });
      const credentialIntent = intents[0]!;
      const claim = (await foundation.claimDue()).find((i) => i.id === credentialIntent.id)!;
      const dead = await foundation.recordOutcome(claim.id, claim.leaseId!, 'DEAD_LETTER', {
        errorCode: 'CONTROLLED_FAILURE',
      });
      await db.prisma.notificationCredential.create({
        data: {
          intentId: dead.id,
          credentialId: randomUUID(),
          keyVersion: 'v1',
          nonce: Buffer.alloc(12).toString('base64'),
          tag: Buffer.alloc(16).toString('base64'),
          ciphertext: 'YWJj',
          expiresAt: new Date(f.now.getTime() + 1000),
          createdAt: f.now,
        },
      });
      await expect(
        settings.requeue(
          f.manager.accessToken,
          dead.id,
          { expectedRevision: dead.revision, reason: 'Owner must reissue' },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_CREDENTIAL_REISSUE_REQUIRED' });
      expect(
        (
          await settings.statuses(f.manager.accessToken, {
            state: 'DEAD_LETTER',
            purpose: 'CONTRACT',
          })
        ).items.some((i) => i.lastErrorCode === 'CONTROLLED_FAILURE'),
      ).toBe(true);
      expect(
        (await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).phase,
      ).toBe('CONFIRMED');
    }, 30000);
    it('conceals the prior Manager inbox after the account loses its Manager role', async () => {
      const f = await studioFixture(db.prisma);
      const foundation = new NotificationFoundation(db.prisma, () => f.now);
      const settings = new NotificationSettings(
        foundation,
        createGuestServices(db.prisma, () => f.now).identity.resolver,
        createNotificationBookingReader(db.prisma),
      );
      const recipient = await db.prisma.notificationRecipient.create({
        data: { accountId: f.manager.actorId, operational: true, purposes: ['CONTRACT'] },
      });
      const intent = await foundation.enqueue({
        eventId: randomUUID(),
        owner: 'booking-lifecycle',
        bookingId: f.bookingId,
        recipientId: recipient.id,
        channel: 'IN_APP',
        purpose: 'CONTRACT',
        templateVersion: 1,
        scheduledAt: f.now.toISOString(),
        data: {},
      });
      const item = await db.prisma.notificationInbox.create({
        data: {
          intentId: intent.id,
          accountId: f.manager.actorId,
          bookingId: f.bookingId,
          createdAt: f.now,
        },
      });
      expect((await settings.inbox(f.manager.accessToken, {})).items.map((i) => i.id)).toContain(
        item.id,
      );
      await db.prisma.accountRole.deleteMany({
        where: { accountId: f.manager.actorId, role: 'MANAGER' },
      });
      await db.prisma.accountRole.create({
        data: { accountId: f.manager.actorId, role: 'COUPLE' },
      });
      expect(await settings.inbox(f.manager.accessToken, {})).toEqual({
        items: [],
        nextCursor: null,
      });
      expect(await settings.unread(f.manager.accessToken)).toEqual({ count: 0 });
      await expect(
        settings.markRead(f.manager.accessToken, item.id, { expectedRevision: 1 }, randomUUID()),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(
        (await db.prisma.notificationInbox.findUniqueOrThrow({ where: { id: item.id } })).readAt,
      ).toBeNull();
    }, 30000);
    it('expires encrypted content in bounded batches without deleting deduplication and retains eligible active destinations', async () => {
      const f = await studioFixture(db.prisma);
      let clock = f.now;
      const foundation = new NotificationFoundation(db.prisma, () => clock);
      const identity = createNotificationIdentityReader(db.prisma, () => clock);
      const recipient = await db.prisma.notificationRecipient.create({
        data: {
          accountId: f.manager.actorId,
          operational: true,
          purposes: ['PAYMENT'],
          deliveryEmail: 'authorized@example.invalid',
        },
      });
      const intent = await foundation.enqueue({
        eventId: randomUUID(),
        owner: 'payments-billing',
        bookingId: f.bookingId,
        recipientId: recipient.id,
        channel: 'EMAIL',
        purpose: 'PAYMENT',
        templateVersion: 1,
        scheduledAt: clock.toISOString(),
        data: {},
      });
      const expiresAt = new Date(clock.getTime() + 1000);
      await db.prisma.notificationCredential.create({
        data: {
          intentId: intent.id,
          credentialId: randomUUID(),
          keyVersion: 'v1',
          nonce: Buffer.alloc(12).toString('base64'),
          tag: Buffer.alloc(16).toString('base64'),
          ciphertext: 'YWJj',
          expiresAt,
          createdAt: clock,
        },
      });
      const retention = new NotificationRetention(foundation, identity);
      expect(await retention.run()).toMatchObject({ credentials: 0 });
      expect(
        (await db.prisma.notificationRecipient.findUniqueOrThrow({ where: { id: recipient.id } }))
          .deliveryEmail,
      ).toBe('authorized@example.invalid');
      clock = new Date(clock.getTime() + 61000);
      expect(await retention.run()).toMatchObject({ credentials: 1 });
      expect(
        (
          await db.prisma.notificationCredential.findUniqueOrThrow({
            where: { intentId: intent.id },
          })
        ).ciphertext,
      ).toBeNull();
      expect(await db.prisma.notificationIntent.count({ where: { id: intent.id } })).toBe(1);
      await db.prisma.account.update({
        where: { id: f.manager.actorId },
        data: { status: 'DISABLED', disabledAt: clock },
      });
      clock = new Date(clock.getTime() + 61000);
      expect((await retention.run()).recipients).toBeGreaterThanOrEqual(1);
      expect(
        (await db.prisma.notificationRecipient.findUniqueOrThrow({ where: { id: recipient.id } }))
          .deliveryEmail,
      ).toBeNull();
    }, 30000);
  },
);
