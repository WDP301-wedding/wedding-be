import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import type { createInvitationStudioServices } from '../../src/modules/invitation-studio/infrastructure/studio.composition.js';
import type { createStaffSeatingServices } from '../../src/modules/staff-operations/infrastructure/staff-seating.composition.js';
import type { GuestRequestContext } from '../../src/modules/guest-management/application/guest.contracts.js';
import { finalInvoiceResponseSchema } from '../../src/modules/payments-billing/domain/final-invoice.js';
import { NotificationRepository } from '../../src/modules/notifications-automation/infrastructure/notification.repository.js';
import { NotificationEvents } from '../../src/modules/notifications-automation/application/notification-events.js';
import { NotificationDispatcher } from '../../src/modules/notifications-automation/application/notification-dispatcher.js';
import { NotificationCrypto } from '../../src/modules/notifications-automation/infrastructure/notification-crypto.js';
import { readNotificationOutbox } from '../../src/modules/notifications-automation/infrastructure/notification-outbox.reader.js';
import { unavailablePush } from '../../src/modules/notifications-automation/infrastructure/fcm-push.provider.js';
import type { SendEmailCommand } from '../../src/integrations/email/email-provider.js';
type Dependencies = {
  studio: ReturnType<typeof createInvitationStudioServices>;
  staffSeating: ReturnType<typeof createStaffSeatingServices>;
  context: (who: 'own' | 'manager') => GuestRequestContext;
};
export function registerGuestCompletionCases(
  h: StepSixApiHarness,
  getDependencies: () => Dependencies,
) {
  it('GM-W5 no names -> Group seating/PDF -> native event completion and zero-expense final invoice with real notification events', async () => {
    const { f, d } = await h.paidFixture(true),
      { studio, staffSeating, context } = getDependencies(),
      prisma = h.database.prisma,
      ctx = context('own'),
      guests = staffSeating.staff.guests;
    expect(await prisma.guest.count({ where: { bookingId: f.id } })).toBe(0);
    const before = await prisma.booking.findUniqueOrThrow({ where: { id: f.id } }),
      groups = await guests.guests.groups(f.id, ctx),
      options = await staffSeating.seating.seating.options(f.id, ctx),
      layout = options.items.find((i) => i.compatible)!;
    expect(layout).toBeDefined();
    const plan = await staffSeating.seating.seating.select(
      f.id,
      {
        layoutTemplateVersionId: layout.layoutTemplateVersionId,
        expectedBookingRevision: options.bookingRevision,
      },
      randomUUID(),
      ctx,
    );
    const revised = await staffSeating.seating.seating.revise(
      f.id,
      plan.seatingPlanId,
      {
        expectedRevision: 1,
        labels: [
          {
            layoutTableId: plan.renderSnapshot[0]!.layoutTableId,
            guestGroupId: groups[0]!.guestGroupId,
          },
        ],
      },
      randomUUID(),
      ctx,
    );
    const confirmed = await staffSeating.seating.seating.confirm(
      f.id,
      plan.seatingPlanId,
      {
        expectedRevision: revised.revisionNumber,
        expectedBookingRevision: options.bookingRevision,
      },
      randomUUID(),
      ctx,
    );
    expect(confirmed.status).toBe('CONFIRMED');
    const design = await studio.designs.create(
      {
        bookingId: f.id,
        content: {
          title: 'Thiệp cưới không có danh sách tên',
          textFields: { greeting: 'Trân trọng kính mời' },
          sections: [{ kind: 'SEATING', textKey: null, derivedAssetId: null }],
          derivedAssetIds: [],
          includesSeating: true,
        },
        idempotencyKey: randomUUID(),
      },
      ctx,
    );
    await studio.publication.publish(
      {
        bookingId: f.id,
        designId: design.designId,
        designRevisionId: design.revisionId,
        expectedRevision: 1,
        expectedPublicationRevision: 0,
        idempotencyKey: randomUUID(),
      },
      ctx,
    );
    const scope = {
      requestId: ctx.requestId,
      causationId: ctx.requestId,
      actorAccountId: ctx.actorId,
      authority: 'AUTHENTICATED' as const,
    };
    const printable = await studio.boundary.run({ bookingId: f.id, context: scope }, (scoped) =>
        studio.printable.capture({ bookingId: f.id, designRevisionId: design.revisionId }, scoped),
      ),
      file = await studio.printFiles.read(f.id, printable.printableRevisionId, ctx);
    expect(file.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(printable.content.seating?.seatingPlanRevisionId).toBe(confirmed.revisionId);
    expect(printable.content.genericQrPayload).toMatch(/^https:/u);
    expect(await staffSeating.staff.readers.getBookingAttendance(f.id)).toMatchObject({
      measurementStatus: 'NOT_RECORDED',
      checkedInGuestCount: null,
    });
    const completion = await h.post(`/management/bookings/${f.id}/completion`, {
      expectedRevision: (await prisma.booking.findUniqueOrThrow({ where: { id: f.id } })).revision,
    });
    expect(completion.status, JSON.stringify(completion.body)).toBe(200);
    const invoiceResponse = await h.post(`/management/bookings/${f.id}/final-invoices`, {
      expectedDraftRevision: 0,
      expectedCommercialRevisionId: d.contract.revisionId,
      expectedBillingRevision: 2,
    });
    expect(invoiceResponse.status, JSON.stringify(invoiceResponse.body)).toBe(201);
    const invoice = finalInvoiceResponseSchema.parse(invoiceResponse.body as unknown).data;
    expect(invoice.document.totalVnd).toBe(h.total);
    expect(invoice.document.incidentalTotalVnd).toBe(0);
    expect(await prisma.guest.count({ where: { bookingId: f.id } })).toBe(0);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { id: f.id } })).planningHeadcount,
    ).toBe(before.planningHeadcount);
    const repository = new NotificationRepository(prisma, () => new Date(), [f.id]),
      events = new NotificationEvents(repository),
      outbox = await readNotificationOutbox(repository);
    expect(outbox.some((e) => e.eventType === 'identity.consultation-access-promoted')).toBe(true);
    expect(outbox.some((e) => e.eventType === 'billing.final-invoice-issued')).toBe(true);
    for (const event of outbox) await events.consume(event);
    const send = (command: SendEmailCommand) =>
      Promise.resolve({ idempotencyKey: command.idempotencyKey, messageId: randomUUID() });
    await new NotificationDispatcher(
      repository,
      new NotificationCrypto('v1', new Map([['v1', randomBytes(32)]])),
      { send },
      unavailablePush,
      guests.readers,
    ).run();
    expect(
      await prisma.notificationIntent.count({ where: { bookingId: f.id, state: 'DELIVERED' } }),
    ).toBeGreaterThan(0);
    expect(
      (
        await prisma.commercialContractRevision.findUniqueOrThrow({
          where: { id: d.contract.revisionId },
        })
      ).documentDigest,
    ).toBe(d.contract.documentDigest);
  }, 30000);
  it('GM-W5 import/archive preserves planning, explicit count invalidates real Seating/print and old file history stays immutable', async () => {
    const { f } = await h.paidFixture(),
      { studio, staffSeating, context } = getDependencies(),
      ctx = context('own'),
      guests = staffSeating.staff.guests,
      prisma = h.database.prisma,
      groups = await guests.guests.groups(f.id, ctx),
      before = await guests.guests.plan(f.id, ctx),
      options = await staffSeating.seating.seating.options(f.id, ctx),
      layout = options.items.find((i) => i.compatible)!;
    const plan = await staffSeating.seating.seating.select(
      f.id,
      {
        layoutTemplateVersionId: layout.layoutTemplateVersionId,
        expectedBookingRevision: options.bookingRevision,
      },
      randomUUID(),
      ctx,
    );
    await staffSeating.seating.seating.confirm(
      f.id,
      plan.seatingPlanId,
      { expectedRevision: 1, expectedBookingRevision: options.bookingRevision },
      randomUUID(),
      ctx,
    );
    const design = await studio.designs.create(
      {
        bookingId: f.id,
        content: {
          title: 'Thiệp có sơ đồ nhóm',
          textFields: { greeting: 'Trân trọng kính mời' },
          sections: [{ kind: 'SEATING', textKey: null, derivedAssetId: null }],
          derivedAssetIds: [],
          includesSeating: true,
        },
        idempotencyKey: randomUUID(),
      },
      ctx,
    );
    await studio.publication.publish(
      {
        bookingId: f.id,
        designId: design.designId,
        designRevisionId: design.revisionId,
        expectedRevision: 1,
        expectedPublicationRevision: 0,
        idempotencyKey: randomUUID(),
      },
      ctx,
    );
    const scope = {
        requestId: ctx.requestId,
        causationId: ctx.requestId,
        actorAccountId: ctx.actorId,
        authority: 'AUTHENTICATED' as const,
      },
      capture = () =>
        studio.boundary.run({ bookingId: f.id, context: scope }, (scoped) =>
          studio.printable.capture(
            { bookingId: f.id, designRevisionId: design.revisionId },
            scoped,
          ),
        ),
      printed = await capture(),
      file = await studio.printFiles.read(f.id, printed.printableRevisionId, ctx);
    const preview = await guests.guests.preview(
      f.id,
      {
        rows: [
          {
            externalRowKey: 'gmw5-person',
            name: 'Nguyễn An',
            guestGroupId: groups[0]!.guestGroupId,
          },
        ],
      },
      randomUUID(),
      ctx,
    );
    await guests.guests.import(
      f.id,
      { previewId: preview.previewId, digest: preview.digest },
      randomUUID(),
      ctx,
    );
    const person = await prisma.guest.findFirstOrThrow({ where: { bookingId: f.id } });
    await guests.guests.updateGuest(
      f.id,
      person.id,
      { expectedRevision: person.revision, status: 'ARCHIVED' },
      randomUUID(),
      ctx,
    );
    expect((await guests.guests.plan(f.id, ctx)).planningHeadcount).toBe(before.planningHeadcount);
    await guests.guests.updatePlan(
      f.id,
      { expectedRevision: before.revision, planningHeadcount: before.planningHeadcount + 1 },
      randomUUID(),
      ctx,
    );
    await expect(capture()).rejects.toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
    expect((await staffSeating.seating.seating.read(f.id, plan.seatingPlanId, ctx)).status).toBe(
      'REQUIRES_REVIEW',
    );
    expect((await studio.printFiles.read(f.id, printed.printableRevisionId, ctx)).sha256).toBe(
      file.sha256,
    );
    expect(
      await prisma.billingLedgerEntry.count({
        where: { bookingId: f.id, sourceType: 'PRINT_ORDER' },
      }),
    ).toBe(0);
  }, 30000);
}
