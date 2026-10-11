import { createHash, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { StepSixApiHarness } from './commercial-step6-api-cases.js';
import {
  contractResponseSchema,
  contractsResponseSchema,
} from '../../src/modules/booking-lifecycle/domain/commercial-contract.js';
import {
  consultationResponseSchema,
  bookingResponseSchema,
} from '../../src/modules/booking-lifecycle/http/booking-lifecycle.schemas.js';
import {
  attemptResponseSchema,
  checkoutResponseSchema,
} from '../../src/modules/payments-billing/http/payments-billing.schemas.js';
import { ipnFixture } from './payments-billing/vnpay-fixture.js';
import { CATALOG_SEED_IDS } from '../../scripts/catalog-seed.js';
import { serviceViewSchema } from '../../src/modules/venue-catalog/domain/commercial-offering.js';

// All SQL fault/expiry fixtures below run only in the harness's disposable loopback DB.
export function registerCommercialAcceptanceCases(h: StepSixApiHarness) {
  const { database, fixture, approved, post, get, race, deposit, total, accounts } = h;
  it('rejects a stale catalog draft and preserves approved prices, approvals and PDF against catalog/SQL edits', async () => {
    const f = await fixture();
    const fields = {
      name: 'MC giá kiểm thử',
      description: '',
      unit: 'buổi',
      unitPriceVnd: 2_500_001,
      active: true,
    };
    const created = await post('/management/services', fields);
    expect(created.status).toBe(201);
    const service = serviceViewSchema.parse((created.body as { data: unknown }).data);
    const selections = h.getLines().map((line) =>
      line.category === 'SERVICE'
        ? {
            ...line,
            sourceId: service.serviceId,
            sourceRevisionId: service.sourceRevisionId,
          }
        : line,
    );
    const draft = await post(
      f.path,
      {
        expectedRevision: f.revision,
        predecessorRevisionId: null,
        timelineRevisionId: f.timelineId,
        lines: selections,
      },
      'own',
    );
    expect(draft.status).toBe(201);
    const old = contractResponseSchema.parse(draft.body as unknown).data;
    const revised = await h.expenseMutation('patch', `/management/services/${service.serviceId}`, {
      ...fields,
      expectedRevision: service.revision,
      unitPriceVnd: 2_500_003,
    });
    expect(revised.status).toBe(200);
    const next = serviceViewSchema.parse((revised.body as { data: unknown }).data);
    const submit = await post(
      `${f.path}/${old.contract.revisionId}/submissions`,
      { expectedRevision: old.bookingRevision },
      'own',
    );
    expect(submit.status).toBe(409);
    expect(submit.body).toMatchObject({ error: { code: 'COMMERCIAL_PRICE_REVISION_STALE' } });
    const replacement = await post(
      f.path,
      {
        expectedRevision: old.bookingRevision,
        predecessorRevisionId: old.contract.revisionId,
        timelineRevisionId: f.timelineId,
        lines: selections.map((line) =>
          line.category === 'SERVICE' ? { ...line, sourceRevisionId: next.sourceRevisionId } : line,
        ),
      },
      'own',
    );
    expect(replacement.status).toBe(201);
    const d = await approved(f, contractResponseSchema.parse(replacement.body as unknown).data);
    expect(d.contract.document.contractTotalVnd).toBe(total + 3);
    expect(d.contract.document.depositAmountVnd).toBe(deposit + 1);
    const pdfPath = `${f.path}/${d.contract.revisionId}/pdf`;
    const beforePdf = await get(pdfPath, 'own');
    expect(beforePdf.status).toBe(200);
    const archive = await h.expenseMutation('patch', `/management/services/${next.serviceId}`, {
      ...fields,
      expectedRevision: next.revision,
      unitPriceVnd: 9_000_000,
      active: false,
    });
    expect(archive.status).toBe(200);
    const state = contractsResponseSchema.parse((await get(f.path, 'own')).body as unknown).data;
    expect(state.eligibleForDeposit).toBe(true);
    expect(state.revisions.find((r) => r.revisionId === d.contract.revisionId)).toEqual(d.contract);
    await expect(
      database.prisma.commercialContractRevision.update({
        where: { id: d.contract.revisionId },
        data: { contractTotalVnd: 1 },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.commercialContractLine.updateMany({
        where: { revisionId: d.contract.revisionId },
        data: { name: 'Tên dịch vụ bị sửa trái phép' },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.commercialContractApproval.deleteMany({
        where: { revisionId: d.contract.revisionId },
      }),
    ).rejects.toThrow();
    await expect(
      database.prisma.commercialContractPdf.update({
        where: { revisionId: d.contract.revisionId },
        data: {
          bytes: Buffer.from('tampered'),
          sha256: createHash('sha256').update('tampered').digest('hex'),
        },
      }),
    ).rejects.toThrow();
    const afterPdf = await get(pdfPath, 'own');
    expect(afterPdf.status).toBe(200);
    expect(afterPdf.body).toEqual(beforePdf.body);
    expect(afterPdf.headers['x-content-sha256']).toBe(beforePdf.headers['x-content-sha256']);
    expect(
      await database.prisma.commercialContractApproval.count({
        where: { revisionId: d.contract.revisionId },
      }),
    ).toBe(2);
  }, 30_000);
  it('serializes full-contract checkout against withdrawal without accepting both', async () => {
    const f = await fixture(),
      d = await approved(f);
    const results = await race(f, [
      () =>
        post(
          `/bookings/${f.id}/payments/deposit`,
          {
            timelineRevisionId: f.timelineId,
            contractRevisionId: d.contract.revisionId,
            documentDigest: d.contract.documentDigest,
          },
          'own',
        ),
      () =>
        post(
          `${f.path}/${d.contract.revisionId}/withdrawals`,
          {
            expectedRevision: d.bookingRevision,
            reason: 'Rút trong cuộc đua cọc',
          },
          'own',
        ),
    ]);
    expect(results.filter((r) => r.status < 300)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const attempts = await database.prisma.billingPaymentAttempt.count({
      where: { bookingId: f.id },
    });
    const state = contractsResponseSchema.parse((await get(f.path, 'own')).body as unknown).data;
    expect(attempts).toBe(results[0]!.status === 201 ? 1 : 0);
    expect(state.revisions.find((r) => r.revisionId === d.contract.revisionId)?.state).toBe(
      attempts ? 'APPROVED' : 'SUPERSEDED',
    );
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(0);
  }, 30_000);

  it('serializes full-contract checkout against an invalidating timeline successor', async () => {
    const f = await fixture(),
      d = await approved(f);
    const results = await race(f, [
      () =>
        post(
          `/bookings/${f.id}/payments/deposit`,
          {
            timelineRevisionId: f.timelineId,
            contractRevisionId: d.contract.revisionId,
            documentDigest: d.contract.documentDigest,
          },
          'own',
        ),
      () =>
        post(
          `/bookings/${f.id}/timeline-revisions`,
          {
            expectedRevision: d.bookingRevision,
            predecessorRevisionId: f.timelineId,
            items: [{ order: 0, startTime: '18:30', title: 'Giờ mới' }],
          },
          'own',
        ),
    ]);
    expect(results.filter((r) => r.status < 300)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const current = await database.prisma.booking.findUniqueOrThrow({ where: { id: f.id } });
    expect(current.currentTimelineRevisionId === f.timelineId).toBe(results[0]!.status === 201);
    if (results[1]!.status === 201) {
      expect(
        contractsResponseSchema.parse((await get(f.path, 'own')).body as unknown).data
          .eligibleForDeposit,
      ).toBe(false);
    }
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(0);
  }, 30_000);

  it('pins an expired hall hold for UNKNOWN full-contract money, then releases edits only after verified failure', async () => {
    const f = await fixture(),
      d = await approved(f);
    const checkout = await post(
      `/bookings/${f.id}/payments/deposit`,
      {
        timelineRevisionId: f.timelineId,
        contractRevisionId: d.contract.revisionId,
        documentDigest: d.contract.documentDigest,
      },
      'own',
    );
    expect(checkout.status).toBe(201);
    const attemptId = checkoutResponseSchema.parse(checkout.body as unknown).data.paymentAttemptId;
    const statusPath = `/bookings/${f.id}/payments/${attemptId}`;
    expect(
      attemptResponseSchema.parse((await get(statusPath, 'own')).body as unknown).data.status,
    ).toBe('UNKNOWN');
    await database.prisma.bookingSlotHold.updateMany({
      where: { bookingId: f.id, status: 'ACTIVE' },
      data: { createdAt: new Date('2020-01-01'), expiresAt: new Date('2020-01-02') },
    });
    const original = await database.prisma.booking.findUniqueOrThrow({ where: { id: f.id } });
    const consultation = await post('/management/consultations', {
      displayName: 'Đối thủ cùng sảnh',
      intendedEmail: `${randomUUID()}@example.com`,
    });
    expect(consultation.status).toBe(201);
    const c = consultationResponseSchema.parse(consultation.body as unknown).data;
    const competitor = await post('/bookings', {
      consultationId: c.consultationId,
      hallId: original.hallId,
      eventDate: original.eventDate.toISOString().slice(0, 10),
      shiftCode: original.shiftCode,
      menuPackageVersionId: CATALOG_SEED_IDS.classicMenuVersion,
      tableCount: 10,
      planningHeadcount: 100,
      expectedRevision: c.revision,
    });
    expect(competitor.status).toBe(201);
    const other = bookingResponseSchema.parse(competitor.body as unknown).data;
    const hold = await post(`/bookings/${other.bookingId}/slot-holds`, {
      expectedRevision: other.revision,
    });
    expect(hold.status, JSON.stringify(hold.body)).toBe(409);
    const current = contractsResponseSchema.parse((await get(f.path, 'own')).body as unknown).data;
    const withdraw = () =>
      post(
        `${f.path}/${d.contract.revisionId}/withdrawals`,
        {
          expectedRevision: current.bookingRevision,
          reason: 'Đã đối soát thất bại',
        },
        'own',
      );
    expect((await withdraw()).status).toBe(409);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(0);
    const failure = ipnFixture(attemptId, {
      vnp_Amount: String(deposit * 100),
      vnp_ResponseCode: '24',
      vnp_TransactionStatus: '02',
    });
    expect((await get('/billing/callbacks/vnpay?' + failure, 'anonymous')).body).toMatchObject({
      RspCode: '00',
    });
    expect(
      (await database.prisma.bookingDepositIntent.findUniqueOrThrow({ where: { id: attemptId } }))
        .status,
    ).toBe('RELEASED');
    const after = contractsResponseSchema.parse((await get(f.path, 'own')).body as unknown).data;
    expect(
      (
        await post(
          `${f.path}/${d.contract.revisionId}/withdrawals`,
          {
            expectedRevision: after.bookingRevision,
            reason: 'Đã đối soát thất bại',
          },
          'own',
        )
      ).status,
    ).toBe(200);
    const proposal = await database.prisma.booking.findUniqueOrThrow({
      where: { id: other.bookingId },
    });
    expect(
      (
        await post(`/bookings/${other.bookingId}/slot-holds`, {
          expectedRevision: proposal.revision,
        })
      ).status,
    ).toBe(201);
    expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(0);
    expect(
      (
        await database.prisma.consultationAccess.findFirstOrThrow({
          where: { consultationId: f.consultationId, accountId: accounts.own! },
        })
      ).level,
    ).toBe('RESTRICTED');
  }, 30_000);

  it('rolls back the full CONTRACT charge if PAYMENT insertion fails, retaining proof and recovering once', async () => {
    const f = await fixture(),
      d = await approved(f);
    const checkout = await post(
      `/bookings/${f.id}/payments/deposit`,
      {
        timelineRevisionId: f.timelineId,
        contractRevisionId: d.contract.revisionId,
        documentDigest: d.contract.documentDigest,
      },
      'own',
    );
    expect(checkout.status).toBe(201);
    const attemptId = checkoutResponseSchema.parse(checkout.body as unknown).data.paymentAttemptId;
    const valid = ipnFixture(attemptId, {
      vnp_Amount: String(deposit * 100),
      vnp_PayDate: '20261011100000',
    });
    await database.prisma.$executeRawUnsafe(
      `CREATE FUNCTION be06_fail_payment() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'PAYMENT' THEN RAISE EXCEPTION 'controlled full-contract payment fault'; END IF; RETURN NEW; END; $$`,
    );
    await database.prisma.$executeRawUnsafe(
      'CREATE TRIGGER be06_fail_payment BEFORE INSERT ON "BillingLedgerEntry" FOR EACH ROW EXECUTE FUNCTION be06_fail_payment()',
    );
    try {
      expect((await get('/billing/callbacks/vnpay?' + valid, 'anonymous')).body).toMatchObject({
        RspCode: '00',
      });
      expect(
        (
          await database.prisma.billingPaymentAttempt.findUniqueOrThrow({
            where: { id: attemptId },
          })
        ).state,
      ).toBe('SUCCEEDED');
      expect(await database.prisma.billingLedgerEntry.count({ where: { bookingId: f.id } })).toBe(
        0,
      );
      expect(await database.prisma.billingOutboxEvent.count({ where: { aggregateId: f.id } })).toBe(
        0,
      );
      expect((await database.prisma.booking.findUniqueOrThrow({ where: { id: f.id } })).phase).toBe(
        'AWAITING_DEPOSIT',
      );
      expect(
        (
          await database.prisma.consultationAccess.findFirstOrThrow({
            where: { consultationId: f.consultationId, accountId: accounts.own! },
          })
        ).level,
      ).toBe('RESTRICTED');
    } finally {
      await database.prisma.$executeRawUnsafe(
        'DROP TRIGGER be06_fail_payment ON "BillingLedgerEntry"',
      );
      await database.prisma.$executeRawUnsafe('DROP FUNCTION be06_fail_payment()');
    }
    const retry = await get(`/bookings/${f.id}/payments/${attemptId}`, 'own');
    expect(attemptResponseSchema.parse(retry.body as unknown).data).toMatchObject({
      status: 'SUCCEEDED',
      applicationStatus: 'SUCCEEDED',
    });
    expect((await get('/billing/callbacks/vnpay?' + valid, 'anonymous')).body).toMatchObject({
      RspCode: '02',
    });
    const entries = await database.prisma.billingLedgerEntry.findMany({
      where: { bookingId: f.id },
    });
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.sourceType === 'CONTRACT')?.amountVnd.toNumber()).toBe(total);
    expect(entries.find((e) => e.kind === 'PAYMENT')?.amountVnd.toNumber()).toBe(deposit);
    expect(
      await database.prisma.billingDepositApplication.count({
        where: { payment: { bookingId: f.id } },
      }),
    ).toBe(1);
    expect((await database.prisma.booking.findUniqueOrThrow({ where: { id: f.id } })).phase).toBe(
      'CONFIRMED',
    );
  }, 30_000);
}
