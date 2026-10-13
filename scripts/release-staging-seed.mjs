import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';

// Explicitly approved dedicated resources. Never run against the legacy service.
const targetSchema = z.object({
  projectId: z.literal('1c56721d-021a-442c-9e01-bb91abe73adb'),
  environmentId: z.literal('0e555702-7899-4a3e-b18b-9ebc9dbabdff'),
  serviceId: z.literal('fd5ec613-a75f-4f9c-8b21-94674c5ebcbb'),
  databaseServiceId: z.literal('c45d31d4-e0ca-4248-8e1d-4204706d7bcc'),
  origin: z.literal('https://wedding-be-spec11-spec11-staging.up.railway.app'),
});
const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (label) => {
  const h = sha256(['BACKEND-RELEASE@3.0.0', label]);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

async function main() {
  const [inputFile, stateFile] = process.argv.slice(2);
  if (!inputFile || !stateFile || !stateFile.endsWith('.private.json'))
    throw Error('PRIVATE_TARGET_AND_CHECKPOINT_REQUIRED');
  const input = z
    .object({
      target: targetSchema,
      env: z.record(z.string(), z.string()),
      localDatabaseUrl: z.url(),
    })
    .parse(JSON.parse(fs.readFileSync(inputFile, 'utf8')));
  const url = new URL(input.localDatabaseUrl);
  if (
    url.hostname !== 'iriguchi.proxy.rlwy.net' ||
    url.port !== '21686' ||
    url.pathname !== '/railway'
  )
    throw Error('DEDICATED_STAGING_DATABASE_REQUIRED');
  Object.assign(process.env, input.env, {
    DATABASE_URL: input.localDatabaseUrl,
    MIGRATION_DATABASE_URL: input.localDatabaseUrl,
  });
  const { createPrismaClient } = await import('../dist/core/database/prisma.js');
  const { seedVenueCatalog, CATALOG_SEED_IDS: ids } = await import('./catalog-seed.ts');
  const { hashPassword } = await import('../dist/modules/identity-access/crypto/password.js');
  const { config } = await import('../dist/config/config.js');
  const { createPrismaSessionRepository } =
    await import('../dist/modules/identity-access/session/session.repository.js');
  const { hashOpaqueToken } = await import('../dist/modules/identity-access/crypto/token.js');
  const { createInvitationStudioServices } =
    await import('../dist/modules/invitation-studio/infrastructure/studio.composition.js');
  const { createStaffSeatingServices } =
    await import('../dist/modules/staff-operations/infrastructure/staff-seating.composition.js');
  const p = createPrismaClient();
  const state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    : {
        target: input.target,
        accounts: {},
        tokens: {},
        steps: {},
        scenarios: {},
        receipts: [],
      };
  assert.deepEqual(state.target, input.target, 'CHECKPOINT_TARGET_CONFLICT');
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  const step = async (label, work) => {
    if (Object.hasOwn(state.steps, label)) return state.steps[label];
    const result = await work();
    state.steps[label] = result;
    save();
    return result;
  };
  const call = async (
    label,
    path,
    method = 'GET',
    body,
    who = 'manager',
    expected = method === 'POST' ? 201 : 200,
  ) =>
    step(label, async () => {
      const r = await fetch(input.target.origin + '/api/v1' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Origin: input.target.origin,
          Authorization: 'Bearer ' + state.tokens[who],
          'Idempotency-Key': key(label),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(45000),
        redirect: 'manual',
      });
      const data = await r.json();
      state.receipts.push({
        label,
        method,
        path,
        status: r.status,
        requestId: r.headers.get('x-request-id'),
        at: new Date().toISOString(),
      });
      save();
      if (r.status !== expected)
        throw Error(label + ':HTTP_' + r.status + ':' + (data.error?.code ?? 'INVALID_RESPONSE'));
      return data.data;
    });
  const snapshot = async (bookingId) => ({
    booking: await p.booking.findUniqueOrThrow({ where: { id: bookingId } }),
    contracts: await p.commercialContractRevision.findMany({
      where: { bookingId },
      orderBy: { id: 'asc' },
    }),
    guests: await p.guest.findMany({ where: { bookingId }, orderBy: { id: 'asc' } }),
    groups: await p.guestGroup.findMany({ where: { bookingId }, orderBy: { id: 'asc' } }),
    seating: await p.seatingPlan.findMany({ where: { bookingId }, orderBy: { id: 'asc' } }),
    invoices: await p.finalInvoiceRevision.findMany({
      where: { bookingId },
      orderBy: { id: 'asc' },
    }),
    payments: await p.payment.findMany({ where: { bookingId }, orderBy: { id: 'asc' } }),
  });
  try {
    if (state.completed) {
      for (const [scenario, result] of Object.entries(state.scenarios))
        assert.equal(
          sha256(await snapshot(result.bookingId)),
          result.fingerprint,
          scenario + ':DEMO_SEED_CONFLICT',
        );
      console.log(
        JSON.stringify({
          status: 'VERIFIED_EXISTING',
          scenarios: Object.keys(state.scenarios),
          overwritten: 0,
        }),
      );
      return;
    }
    await step('operator-bootstrap', async () => {
      assert.equal(await p.account.count(), 0, 'EMPTY_DEDICATED_FIXTURE_DATABASE_REQUIRED');
      await seedVenueCatalog(p);
      for (const [name, role] of [
        ['manager', 'MANAGER'],
        ['couple', 'COUPLE'],
        ['staff', 'STAFF'],
      ]) {
        const accountId = key('account/' + name);
        const verifier = await hashPassword(
          'Staging-' + randomUUID(),
          config.identityAccess.password,
        );
        await p.account.create({
          data: {
            id: accountId,
            emailNormalized: 'rel-' + name + '@example.invalid',
            displayEmail: 'rel-' + name + '@example.invalid',
            displayName: 'SPEC-11 synthetic ' + name,
            roles: { create: { role } },
            passwordCredential: {
              create: {
                algorithm: verifier.algorithm,
                version: verifier.version,
                ...verifier.parameters,
                saltEncoded: verifier.saltEncoded,
                derivedKeyEncoded: verifier.derivedKeyEncoded,
              },
            },
          },
        });
        const now = new Date(),
          token = 'wia_' + randomBytes(32).toString('base64url');
        await createPrismaSessionRepository(p).createSession({
          accountId,
          clientKind: 'WEB',
          accessTokenHash: hashOpaqueToken(token, 'access'),
          refreshTokenHash: hashOpaqueToken(randomBytes(32).toString('hex'), 'refresh'),
          now,
          accessExpiresAt: new Date(now.getTime() + 3600000),
          idleExpiresAt: new Date(now.getTime() + 3600000),
          absoluteExpiresAt: new Date(now.getTime() + 3600000),
        });
        state.accounts[name] = accountId;
        state.tokens[name] = token;
        save();
      }
      await p.auditLog.create({
        data: {
          requestId: randomUUID(),
          actorType: 'SYSTEM',
          action: 'release.synthetic-identity-bootstrap',
          entityType: 'release',
          entityId: key('release'),
          metadata: {
            dedicatedStaging: true,
            operator: 'Le-Ba-Bach',
            emailsSent: 0,
            realPayments: 0,
          },
        },
      });
      return { syntheticIdentityOnly: true };
    });
    const content = {
      title: 'Thiệp kiểm chứng SPEC-11',
      textFields: { greeting: 'Trân trọng kính mời' },
      sections: [],
      derivedAssetIds: [],
      includesSeating: false,
    };
    const template = await call('template', '/management/invitation-templates', 'POST', {
      expectedRevision: 0,
      active: true,
      content,
    });
    const service = await call('service', '/management/services', 'POST', {
      name: 'MC thử SPEC-11',
      description: 'Dịch vụ thử nghiệm',
      unit: 'buổi',
      unitPriceVnd: 1000000,
      active: true,
    });
    const print = await call('print-offering', '/management/print-offerings', 'POST', {
      templateId: template.templateId,
      templateVersionId: template.versionId,
      name: 'Thiệp SPEC-11',
      printType: 'Hai mặt',
      material: 'Giấy thử',
      unitPriceVnd: 5000,
      active: true,
    });
    const lines = [
      {
        category: 'MENU',
        sourceId: ids.classicMenu,
        sourceRevisionId: ids.classicMenuVersion,
        quantity: 2,
      },
      {
        category: 'SERVICE',
        sourceId: service.serviceId,
        sourceRevisionId: service.sourceRevisionId,
        quantity: 1,
      },
      {
        category: 'PRINT',
        sourceId: print.offeringId,
        sourceRevisionId: print.sourceRevisionId,
        quantity: 20,
      },
    ];
    for (const [index, scenario] of ['no-names', 'partial-names'].entries()) {
      const prefix = scenario + '/';
      const c = await call(prefix + 'consultation', '/management/consultations', 'POST', {
        intendedEmail: 'rel-couple@example.invalid',
        displayName: 'SPEC-11 ' + scenario,
        brideName: 'Cô dâu thử',
        groomName: 'Chú rể thử',
        note: 'REL-SEED:' + key(scenario),
      });
      await step(prefix + 'restricted-access', async () => {
        await p.consultationAccess.create({
          data: {
            consultationId: c.consultationId,
            accountId: state.accounts.couple,
            level: 'RESTRICTED',
          },
        });
        return { syntheticInvitationAcceptance: true };
      });
      const b = await call(prefix + 'booking', '/bookings', 'POST', {
        consultationId: c.consultationId,
        hallId: ids.lotusHall,
        eventDate: '2027-06-' + String(index + 1).padStart(2, '0'),
        shiftCode: 'DINNER',
        menuPackageVersionId: ids.classicMenuVersion,
        tableCount: 2,
        planningHeadcount: 20,
        expectedRevision: c.revision,
      });
      const bookingId = b.bookingId,
        base = '/bookings/' + bookingId;
      let head = await call(prefix + 'proposal', base + '/proposal');
      const hold = await call(prefix + 'hold', base + '/slot-holds', 'POST', {
        expectedRevision: head.revision,
      });
      let timeline = await call(
        prefix + 'timeline',
        base + '/timeline-revisions',
        'POST',
        {
          expectedRevision: hold.bookingRevision,
          predecessorRevisionId: null,
          items: [
            { order: 0, startTime: '18:00', title: 'Đón khách' },
            { order: 1, startTime: '19:00', title: 'Lễ cưới' },
          ],
        },
        'couple',
      );
      for (const actor of ['manager', 'couple'])
        timeline = await call(
          prefix + 'timeline-approve-' + actor,
          base + '/timeline-revisions/' + timeline.revision.revisionId + '/approvals',
          'POST',
          { expectedRevision: timeline.bookingRevision },
          actor,
          200,
        );
      // Historical fixture correction occurs before any signed commercial document or payment.
      await step(prefix + 'historical-fixture', async () => {
        const eventDate = new Date('2026-01-' + String(index + 1).padStart(2, '0') + 'T00:00:00Z');
        await p.$transaction(async (tx) => {
          assert.equal(await tx.commercialContractRevision.count({ where: { bookingId } }), 0);
          assert.equal(await tx.payment.count({ where: { bookingId } }), 0);
          await tx.booking.update({ where: { id: bookingId }, data: { eventDate } });
          await tx.bookingSlotHold.updateMany({
            where: { bookingId, status: 'ACTIVE' },
            data: { eventDate },
          });
          await tx.auditLog.create({
            data: {
              requestId: randomUUID(),
              actorType: 'SYSTEM',
              action: 'release.synthetic-historical-fixture',
              entityType: 'booking',
              entityId: bookingId,
              metadata: { beforeCommercialApproval: true, beforePayment: true },
            },
          });
        });
        return { historicalFixture: true };
      });
      let contract = await call(
        prefix + 'contract',
        base + '/contracts',
        'POST',
        {
          expectedRevision: timeline.bookingRevision,
          predecessorRevisionId: null,
          timelineRevisionId: timeline.revision.revisionId,
          lines,
        },
        'couple',
      );
      for (const [action, actor] of [
        ['submissions', 'couple'],
        ['approvals', 'manager'],
        ['approvals', 'couple'],
      ])
        contract = await call(
          prefix + 'contract-' + action + '-' + actor,
          base + '/contracts/' + contract.contract.revisionId + '/' + action,
          'POST',
          { expectedRevision: contract.bookingRevision },
          actor,
          200,
        );
      const document = contract.contract.document;
      const paymentBody = {
        bookingId,
        purpose: 'DEPOSIT',
        contractRevisionId: contract.contract.revisionId,
        documentDigest: contract.contract.documentDigest,
        amountVnd: document.depositAmountVnd,
        settledAt: new Date().toISOString(),
        reason: 'Sổ thu thử nghiệm staging; không có tiền thật',
        evidenceReference: 'SPEC11-SYNTHETIC-MANUAL',
      };
      await call(
        prefix + 'manual-deposit',
        '/management/billing/payments/manual',
        'POST',
        paymentBody,
      );
      const ctx = {
        actorId: state.accounts.couple,
        accessToken: state.tokens.couple,
        requestId: randomUUID(),
      };
      const studio = createInvitationStudioServices(p, {}, null, input.target.origin);
      const actual = await p.booking.findUniqueOrThrow({ where: { id: bookingId } });
      const eventClock = new Date(actual.eventDate.toISOString().slice(0, 10) + 'T18:00:00+07:00');
      const owners = createStaffSeatingServices(p, studio, () => eventClock);
      const group = (
        await call(prefix + 'groups', base + '/guest-groups', 'GET', undefined, 'couple')
      )[0];
      let attendance = await call(
        prefix + 'attendance-none',
        base + '/attendance-summary',
        'GET',
        undefined,
        'couple',
      );
      assert.equal(attendance.checkedInGuestCount, null);
      const options = await call(
        prefix + 'seating-options',
        base + '/seating-layout-options',
        'GET',
        undefined,
        'couple',
      );
      const layout = options.items.find((l) => l.compatible);
      assert(layout, 'COMPATIBLE_GROUP_LAYOUT_REQUIRED');
      let plan = await call(
        prefix + 'seating-select',
        base + '/seating-plans',
        'POST',
        {
          layoutTemplateVersionId: layout.layoutTemplateVersionId,
          expectedBookingRevision: options.bookingRevision,
        },
        'couple',
      );
      plan = await call(
        prefix + 'seating-labels',
        base + '/seating-plans/' + plan.seatingPlanId + '/revisions',
        'POST',
        {
          expectedRevision: plan.revisionNumber,
          labels: [
            {
              layoutTableId: plan.renderSnapshot[0].layoutTableId,
              guestGroupId: group.guestGroupId,
            },
          ],
        },
        'couple',
      );
      plan = await call(
        prefix + 'seating-confirm',
        base + '/seating-plans/' + plan.seatingPlanId + '/confirmation',
        'POST',
        {
          expectedRevision: plan.revisionNumber,
          expectedBookingRevision: options.bookingRevision,
        },
        'couple',
      );
      const design = await call(
        prefix + 'design',
        base + '/invitations',
        'POST',
        {
          content: {
            ...content,
            sections: [{ kind: 'SEATING', textKey: null, derivedAssetId: null }],
            includesSeating: true,
          },
        },
        'couple',
      );
      await call(
        prefix + 'publication',
        base + '/invitations/' + design.designId + '/publication',
        'POST',
        {
          expectedRevision: design.revisionNumber,
          designRevisionId: design.revisionId,
          expectedPublicationRevision: 0,
        },
        'couple',
        200,
      );
      const printable = await step(prefix + 'printable', () =>
        studio.boundary.run(
          {
            bookingId,
            context: {
              requestId: ctx.requestId,
              causationId: ctx.requestId,
              actorAccountId: ctx.actorId,
              authority: 'AUTHENTICATED',
            },
          },
          (scope) =>
            studio.printable.capture({ bookingId, designRevisionId: design.revisionId }, scope),
        ),
      );
      const file = await studio.printFiles.read(bookingId, printable.printableRevisionId, ctx);
      assert.equal(file.bytes.subarray(0, 5).toString(), '%PDF-');
      assert.equal(printable.content.seating.seatingPlanRevisionId, plan.revisionId);
      if (scenario === 'partial-names') {
        const guests = [];
        for (const n of [1, 2])
          guests.push(
            await call(
              prefix + 'guest-' + n,
              base + '/guests',
              'POST',
              { guestGroupId: group.guestGroupId, name: 'Khách trùng tên' },
              'couple',
            ),
          );
        await call(
          prefix + 'assignment',
          '/management/events/' + bookingId + '/assignments',
          'POST',
          { staffAccountId: state.accounts.staff, expectedRevision: 0 },
        );
        await call(
          prefix + 'mode',
          base + '/check-in-settings',
          'PATCH',
          { checkInMode: 'BY_GUEST_NAME', expectedRevision: 1 },
          'couple',
        );
        const staffCtx = {
          actorId: state.accounts.staff,
          accessToken: state.tokens.staff,
          requestId: randomUUID(),
        };
        const checkIn = await step(prefix + 'check-in', () =>
          owners.staff.journal.checkIn(
            bookingId,
            guests[0].guestId,
            {},
            key(prefix + 'check-in'),
            staffCtx,
          ),
        );
        assert.deepEqual(
          await owners.staff.journal.checkIn(
            bookingId,
            guests[0].guestId,
            {},
            key(prefix + 'check-in'),
            staffCtx,
          ),
          checkIn,
        );
        await step(prefix + 'undo', () =>
          owners.staff.journal.undo(
            bookingId,
            guests[0].guestId,
            {
              checkInRecordId: checkIn.checkInRecordId,
              expectedLedgerRevision: checkIn.ledgerRevision,
              reason: 'Sửa check-in thử nghiệm',
            },
            key(prefix + 'undo'),
            staffCtx,
          ),
        );
        await call(
          prefix + 'archive',
          base + '/guests/' + guests[1].guestId,
          'PATCH',
          { expectedRevision: guests[1].revision, status: 'ARCHIVED' },
          'couple',
        );
        attendance = await owners.staff.readers.getBookingAttendance(bookingId);
        assert.equal(attendance.checkedInGuestCount, 0);
        assert.equal(attendance.ledgerRevision, 2);
      }
      const bill = await call(prefix + 'bill', base + '/billing', 'GET', undefined, 'couple');
      assert.equal(
        (await p.booking.findUniqueOrThrow({ where: { id: bookingId } })).planningHeadcount,
        20,
      );
      head = await call(prefix + 'completion-head', base + '/proposal');
      await call(
        prefix + 'completion',
        '/management' + base + '/completion',
        'POST',
        { expectedRevision: head.revision },
        'manager',
        200,
      );
      const invoice = await call(
        prefix + 'invoice',
        '/management' + base + '/final-invoices',
        'POST',
        {
          expectedDraftRevision: 0,
          expectedCommercialRevisionId: contract.contract.revisionId,
          expectedBillingRevision: bill.billingRevision,
        },
      );
      assert.equal(invoice.document.totalVnd, document.contractTotalVnd);
      assert.equal(invoice.document.incidentalTotalVnd, 0);
      assert.equal(await p.guest.count({ where: { bookingId } }), scenario === 'no-names' ? 0 : 2);
      state.scenarios[scenario] = {
        bookingId,
        contractRevisionId: contract.contract.revisionId,
        planningHeadcount: 20,
        totalVnd: document.contractTotalVnd,
        depositVnd: document.depositAmountVnd,
        invoiceRevisionId: invoice.revisionId,
        pdfSha256: file.sha256,
        attendance,
        fingerprint: sha256(await snapshot(bookingId)),
      };
      save();
    }
    state.completed = true;
    state.completedAt = new Date().toISOString();
    save();
    console.log(
      JSON.stringify({
        status: 'CREATED',
        scenarios: Object.keys(state.scenarios),
        httpRequests: state.receipts.length,
        syntheticIdentityAndManualPayment: true,
        providerPaymentProof: false,
        realPayments: 0,
        checkInClock: 'explicit historical fixture clock through native Staff owner',
        overwritten: 0,
      }),
    );
  } finally {
    await p.$disconnect();
  }
}
await main().catch((error) => {
  fs.writeFileSync('.local-demo/release-staging-seed-error.private.log', String(error.stack), {
    mode: 0o600,
  });
  console.error('Release seed failed; secret-safe private diagnostics saved.');
  process.exitCode = 1;
});
