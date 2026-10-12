import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogTestDatabase,
  catalogMigrationDatabaseUrl,
} from './venue-catalog/catalog-test-database.js';
import { studioFixture } from './invitation-studio/studio-fixture.js';
import { createSeatingServices } from '../../src/modules/seating-plan/infrastructure/seating.composition.js';

(catalogMigrationDatabaseUrl ? describe : describe.skip)(
  'RV-19 files from real accepted Seating owner',
  () => {
    const db = new CatalogTestDatabase('seating_print');
    beforeAll(() => db.connect(), 60000);
    afterAll(() => db.disconnect());
    async function fixture() {
      const f = await studioFixture(db.prisma),
        s = createSeatingServices(db.prisma, f.services);
      await s.guests.guests.groups(f.bookingId, f.couple);
      const group = await s.guests.guests.createGroup(
        f.bookingId,
        { name: 'Gia đình cô dâu', color: '#059669' },
        randomUUID(),
        f.couple,
      );
      const plan = await s.seating.select(
        f.bookingId,
        { layoutTemplateVersionId: f.layoutId, expectedBookingRevision: 1 },
        randomUUID(),
        f.couple,
      );
      await s.seating.revise(
        f.bookingId,
        plan.seatingPlanId,
        {
          expectedRevision: 1,
          labels: [
            {
              layoutTableId: plan.renderSnapshot[0]!.layoutTableId,
              guestGroupId: group.guestGroupId,
            },
          ],
        },
        randomUUID(),
        f.couple,
      );
      const confirmed = await s.seating.confirm(
        f.bookingId,
        plan.seatingPlanId,
        { expectedRevision: 2, expectedBookingRevision: 1 },
        randomUUID(),
        f.couple,
      );
      const design = await f.services.designs.create(
        {
          bookingId: f.bookingId,
          content: {
            ...f.content,
            title: 'Thiệp cưới - Ngọc Ánh và Đức Minh',
            textFields: {
              brideName: 'Ngọc Ánh',
              groomName: 'Đức Minh',
              greeting: 'Trân trọng kính mời',
            },
            sections: [{ kind: 'SEATING', textKey: null, derivedAssetId: null }],
            includesSeating: true,
          },
          idempotencyKey: randomUUID(),
        },
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
      const capture = () =>
        f.services.boundary.run({ bookingId: f.bookingId, context: f.contract }, (scope) =>
          f.services.printable.capture(
            { bookingId: f.bookingId, designRevisionId: design.revisionId },
            scope,
          ),
        );
      return { f, s, group, confirmed, design, capture, plan };
    }
    it('generates retained fixed geometry/Group/glyph/QR bytes without names or check-in and never reprices', async () => {
      const { f, s, capture, confirmed, plan } = await fixture(),
        printed = await capture();
      expect(printed.content.seating?.seatingPlanRevisionId).toBe(confirmed.revisionId);
      const file = await f.services.printFiles.read(
        f.bookingId,
        printed.printableRevisionId,
        f.couple,
      );
      expect(file.bytes.toString('latin1').match(/\/Type \/Page\b/gu)).toHaveLength(2);
      await mkdir('.local-demo/sea/pdf', { recursive: true });
      await writeFile('.local-demo/sea/pdf/seating-accepted.pdf', file.bytes);
      await writeFile(
        '.local-demo/sea/pdf/seating-accepted.json',
        JSON.stringify(
          {
            pdfSha256: file.sha256,
            contentDigest: file.contentDigest,
            seating: printed.content.seating,
            qrPayload: printed.content.genericQrPayload,
          },
          null,
          2,
        ),
      );
      await s.guests.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 1, planningHeadcount: 35 },
        randomUUID(),
        f.couple,
      );
      await expect(capture()).rejects.toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
      await s.seating.read(f.bookingId, plan.seatingPlanId, f.couple);
      const history = await f.services.printFiles.read(
        f.bookingId,
        printed.printableRevisionId,
        f.manager,
      );
      expect(history.sha256).toBe(file.sha256);
      expect(history.bytes.equals(file.bytes)).toBe(true);
      expect(await db.prisma.guest.count({ where: { bookingId: f.bookingId } })).toBe(0);
      expect(
        await db.prisma.billingLedgerEntry.count({
          where: { bookingId: f.bookingId, sourceType: 'PRINT_ORDER' },
        }),
      ).toBe(0);
    }, 30000);
    it('serializes capture/headcount races and blocks stale print before notification delivery', async () => {
      const { f, s, capture } = await fixture();
      const [printing, change] = await Promise.allSettled([
        capture(),
        s.guests.guests.updatePlan(
          f.bookingId,
          { expectedRevision: 1, planningHeadcount: 35 },
          randomUUID(),
          f.couple,
        ),
      ]);
      expect(change.status).toBe('fulfilled');
      if (printing.status === 'fulfilled') expect(printing.value.content.seating).not.toBeNull();
      else expect(printing.reason).toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
      await expect(capture()).rejects.toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
    });
    it('approves a real print order with Seating once and rolls back stale approval without a charge', async () => {
      const { f, s, design } = await fixture();
      async function quotation() {
        const requested = await f.services.printOrders.requestPrintOrder(
          f.bookingId,
          { lines: [{ designId: design.designId, quantity: 10 }] },
          randomUUID(),
          f.couple,
        );
        return f.services.printOrders.quotePrintOrder(
          requested.orderId,
          {
            expectedRevision: requested.revision,
            lines: [{ lineId: requested.lines[0]!.lineId, unitPriceVnd: 10000 }],
            estimatedHandoverAt: new Date(f.now.getTime() + 86400000).toISOString(),
          },
          randomUUID(),
          f.manager,
        );
      }
      const quote = await quotation(),
        key = randomUUID();
      const input = {
        expectedRevision: quote.revision,
        commercialRevisionId: quote.currentCommercialRevision!.commercialRevisionId,
      };
      const approved = await f.services.printOrders.approvePrintOrder(
        f.bookingId,
        quote.orderId,
        input,
        key,
        f.couple,
      );
      expect(
        await f.services.printOrders.approvePrintOrder(
          f.bookingId,
          quote.orderId,
          input,
          key,
          f.couple,
        ),
      ).toEqual(approved);
      expect(approved.lines[0]!.printableRevisionId).toBeTypeOf('string');
      const file = await f.services.printFiles.read(
        f.bookingId,
        approved.lines[0]!.printableRevisionId!,
        f.couple,
      );
      expect(file.rendererVersion).toBe('invitation-a5-v2-seating');
      const pending = await quotation();
      await s.guests.guests.updatePlan(
        f.bookingId,
        { expectedRevision: 1, planningHeadcount: 35 },
        randomUUID(),
        f.couple,
      );
      await expect(
        f.services.printOrders.approvePrintOrder(
          f.bookingId,
          pending.orderId,
          {
            expectedRevision: pending.revision,
            commercialRevisionId: pending.currentCommercialRevision!.commercialRevisionId,
          },
          randomUUID(),
          f.couple,
        ),
      ).rejects.toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
      expect(
        await db.prisma.invitationPrintOrder.findUnique({ where: { id: pending.orderId } }),
      ).toMatchObject({ status: 'QUOTED', receivableChargeId: null });
      expect(
        await db.prisma.billingLedgerEntry.count({
          where: { bookingId: f.bookingId, sourceType: 'PRINT_ORDER' },
        }),
      ).toBe(1);
      expect(
        (
          await f.services.printFiles.read(
            f.bookingId,
            approved.lines[0]!.printableRevisionId!,
            f.manager,
          )
        ).sha256,
      ).toBe(file.sha256);
    }, 30000);
    it('serializes real Venue retirement with Seating print capture', async () => {
      const { f, capture } = await fixture();
      const head = await db.prisma.layoutTemplate.findUniqueOrThrow({
        where: { id: f.templateId },
      });
      const [printed, retired] = await Promise.allSettled([
        capture(),
        f.layout.changeLifecycle({
          aggregateId: f.templateId,
          expectedRevision: head.revision,
          transition: 'RETIRE',
          context: f.ownerContext,
        }),
      ]);
      expect(retired.status).toBe('fulfilled');
      if (printed.status === 'fulfilled') expect(printed.value.content.seating).not.toBeNull();
      else expect(printed.reason).toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
      await expect(capture()).rejects.toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
    });
    it('blocks retired layouts at the print boundary while preserving old file bytes', async () => {
      const { f, capture } = await fixture(),
        printed = await capture();
      const old = await f.services.printFiles.read(
        f.bookingId,
        printed.printableRevisionId,
        f.couple,
      );
      const head = await db.prisma.layoutTemplate.findUniqueOrThrow({
        where: { id: f.templateId },
      });
      await f.layout.changeLifecycle({
        aggregateId: f.templateId,
        expectedRevision: head.revision,
        transition: 'RETIRE',
        context: f.ownerContext,
      });
      await expect(capture()).rejects.toMatchObject({ code: 'PRINTABLE_SEATING_REQUIRES_REVIEW' });
      expect(
        (await f.services.printFiles.read(f.bookingId, printed.printableRevisionId, f.couple))
          .sha256,
      ).toBe(old.sha256);
    });
  },
);
