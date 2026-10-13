import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { ensureDemoSeed, type DemoSeedPort } from '../../src/modules/release-demo/demo-seed.js';
import { createStaffSeatingServices } from '../../src/modules/staff-operations/infrastructure/staff-seating.composition.js';
import type { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import type { GuestRequestContext } from '../../src/modules/guest-management/application/guest.contracts.js';
import { billingResponseSchema } from '../../src/modules/payments-billing/http/payments-billing.schemas.js';
import { finalInvoiceResponseSchema } from '../../src/modules/payments-billing/domain/final-invoice.js';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
type Dependencies = {
  studio: ReturnType<typeof createInvitationStudioServices>;
  context: (who: 'own' | 'manager' | 'staff') => GuestRequestContext;
};

export function registerReleaseDemoCases(h: StepSixApiHarness, dependencies: () => Dependencies) {
  it('REL-W2 stable seeds use native owner commands, replay and refuse Manager edits', async () => {
    const target = {
      environment: 'test',
      databaseUrl: `postgresql://unused@127.0.0.1/${h.database.databaseName}`,
    };
    for (const scenario of ['no-names', 'partial-names']) {
      const facts = {
        scenario,
        displayName: `Release ${scenario}`,
        brideName: 'Cô dâu thử',
        groomName: 'Chú rể thử',
        revision: 1,
      };
      const port: DemoSeedPort<typeof facts> = {
        read: async (key) => {
          const rows = await h.database.prisma.consultation.findMany({
            where: { note: `REL-SEED:${key}`, managerAccountId: h.accounts.manager! },
          });
          if (rows.length > 1) throw Error('DEMO_SEED_CONFLICT');
          const row = rows[0];
          return row
            ? {
                scenario,
                displayName: row.displayName,
                brideName: row.brideName!,
                groomName: row.groomName!,
                revision: row.revision,
              }
            : null;
        },
        create: async (input, key) => {
          const response = await h.post(
            '/management/consultations',
            {
              intendedEmail: 'release-fixture@example.test',
              displayName: input.displayName,
              brideName: input.brideName,
              groomName: input.groomName,
              note: `REL-SEED:${key}`,
            },
            'manager',
            key,
          );
          expect(response.status).toBe(201);
        },
      };
      expect(await ensureDemoSeed(target, facts, port)).toBe('CREATED');
      expect(await ensureDemoSeed(target, facts, port)).toBe('VERIFIED_EXISTING');
      const consultation = await h.database.prisma.consultation.findFirstOrThrow({
        where: { displayName: facts.displayName },
      });
      const edited = await h.expenseMutation(
        'patch',
        `/consultations/${consultation.id}/couple-profile`,
        { expectedRevision: 1, brideName: 'Manager đã chỉnh sửa' },
      );
      expect(edited.status).toBe(200);
      await expect(ensureDemoSeed(target, facts, port)).rejects.toThrow('DEMO_SEED_CONFLICT');
      expect(
        (await h.database.prisma.consultation.findUniqueOrThrow({ where: { id: consultation.id } }))
          .brideName,
      ).toBe('Manager đã chỉnh sửa');
    }
  }, 30000);

  it('REL-W2 partial names preserve planning/money through explicit assigned Staff check-in, undo and final invoice', async () => {
    const { f, d } = await h.paidFixture(true),
      prisma = h.database.prisma;
    const { studio, context } = dependencies(),
      couple = context('own'),
      manager = context('manager');
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: f.id },
      include: { proposalSnapshot: true },
    });
    const eventClock = new Date(
      `${booking.eventDate.toISOString().slice(0, 10)}T${booking.proposalSnapshot!.shiftStartTime.toISOString().slice(11, 16)}:00+07:00`,
    );
    const s = createStaffSeatingServices(prisma, studio, () => eventClock).staff;
    const before = billingResponseSchema.parse(
      (await h.get(`/bookings/${f.id}/billing`, 'own')).body as unknown,
    ).data;
    const [group] = await s.guests.guests.groups(f.id, couple);
    const people = [];
    for (const index of [1, 2]) {
      const key = randomUUID(),
        body = { guestGroupId: group!.guestGroupId, name: 'Khách trùng tên' };
      const person = await s.guests.guests.createGuest(f.id, body, key, couple);
      expect(await s.guests.guests.createGuest(f.id, body, key, couple)).toEqual(person);
      people.push({ ...person, index });
    }
    expect(people[0]!.guestId).not.toBe(people[1]!.guestId);
    expect(await s.readers.getBookingAttendance(f.id)).toMatchObject({
      checkedInGuestCount: null,
      measurementStatus: 'NOT_RECORDED',
    });
    await s.staff.assign(
      f.id,
      { staffAccountId: h.accounts.staff!, expectedRevision: 0 },
      randomUUID(),
      manager,
    );
    await s.staff.configure(
      f.id,
      { checkInMode: 'BY_GUEST_NAME', expectedRevision: 1 },
      randomUUID(),
      couple,
    );
    const staff = context('staff'),
      key = randomUUID(),
      guestId = people[0]!.guestId;
    const record = await s.journal.checkIn(f.id, guestId, {}, key, staff);
    expect(await s.journal.checkIn(f.id, guestId, {}, key, staff)).toEqual(record);
    expect(await s.readers.getBookingAttendance(f.id)).toMatchObject({
      checkedInGuestCount: 1,
      measurementStatus: 'LISTED_GUESTS_ONLY',
    });
    await s.journal.undo(
      f.id,
      guestId,
      {
        checkInRecordId: record.checkInRecordId,
        expectedLedgerRevision: record.ledgerRevision,
        reason: 'Sửa check-in trong kiểm thử',
      },
      randomUUID(),
      staff,
    );
    expect(await s.readers.getBookingAttendance(f.id)).toMatchObject({
      checkedInGuestCount: 0,
      ledgerRevision: 2,
    });
    await s.guests.guests.updateGuest(
      f.id,
      people[1]!.guestId,
      { expectedRevision: people[1]!.revision, status: 'ARCHIVED' },
      randomUUID(),
      couple,
    );
    expect((await s.guests.guests.plan(f.id, couple)).planningHeadcount).toBe(
      booking.planningHeadcount,
    );
    expect(
      billingResponseSchema.parse((await h.get(`/bookings/${f.id}/billing`, 'own')).body as unknown)
        .data.totals,
    ).toEqual(before.totals);
    const response = await h.post(`/management/bookings/${f.id}/final-invoices`, {
      expectedDraftRevision: 0,
      expectedCommercialRevisionId: d.contract.revisionId,
      expectedBillingRevision: before.billingRevision,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const invoice = finalInvoiceResponseSchema.parse(response.body as unknown).data;
    expect(invoice.document.totalVnd).toBe(h.total);
    expect(invoice.document.incidentalTotalVnd).toBe(0);
    expect(await prisma.staffCheckInRecord.count({ where: { bookingId: f.id } })).toBe(2);
  }, 30000);
}
