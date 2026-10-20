// Run with: node --import tsx scripts/demo-catalog-refresh.mjs [--apply]
// Credentials/report stay private. Catalog writes use the deployed Manager APIs.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { z } from 'zod';
import {
  buildDemoLayoutPlans,
  stableDemoId,
  verifyDemoLayout,
  demoHallSchema,
  demoLayoutAggregateSchema,
  DEMO_HALL_RENAME,
  DEMO_LAYOUT_RENAMES,
  DEMO_CONSULTATION_RENAMES,
} from './demo-catalog-refresh.ts';

const config = z
  .object({
    origin: z.literal('https://wedding-be-production-e1dc.up.railway.app'),
    synthetic: z.literal(true),
    initialized: z.literal(true),
    credentials: z.object({ manager: z.object({ email: z.email(), password: z.string().min(1) }) }),
  })
  .parse(JSON.parse(readFileSync(process.env.DEMO_REFRESH_CONFIG, 'utf8')));
if (!process.env.DEMO_REFRESH_DATABASE_URL) throw Error('DEMO_REFRESH_DATABASE_URL_REQUIRED');
const apply = process.argv.includes('--apply');
const reportDirectory = '.local-demo/demo-refresh-20261020';
mkdirSync(reportDirectory, { recursive: true });
const report = { at: new Date().toISOString(), apply, operations: [], results: [] };
const reportPath = `${reportDirectory}/${apply ? 'apply' : 'plan'}-${Date.now()}.json`;
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2));
const db = new pg.Client({
  connectionString: process.env.DEMO_REFRESH_DATABASE_URL,
  connectionTimeoutMillis: 10000,
  statement_timeout: 20000,
});
let token;
async function api(path, method = 'GET', body, key) {
  await delay(300);
  const response = await fetch(config.origin + '/api/v1' + path, {
    method,
    redirect: 'error',
    signal: AbortSignal.timeout(26000),
    headers: {
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': stableDemoId(key) } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = response.status === 204 ? {} : await response.json();
  report.operations.push({
    path,
    method,
    status: response.status,
    requestId: response.headers.get('x-request-id'),
    errorCode: value.error?.code,
  });
  save();
  if (!response.ok) throw Error(`DEMO_API_${response.status}_${value.error?.code ?? 'FAILED'}`);
  return value.data;
}
async function list(path, schema) {
  const rows = [];
  let cursor;
  do {
    const page = await api(`${path}?limit=100${cursor ? '&cursor=' + cursor : ''}`);
    rows.push(...z.array(schema).parse(page.items));
    cursor = page.nextCursor;
    if (rows.length > 1000) throw Error('DEMO_INVENTORY_BOUND_EXCEEDED');
  } while (cursor);
  return rows;
}
const protectedTables = [
  'Booking',
  'BookingSlotHold',
  'GuestWorkspace',
  'GuestPlanRevision',
  'Guest',
  'GuestGroup',
  'GuestHistory',
  'SeatingPlan',
  'SeatingPlanRevision',
  'StaffConfiguration',
  'StaffAssignment',
  'StaffHistory',
  'StaffCheckInRecord',
  'CommercialContractRevision',
  'CommercialAppendixRevision',
  'FinalInvoiceRevision',
  'BillingLedgerEntry',
  'BillingPaymentAttempt',
];
async function fingerprints() {
  const result = {};
  for (const table of protectedTables) {
    const { rows } = await db.query(
      `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
    );
    result[table] = {
      count: rows.length,
      sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    };
  }
  return result;
}
async function renameConsultations(actorId) {
  // No public label-edit endpoint exists. Narrow audited operator transaction;
  // exact fixture IDs, old labels and Manager ownership are checked under row locks.
  await db.query('BEGIN');
  try {
    for (const change of DEMO_CONSULTATION_RENAMES) {
      const {
        rows: [row],
      } = await db.query(
        `SELECT c.id,c."displayName",c."managerAccountId",b.id AS "bookingId" FROM "Consultation" c JOIN "Booking" b ON b."consultationId"=c.id WHERE c.id=$1 FOR UPDATE OF c`,
        [change.id],
      );
      if (
        !row ||
        row.managerAccountId !== actorId ||
        row.bookingId !== change.bookingId ||
        ![change.before, change.after].includes(row.displayName)
      )
        throw Error('DEMO_CONSULTATION_CONFLICT');
      if (row.displayName === change.after) continue;
      if (apply) {
        await db.query(
          'UPDATE "Consultation" SET "displayName"=$2,"revision"="revision"+1,"updatedAt"=now() WHERE id=$1',
          [change.id, change.after],
        );
        await db.query(
          `INSERT INTO "AuditLog" (id,"requestId","actorType","actorId",action,"entityType","entityId",metadata,"occurredAt") VALUES ($1,$2,'USER',$3,'demo.display-label-renamed','consultation',$4,$5::jsonb,now())`,
          [
            stableDemoId(change.id + '/audit'),
            stableDemoId(change.id + '/request'),
            actorId,
            change.id,
            JSON.stringify({
              before: change.before,
              after: change.after,
              bookingId: change.bookingId,
              synthetic: true,
              ownerAuthorized: true,
              financialHistoryChanged: false,
            }),
          ],
        );
      }
      report.results.push({ kind: 'consultation-label', ...change, applied: apply });
    }
    await db.query(apply ? 'COMMIT' : 'ROLLBACK');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
async function publish(versionId, revision) {
  await api(
    `/management/catalog/layout-template-versions/${versionId}/publication`,
    'POST',
    { expectedRevision: revision },
    versionId + '/publication',
  );
}

async function refreshGuestNames() {
  const bookingIds = DEMO_CONSULTATION_RENAMES.map((c) => c.bookingId);
  const guests = (
    await db.query('SELECT * FROM "Guest" WHERE "bookingId"=ANY($1::uuid[]) ORDER BY id', [
      bookingIds,
    ])
  ).rows;
  const pending = guests.filter((g) => /^Khách PERF 0[1-8]$/u.test(g.name));
  if (!pending.length) return;
  const before = await fingerprints();
  const workspaces = (
    await db.query(
      'SELECT * FROM "GuestWorkspace" WHERE "bookingId"=ANY($1::uuid[]) ORDER BY "bookingId"',
      [bookingIds],
    )
  ).rows;
  const history = (await db.query('SELECT * FROM "GuestHistory" ORDER BY id')).rows;
  for (const guest of pending) {
    const name = guest.name.replace('PERF', 'Demo');
    if (apply)
      await api(
        `/bookings/${guest.bookingId}/guests/${guest.id}`,
        'PATCH',
        { name, expectedRevision: guest.revision },
        guest.id + '/rename',
      );
    report.results.push({
      kind: 'guest-label',
      guestId: guest.id,
      bookingId: guest.bookingId,
      before: guest.name,
      after: name,
      applied: apply,
    });
  }
  const afterGuests = (
    await db.query('SELECT * FROM "Guest" WHERE "bookingId"=ANY($1::uuid[]) ORDER BY id', [
      bookingIds,
    ])
  ).rows;
  const expectedGuests = guests.map((g) =>
    apply && pending.some((p) => p.id === g.id)
      ? {
          ...g,
          name: g.name.replace('PERF', 'Demo'),
          normalizedName: g.name.replace('PERF', 'Demo').toLowerCase(),
          revision: g.revision + 1,
        }
      : g,
  );
  if (JSON.stringify(expectedGuests) !== JSON.stringify(afterGuests))
    throw Error('DEMO_GUEST_FIELDS_CHANGED');
  const afterWorkspaces = (
    await db.query(
      'SELECT * FROM "GuestWorkspace" WHERE "bookingId"=ANY($1::uuid[]) ORDER BY "bookingId"',
      [bookingIds],
    )
  ).rows;
  const expectedWorkspaces = workspaces.map((w) => ({
    ...w,
    listSequence:
      w.listSequence + (apply ? pending.filter((g) => g.bookingId === w.bookingId).length : 0),
  }));
  if (JSON.stringify(expectedWorkspaces) !== JSON.stringify(afterWorkspaces))
    throw Error('DEMO_GUEST_PLANNING_CHANGED');
  const retainedHistory = (
    await db.query('SELECT * FROM "GuestHistory" WHERE id=ANY($1::uuid[]) ORDER BY id', [
      history.map((h) => h.id),
    ])
  ).rows;
  if (JSON.stringify(history) !== JSON.stringify(retainedHistory))
    throw Error('DEMO_GUEST_HISTORY_CHANGED');
  const after = await fingerprints();
  for (const table of protectedTables.filter(
    (t) => !['Guest', 'GuestWorkspace', 'GuestHistory'].includes(t),
  )) {
    if (JSON.stringify(before[table]) !== JSON.stringify(after[table]))
      throw Error('DEMO_PROTECTED_HISTORY_CHANGED');
  }
  if (
    after.Guest.count !== before.Guest.count ||
    after.GuestHistory.count !== before.GuestHistory.count + (apply ? pending.length : 0)
  )
    throw Error('DEMO_GUEST_COUNT_CHANGED');
  report.guestRefresh = {
    renamed: apply ? pending.length : 0,
    oldHistoryPreserved: true,
    allOtherGuestFieldsPreserved: true,
    planningAndCheckInPreserved: true,
  };
}
try {
  await db.connect();
  const session = await api('/auth/web-sessions', 'POST', config.credentials.manager);
  token = z.string().min(1).parse(session.accessToken);
  const actor = await api('/auth/me');
  const halls = await list('/management/catalog/halls', demoHallSchema);
  const layouts = await list('/management/catalog/layout-templates', demoLayoutAggregateSchema);
  const plans = buildDemoLayoutPlans(halls.filter((h) => h.lifecycle === 'ACTIVE'));
  const hall = halls.find((h) => h.id === DEMO_HALL_RENAME.id);
  if (!hall || ![DEMO_HALL_RENAME.before, DEMO_HALL_RENAME.after].includes(hall.name))
    throw Error('DEMO_HALL_CONFLICT');
  // Complete preflight before the first write, including replay/collision checks.
  for (const plan of plans) {
    const existing = layouts.find((l) => l.id === plan.templateId);
    if (!existing) continue;
    const version = existing.versions.find((v) => v.id === plan.versionId);
    if (
      existing.hallId !== plan.hallId ||
      existing.lifecycle !== 'ACTIVE' ||
      !version ||
      (existing.currentPublishedVersionId !== plan.versionId &&
        existing.draftVersionId !== plan.versionId)
    )
      throw Error('DEMO_LAYOUT_CONFLICT');
    verifyDemoLayout(plan, version);
  }
  for (const change of DEMO_LAYOUT_RENAMES) {
    const aggregate = layouts.find((l) => l.id === change.templateId);
    const successorId = stableDemoId(change.templateId + '/rename');
    if (
      !aggregate ||
      aggregate.hallId !== change.hallId ||
      aggregate.lifecycle !== 'ACTIVE' ||
      ![change.sourceVersionId, successorId].includes(aggregate.currentPublishedVersionId) ||
      (aggregate.draftVersionId && aggregate.draftVersionId !== successorId) ||
      !aggregate.versions.some(
        (v) => v.id === change.sourceVersionId && v.name === 'PERF-TEST Orchid 50',
      )
    )
      throw Error('DEMO_LAYOUT_CONFLICT');
  }
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  report.before = await fingerprints();
  report.originalLayoutVersions = (
    await db.query(
      `SELECT id,to_jsonb(v)-'state'-'updatedAt' AS content FROM "LayoutTemplateVersion" v ORDER BY id`,
    )
  ).rows;
  report.originalGeometry = (
    await db.query('SELECT * FROM "LayoutTableGeometry" ORDER BY id')
  ).rows;
  await db.query('ROLLBACK');
  await renameConsultations(actor.accountId);
  if (hall.name !== DEMO_HALL_RENAME.after) {
    if (apply)
      await api(`/management/catalog/halls/${hall.id}`, 'PATCH', {
        name: DEMO_HALL_RENAME.after,
        description: DEMO_HALL_RENAME.description,
        maxGuests: hall.maxGuests,
        displayOrder: hall.displayOrder,
        expectedRevision: hall.revision,
      });
    report.results.push({ kind: 'hall-label', ...DEMO_HALL_RENAME, applied: apply });
  }
  for (const change of DEMO_LAYOUT_RENAMES) {
    let aggregate = layouts.find((l) => l.id === change.templateId);
    const versionId = stableDemoId(change.templateId + '/rename');
    if (aggregate.currentPublishedVersionId === versionId) {
      const current = aggregate.versions.find((v) => v.id === versionId);
      if (current.name !== change.name) throw Error('DEMO_LAYOUT_CONFLICT');
      continue;
    }
    const source = aggregate.versions.find((v) => v.id === change.sourceVersionId);
    const body = {
      name: change.name,
      description: 'Mẫu demo 50 khách; giữ định danh bàn và lịch sử sơ đồ đã chọn.',
      minGuests: source.minGuests,
      maxGuests: source.maxGuests,
      tables: source.tables.map((t, i) => ({
        ...t,
        label: `Bàn ${String(i + 1).padStart(2, '0')}`,
      })),
    };
    if (apply) {
      if (!aggregate.draftVersionId)
        await api(
          `/management/catalog/layout-templates/${change.templateId}/versions`,
          'POST',
          { sourceVersionId: change.sourceVersionId, versionId },
          versionId + '/clone',
        );
      aggregate = demoLayoutAggregateSchema.parse(
        await api(`/management/catalog/layout-templates/${change.templateId}`),
      );
      const draft = aggregate.versions.find((v) => v.id === versionId);
      if (!draft || draft.state !== 'DRAFT') throw Error('DEMO_LAYOUT_CONFLICT');
      let revision = draft.revision;
      if (draft.name === source.name && draft.revision === 1) {
        const updated = await api(
          `/management/catalog/layout-template-versions/${versionId}`,
          'PATCH',
          { ...body, expectedRevision: revision },
        );
        revision = updated.revision;
      } else verifyDemoLayout(body, draft);
      await publish(versionId, revision);
    }
    report.results.push({ kind: 'layout-successor', ...change, versionId, applied: apply });
  }
  for (const plan of plans) {
    const existing = layouts.find((l) => l.id === plan.templateId);
    if (existing?.currentPublishedVersionId === plan.versionId) continue;
    if (apply) {
      const draft = existing?.versions.find((v) => v.id === plan.versionId);
      const created =
        draft ??
        (await api(
          '/management/catalog/layout-templates',
          'POST',
          plan,
          plan.templateId + '/create',
        ));
      await publish(plan.versionId, created.revision);
    }
    report.results.push({
      kind: 'new-layout',
      hallId: plan.hallId,
      templateId: plan.templateId,
      versionId: plan.versionId,
      name: plan.name,
      tables: plan.tables.length,
      minGuests: plan.minGuests,
      maxGuests: plan.maxGuests,
      applied: apply,
    });
  }
  report.after = await fingerprints();
  if (JSON.stringify(report.before) !== JSON.stringify(report.after))
    throw Error('DEMO_PROTECTED_HISTORY_CHANGED');
  for (const row of report.originalLayoutVersions) {
    const {
      rows: [current],
    } = await db.query(
      `SELECT to_jsonb(v)-'state'-'updatedAt' AS content FROM "LayoutTemplateVersion" v WHERE id=$1`,
      [row.id],
    );
    if (JSON.stringify(current?.content) !== JSON.stringify(row.content))
      throw Error('DEMO_OLD_LAYOUT_CONTENT_CHANGED');
  }
  const oldIds = report.originalGeometry.map((t) => t.id);
  const geometry = (
    await db.query('SELECT * FROM "LayoutTableGeometry" WHERE id=ANY($1::uuid[]) ORDER BY id', [
      oldIds,
    ])
  ).rows;
  if (JSON.stringify(geometry) !== JSON.stringify(report.originalGeometry))
    throw Error('DEMO_OLD_GEOMETRY_CHANGED');
  delete report.originalLayoutVersions;
  delete report.originalGeometry;
  await refreshGuestNames();
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = {
    code: error.code ?? error.name,
    message: /^DEMO_[A-Z0-9_]+$/.test(error.message ?? '')
      ? error.message
      : 'PRIVATE_DIAGNOSTIC_REQUIRED',
  };
  process.exitCode = 1;
} finally {
  if (token) {
    try {
      await api('/auth/sessions/current', 'DELETE');
      token = undefined;
      report.sessionRevoked = true;
    } catch {
      report.sessionRevoked = false;
      process.exitCode = 1;
    }
  }
  await db.end();
  save();
  console.log(
    JSON.stringify({
      passed: report.passed,
      apply,
      results: report.results,
      error: report.error,
      reportPath,
      sessionRevoked: report.sessionRevoked,
    }),
  );
}
