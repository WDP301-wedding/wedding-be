import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createGuestServices } from '../../src/modules/guest-management/infrastructure/guest.composition.js';
import { createPrismaClient } from '../../src/core/database/prisma.js';

const describeDb = catalogMigrationDatabaseUrl ? describe : describe.skip;
describeDb('GM retained migrations, credential expiry and import rollback', () => {
  const db = new CatalogTestDatabase('guest_security');
  let f: Awaited<ReturnType<typeof studioFixture>>;
  let s: ReturnType<typeof createGuestServices>;
  let now = new Date();
  beforeAll(async () => {
    // Populate an accepted SPEC-05 database before applying the new migration.
    await db.connect(async (migration, url) => {
      if (migration !== '20261012010000_guest_management') return;
      const prisma = createPrismaClient(url);
      try {
        f = await studioFixture(prisma);
      } finally {
        await prisma.$disconnect();
      }
    });
    now = new Date();
    s = createGuestServices(db.prisma, () => now);
  }, 60000);
  afterAll(() => db.disconnect());
  it('adds tables without rewriting existing Booking or auto-populating Guests', async () => {
    expect(
      (await db.prisma.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).planningHeadcount,
    ).toBe(20);
    expect(await db.prisma.guestWorkspace.count()).toBe(0);
    expect(await db.prisma.guest.count()).toBe(0);
    expect((await s.guests.plan(f.bookingId, f.couple)).planningHeadcount).toBe(20);
  });
  it('rejects expired/foreign previews and rolls every row/history/outbox back on a mid-import failure', async () => {
    const [group] = await s.guests.groups(f.bookingId, f.couple);
    const rows = [1, 2].map((i) => ({
      externalRowKey: `rollback-${i}`,
      name: 'An',
      guestGroupId: group!.guestGroupId,
    }));
    const preview = await s.guests.preview(f.bookingId, { rows }, randomUUID(), f.couple);
    const input = { previewId: preview.previewId, digest: preview.digest };
    await expect(
      s.guests.import(f.bookingId, input, randomUUID(), f.manager),
    ).rejects.toMatchObject({ status: 404 });
    const before = {
      guests: await db.prisma.guest.count(),
      history: await db.prisma.guestHistory.count(),
      outbox: await db.prisma.guestOutbox.count(),
      commands: await db.prisma.guestCommand.count(),
    };
    const original = s.repository.history.bind(s.repository);
    let calls = 0;
    const fault = vi.spyOn(s.repository, 'history').mockImplementation(async (...args) => {
      await original(...args);
      if (++calls === 2) throw Error('second row failure');
    });
    await expect(s.guests.import(f.bookingId, input, randomUUID(), f.couple)).rejects.toThrow(
      'second row failure',
    );
    fault.mockRestore();
    expect({
      guests: await db.prisma.guest.count(),
      history: await db.prisma.guestHistory.count(),
      outbox: await db.prisma.guestOutbox.count(),
      commands: await db.prisma.guestCommand.count(),
    }).toEqual(before);
    now = new Date(now.getTime() + 31 * 60000);
    await expect(s.guests.import(f.bookingId, input, randomUUID(), f.couple)).rejects.toMatchObject(
      { code: 'GUEST_IMPORT_PREVIEW_STALE' },
    );
    now = new Date();
  });
  it('keeps a completed event invitation valid until expiry, denies cancellation, and requires explicit delivery recipient', async () => {
    const [group] = await s.guests.groups(f.bookingId, f.couple);
    const guest = await s.guests.createGuest(
      f.bookingId,
      { name: 'An', guestGroupId: group!.guestGroupId },
      randomUUID(),
      f.couple,
    );
    await expect(
      s.readers.prepareDelivery(
        { bookingId: f.bookingId, guestId: guest.guestId, intendedEmail: 'an@example.test' },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 404 });
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
    const link = await s.links.issue(
      f.bookingId,
      guest.guestId,
      { expectedRevision: 0 },
      randomUUID(),
      f.couple,
    );
    const prepared = await s.readers.prepareDelivery(
      { bookingId: f.bookingId, guestId: guest.guestId, intendedEmail: 'an@example.test' },
      f.couple,
    );
    expect(prepared).toMatchObject({
      intendedEmail: 'an@example.test',
      credentialId: link.credentialId,
    });
    expect(JSON.stringify(prepared)).not.toContain(link.credential);
    await expect(
      s.readers.prepareDelivery(
        { bookingId: f.bookingId, guestId: guest.guestId, intendedEmail: '' },
        f.couple,
      ),
    ).rejects.toMatchObject({ status: 422 });
    const session = await s.links.exchange(link.credential, 'completed-event');
    await db.prisma.booking.update({ where: { id: f.bookingId }, data: { phase: 'COMPLETED' } });
    expect((await s.links.view(session.capability)).recipientGreeting).toBe('An');
    expect((await s.links.exchange(link.credential, 'completed-event')).capability).toMatch(
      /^wgs_/u,
    );
    now = new Date(now.getTime() + 16 * 60000);
    await expect(s.links.view(session.capability)).rejects.toMatchObject({
      code: 'INVITATION_LINK_UNAVAILABLE',
    });
    await db.prisma.booking.update({ where: { id: f.bookingId }, data: { phase: 'CANCELLED' } });
    await expect(s.links.exchange(link.credential, 'cancelled-event')).rejects.toMatchObject({
      code: 'INVITATION_LINK_UNAVAILABLE',
    });
    await db.prisma.booking.update({ where: { id: f.bookingId }, data: { phase: 'COMPLETED' } });
    now = new Date(link.expiresAt);
    await expect(s.links.exchange(link.credential, 'expired-event')).rejects.toMatchObject({
      code: 'INVITATION_LINK_UNAVAILABLE',
    });
    now = new Date();
    await expect(s.links.view('invalid')).rejects.toMatchObject({ status: 404 });
    await expect(s.links.view(`wgs_${'a'.repeat(43)}`)).rejects.toMatchObject({ status: 404 });
    await expect(s.links.exchange(`wgc_${'a'.repeat(43)}`, 'unknown')).rejects.toMatchObject({
      status: 404,
    });
  });
  it('persists the anonymous limit across instances, counts invalid tokens, and resets after the window', async () => {
    for (let i = 0; i < 10; i++)
      await expect(s.links.exchange('invalid', 'rate-window')).rejects.toMatchObject({
        status: 404,
      });
    const second = createGuestServices(db.prisma, () => now);
    await expect(second.links.exchange('invalid', 'rate-window')).rejects.toMatchObject({
      status: 429,
      headers: { 'Retry-After': '900' },
    });
    now = new Date(now.getTime() + 16 * 60000);
    await expect(second.links.exchange('invalid', 'rate-window')).rejects.toMatchObject({
      status: 404,
    });
    const stored = JSON.stringify(await db.prisma.guestExchangeLimit.findMany());
    expect(stored).not.toContain('rate-window');
    expect(stored).not.toContain('invalid');
  });
});
