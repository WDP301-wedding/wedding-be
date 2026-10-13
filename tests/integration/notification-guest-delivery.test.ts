import { randomUUID, randomBytes } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { NotificationFoundation } from '../../src/modules/notifications-automation/infrastructure/notification-foundation.js';
import { CredentialCipher } from '../../src/modules/notifications-automation/infrastructure/credential-cipher.js';
import { createGuestDeliveryAdapter } from '../../src/modules/notifications-automation/infrastructure/guest-delivery.adapter.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';
import { createNotificationIdentityReader } from '../../src/modules/identity-access/authorization/notification-recipient.reader.js';
import { NotificationEventConsumer } from '../../src/modules/notifications-automation/infrastructure/event-consumer.js';
import { NotificationDispatcher } from '../../src/modules/notifications-automation/application/notification-dispatcher.js';
import { NotificationEmailDelivery } from '../../src/modules/notifications-automation/infrastructure/email-delivery.js';
import { NotificationRetention } from '../../src/modules/notifications-automation/infrastructure/notification-retention.js';
import { NotificationSettings } from '../../src/modules/notifications-automation/application/notification-settings.js';
import { PrismaInvitationAutomationReader } from '../../src/modules/invitation-studio/infrastructure/prisma-automation.reader.js';
import { createNotificationRouter } from '../../src/modules/notifications-automation/http/notification.router.js';
import { createGuestRouter } from '../../src/modules/guest-management/http/guest.router.js';
import { createApp } from '../../src/app.js';
import request from 'supertest';
import {
  result,
  guestDeliveryDto,
} from '../../src/modules/notifications-automation/http/notification.schemas.js';
import {
  sessionSchema,
  invitationViewSchema,
} from '../../src/modules/guest-management/http/guest.schemas.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'notification Guest credential transaction',
  () => {
    const db = new CatalogTestDatabase('notification_guest_delivery');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    it('retains encrypted delivery atomically and retries without issuing a second token', async () => {
      const f = await studioFixture(db.prisma),
        now = () => f.now;
      const g = createGuestServices(db.prisma, now),
        cipher = new CredentialCipher({ v1: randomBytes(32).toString('base64') }, 'v1', now);
      const foundation = new NotificationFoundation(db.prisma, now, g.boundary),
        adapter = createGuestDeliveryAdapter(g, foundation, cipher);
      const design = await f.services.designs.create(
        { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
        f.couple,
      );
      await f.services.publication.publish(
        {
          bookingId: f.bookingId,
          designId: design.designId,
          designRevisionId: design.revisionId,
          expectedRevision: 1,
          expectedPublicationRevision: 0,
          idempotencyKey: randomUUID(),
        },
        f.couple,
      );
      const [group] = await g.guests.groups(f.bookingId, f.couple);
      const guest = await g.guests.createGuest(
        f.bookingId,
        { name: 'Khách thử', guestGroupId: group!.guestGroupId },
        randomUUID(),
        f.couple,
      );
      const input = { expectedRevision: 0, intendedEmail: 'authorized@example.invalid' },
        key = randomUUID();
      const result = await g.links.issueDelivery(
        f.bookingId,
        guest.guestId,
        input,
        key,
        f.couple,
        adapter,
      );
      expect(
        await g.links.issueDelivery(f.bookingId, guest.guestId, input, key, f.couple, adapter),
      ).toEqual(result);
      const row = await db.prisma.notificationCredential.findUniqueOrThrow({
        where: { intentId: result.notificationIntentId },
      });
      const raw = cipher.open(
        {
          keyVersion: row.keyVersion,
          nonce: row.nonce!,
          tag: row.tag!,
          ciphertext: row.ciphertext!,
          expiresAt: row.expiresAt,
        },
        { intentId: row.intentId, bookingId: f.bookingId, purpose: 'GUEST_INVITATION' },
      );
      expect(JSON.stringify(result)).not.toContain(raw);
      expect(
        JSON.stringify(
          (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: row.intentId } }))
            .data,
        ),
      ).not.toContain(raw);
      expect(
        await db.prisma.guestInvitationCredential.count({ where: { guestId: guest.guestId } }),
      ).toBe(1);
      await expect(
        g.links.issueDelivery(
          f.bookingId,
          guest.guestId,
          { ...input, intendedEmail: 'changed@example.invalid' },
          key,
          f.couple,
          adapter,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
      const prior = await db.prisma.guestInvitationCredential.findUniqueOrThrow({
        where: { id: result.credentialId },
      });
      await expect(
        g.links.issueDelivery(
          f.bookingId,
          guest.guestId,
          { ...input, expectedRevision: 1 },
          randomUUID(),
          f.couple,
          {
            retain: () => Promise.reject(new Error('controlled persistence failure')),
          },
        ),
      ).rejects.toThrow('controlled persistence failure');
      expect(
        await db.prisma.guestInvitationCredential.findUniqueOrThrow({
          where: { id: result.credentialId },
        }),
      ).toEqual(prior);
      expect(
        await db.prisma.guestInvitationCredential.count({ where: { guestId: guest.guestId } }),
      ).toBe(1);
      const claimed = (await foundation.claimDue(100)).find((v) => v.id === row.intentId)!;
      await foundation.recordOutcome(row.intentId, claimed.leaseId!, 'ACCEPTED', {
        providerMessageId: 'accepted-is-not-delivered',
      });
      expect(
        (await db.prisma.notificationIntent.findUniqueOrThrow({ where: { id: row.intentId } }))
          .state,
      ).toBe('UNKNOWN');
      expect((await foundation.claimDue(100)).some((v) => v.id === row.intentId)).toBe(false);
      await foundation.recordOutcome(row.intentId, claimed.leaseId!, 'DELIVERED', {
        providerMessageId: 'accepted-is-not-delivered',
      });
      const purged = await db.prisma.notificationCredential.findUniqueOrThrow({
        where: { intentId: row.intentId },
      });
      expect(purged.ciphertext).toBeNull();
      expect(purged.purgedAt).not.toBeNull();
      await expect(
        db.prisma.notificationCredential.update({
          where: { intentId: row.intentId },
          data: { expiresAt: new Date('2030-01-01') },
        }),
      ).rejects.toThrow();
    }, 30000);
    it('queues the real Guest HTTP command, delivers only the explicit destination and purges private content while preserving dedup', async () => {
      const f = await studioFixture(db.prisma);
      let clock = f.now;
      const guests = createGuestServices(db.prisma, () => clock),
        foundation = new NotificationFoundation(db.prisma, () => clock, guests.boundary);
      const identity = createNotificationIdentityReader(db.prisma, () => clock),
        booking = createNotificationBookingReader(db.prisma);
      const consumer = new NotificationEventConsumer(foundation, booking, identity);
      const cipher = new CredentialCipher(
        { v1: randomBytes(32).toString('base64') },
        'v1',
        () => clock,
      );
      const adapter = createGuestDeliveryAdapter(guests, foundation, cipher);
      const app = createApp({
        runtimeEnvironment: 'test',
        registerRoutes: (a) => {
          a.use('/api/v1', createGuestRouter(guests));
          a.use(
            '/api/v1',
            createNotificationRouter(
              new NotificationSettings(foundation, guests.identity.resolver, booking),
              guests,
              adapter,
            ),
          );
        },
      });
      const design = await f.services.designs.create(
        { bookingId: f.bookingId, content: f.content, idempotencyKey: randomUUID() },
        f.couple,
      );
      await f.services.publication.publish(
        {
          bookingId: f.bookingId,
          designId: design.designId,
          designRevisionId: design.revisionId,
          expectedRevision: 1,
          expectedPublicationRevision: 0,
          idempotencyKey: randomUUID(),
        },
        f.couple,
      );
      const [group] = await guests.guests.groups(f.bookingId, f.couple);
      const guest = await guests.guests.createGuest(
        f.bookingId,
        {
          name: 'Khách được mời',
          guestGroupId: group!.guestGroupId,
          phone: '+84900000000',
          operationalNote: 'private-note',
        },
        randomUUID(),
        f.couple,
      );
      const key = randomUUID(),
        issue = () =>
          request(app)
            .post(`/api/v1/bookings/${f.bookingId}/guests/${guest.guestId}/delivery`)
            .set('Authorization', `Bearer ${f.couple.accessToken}`)
            .set('Idempotency-Key', key)
            .send({ expectedRevision: 0, intendedEmail: 'explicit@example.invalid' });
      for (const invalidKey of [undefined, 'k'.repeat(129)]) {
        const invalid = request(app)
          .post('/api/v1/bookings/' + f.bookingId + '/guests/' + guest.guestId + '/delivery')
          .set('Authorization', 'Bearer ' + f.couple.accessToken);
        if (invalidKey !== undefined) invalid.set('Idempotency-Key', invalidKey);
        expect(
          (await invalid.send({ expectedRevision: 0, intendedEmail: 'explicit@example.invalid' }))
            .status,
        ).toBe(invalidKey === undefined ? 400 : 422);
      }
      const issued = await issue();
      expect(issued.status).toBe(201);
      const issuedData = result(guestDeliveryDto).parse(issued.body).data;
      expect((await issue()).body).toEqual(issued.body);
      expect(JSON.stringify(issued.body)).not.toMatch(
        /wgc_|explicit@example|84900000000|private-note/u,
      );
      let content = '',
        destination: readonly string[] = [];
      const email = new NotificationEmailDelivery(
        {
          enabled: true,
          provider: 'brevo',
          apiKey: 'controlled',
          fromEmail: 'sender@example.invalid',
        },
        {
          send: (command) => {
            content = command.text;
            destination = command.to;
            return Promise.resolve({
              idempotencyKey: command.idempotencyKey,
              messageId: 'controlled-guest-ack',
            });
          },
        },
      );
      const dispatcher = new NotificationDispatcher(
        consumer,
        email,
        guests.links,
        new PrismaInvitationAutomationReader(db.prisma),
        cipher,
        {
          emailAllowlist: ['explicit@example.invalid'],
          bookingAllowlist: [f.bookingId],
          guestLinkUrl: 'https://wedding-web-silk.vercel.app/invitation/personal',
        },
      );
      const claim = (await foundation.claimDue()).find(
        (i) => i.id === issuedData.notificationIntentId,
      )!;
      const pendingRetention = new NotificationRetention(foundation, identity);
      await pendingRetention.run();
      expect(
        (
          await db.prisma.notificationRecipient.findUniqueOrThrow({
            where: { id: claim.recipientId },
          })
        ).deliveryEmail,
      ).toBe('explicit@example.invalid');
      const missingCipher = new NotificationDispatcher(
        consumer,
        email,
        guests.links,
        new PrismaInvitationAutomationReader(db.prisma),
        null,
        {
          emailAllowlist: ['explicit@example.invalid'],
          bookingAllowlist: [f.bookingId],
          guestLinkUrl: null,
        },
      );
      expect(await missingCipher.send(claim)).toMatchObject({
        outcome: 'DEAD_LETTER',
        errorCode: 'GUEST_DELIVERY_UNAVAILABLE',
      });
      const wrongKey = new CredentialCipher(
        { v1: randomBytes(32).toString('base64') },
        'v1',
        () => clock,
      );
      expect(
        await new NotificationDispatcher(
          consumer,
          email,
          guests.links,
          new PrismaInvitationAutomationReader(db.prisma),
          wrongKey,
          { emailAllowlist: null, bookingAllowlist: null, guestLinkUrl: null },
        ).send(claim),
      ).toMatchObject({ outcome: 'DEAD_LETTER', errorCode: 'CREDENTIAL_DECRYPTION_FAILED' });
      const delivered = await dispatcher.send(claim);
      expect(delivered.outcome).toBe('ACCEPTED');
      expect(destination).toEqual(['explicit@example.invalid']);
      expect(content).not.toMatch(/84900000000|private-note/u);
      const link = new URL(content.slice(content.indexOf('https://')));
      expect(link.origin + link.pathname).toBe(
        'https://wedding-web-silk.vercel.app/invitation/personal',
      );
      const credential = new URLSearchParams(link.hash.slice(1)).get('credential');
      expect(credential).toMatch(/^wgc_[A-Za-z0-9_-]{43}$/u);
      const exchange = await request(app)
        .post('/api/v1/guest/invitation-sessions')
        .send({ credential });
      expect(exchange.status).toBe(200);
      const view = await request(app)
        .get('/api/v1/guest/invitation')
        .set(
          'Authorization',
          `Bearer ${result(sessionSchema).parse(exchange.body).data.capability}`,
        );
      expect(view.status).toBe(200);
      expect(result(invitationViewSchema).parse(view.body).data.recipientGreeting).toBe(
        'Khách được mời',
      );
      expect(JSON.stringify(view.body)).not.toMatch(
        /private-note|84900000000|explicit@example|billing|ledger/u,
      );
      await foundation.recordOutcome(claim.id, claim.leaseId!, 'ACCEPTED', {
        providerMessageId: 'controlled-guest-ack',
      });
      await foundation.recordOutcome(claim.id, claim.leaseId!, 'DELIVERED', {
        providerMessageId: 'controlled-guest-ack',
      });
      clock = new Date(clock.getTime() + 60000);
      const retention = new NotificationRetention(foundation, identity);
      expect((await retention.run()).recipients).toBeGreaterThanOrEqual(1);
      const recipient = await db.prisma.notificationRecipient.findUniqueOrThrow({
        where: { id: claim.recipientId },
      });
      expect(recipient).toMatchObject({ enabled: false, deliveryEmail: null });
      const metadata = await db.prisma.notificationCredential.findUniqueOrThrow({
        where: { intentId: claim.id },
      });
      expect(metadata.ciphertext).toBeNull();
      expect(metadata.credentialId).toBe(issuedData.credentialId);
      const replay = await issue();
      expect(replay.body).toEqual(issued.body);
      expect(await db.prisma.notificationIntent.count({ where: { id: claim.id } })).toBe(1);
      const inboxIntent = await foundation.enqueue({
        eventId: randomUUID(),
        owner: 'booking-lifecycle',
        bookingId: f.bookingId,
        recipientId: (await consumer.coupleRecipient(f.couple.actorId, 'CONTRACT')).id,
        channel: 'IN_APP',
        purpose: 'CONTRACT',
        templateVersion: 1,
        scheduledAt: clock.toISOString(),
        data: {},
      });
      await db.prisma.notificationInbox.create({
        data: {
          intentId: inboxIntent.id,
          accountId: f.couple.actorId,
          bookingId: f.bookingId,
          createdAt: new Date(clock.getTime() - 91 * 86400000),
        },
      });
      expect((await retention.run()).inbox).toBe(1);
      expect(await db.prisma.notificationIntent.count({ where: { id: inboxIntent.id } })).toBe(1);
    }, 30000);
  },
);
