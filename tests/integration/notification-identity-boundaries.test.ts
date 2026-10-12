import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createNotificationIdentityReader } from '../../src/modules/identity-access/authorization/notification-recipient.reader.js';
import { createNotificationBookingReader } from '../../src/modules/booking-lifecycle/infrastructure/notification-context.reader.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'SPEC-09 destination expiry and audience revocation',
  () => {
    const db = new CatalogTestDatabase('notification_identity_boundaries');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    it.each(['idleExpiresAt', 'absoluteExpiresAt'] as const)(
      'rejects an Android destination exactly at %s while preserving other active sessions',
      async (field) => {
        const f = await studioFixture(db.prisma);
        let clock = f.now;
        const identity = createNotificationIdentityReader(db.prisma, () => clock);
        const other = await f.actor('COUPLE', 'ANDROID', f.couple.actorId);
        const session = await db.prisma.session.findUniqueOrThrow({
          where: { id: f.android.sessionId },
        });
        const boundary = new Date(
          session.absoluteExpiresAt.getTime() - (field === 'idleExpiresAt' ? 1000 : 0),
        );
        await db.prisma.session.update({
          where: { id: f.android.sessionId },
          data: {
            idleExpiresAt: boundary,
          },
        });
        await db.prisma.session.update({
          where: { id: other.sessionId },
          data: {
            idleExpiresAt: new Date(boundary.getTime() + 86400000),
            absoluteExpiresAt: new Date(boundary.getTime() + 86400000),
          },
        });
        clock = new Date(boundary.getTime() - 1);
        expect(await identity.androidSession(f.couple.actorId, f.android.sessionId)).toBe(true);
        clock = boundary;
        expect(await identity.androidSession(f.couple.actorId, f.android.sessionId)).toBe(false);
        expect(await identity.androidSession(f.couple.actorId, other.sessionId)).toBe(true);
      },
    );
    it('rechecks account suspension and exposes only minimal current contact and roles', async () => {
      const f = await studioFixture(db.prisma);
      const identity = createNotificationIdentityReader(db.prisma, () => f.now);
      const account = await db.prisma.account.findUniqueOrThrow({
        where: { id: f.couple.actorId },
      });
      expect(await identity.account(f.couple.actorId)).toEqual({
        accountId: account.id,
        email: account.displayEmail,
        roles: ['COUPLE'],
      });
      await db.prisma.account.update({ where: { id: account.id }, data: { status: 'SUSPENDED' } });
      expect(await identity.account(account.id)).toBeNull();
      expect(await identity.androidSession(account.id, f.android.sessionId)).toBe(false);
      await db.prisma.account.update({ where: { id: account.id }, data: { status: 'ACTIVE' } });
      expect(await identity.androidSession(account.id, f.android.sessionId)).toBe(true);
      await expect(identity.account('invalid-account-id')).rejects.toThrow();
      await expect(identity.androidSession(account.id, 'invalid-session-id')).rejects.toThrow();
    });
    it('revokes Couple audience access independently of the assigned Manager and represents absent effective schedules as unknown', async () => {
      const f = await studioFixture(db.prisma),
        reader = createNotificationBookingReader(db.prisma);
      expect(await reader.notificationBookingIds(f.couple.actorId, false)).toContain(f.bookingId);
      await db.prisma.consultationAccess.deleteMany({
        where: { consultationId: f.consultationId, accountId: f.couple.actorId },
      });
      expect(await reader.notificationBookingIds(f.couple.actorId, false)).not.toContain(
        f.bookingId,
      );
      expect(await reader.notificationBookingIds(f.manager.actorId, true)).toContain(f.bookingId);
      expect(await reader.notificationBookingIds(f.manager.actorId, false)).not.toContain(
        f.bookingId,
      );
      await db.prisma.booking.update({
        where: { id: f.bookingId },
        data: { effectiveTimelineRevisionId: null },
      });
      expect(await reader.read(f.bookingId)).toMatchObject({ scheduleRevision: null, couples: [] });
      expect(await reader.fromConsultation(randomUUID())).toBeNull();
    });
  },
);
