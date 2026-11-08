# Tasks 8/10 local verification — 2026-11-08

Branch in all four repositories: `codex/tasks-8-10-dashboard-deposit`, created from
each repository's current origin/main. Baselines: backend `b5a835c`, Manager Web
`fabd9b7`, Couple Web `295310b`, PRM-app `d833da8`.

## Accepted local evidence

- Final backend `npm run typecheck`, `npm run lint`, `npm run build` and
  `npm run api:check` pass. Changed-file formatting and whitespace checks pass.

- Backend source unit run: 180 files / 1,625 tests passed with
  `npm run test:unit -- --pool=threads --maxWorkers=1`. Two later transaction-retry
  tests were added; the final changed domain/repository/PDF/catalog set passed
  35 tests across four files. The retry retains one booking command and returns
  STALE_BOOKING_REVISION after three serialization failures.
- Backend contract run: 23 files / 100 tests passed using one thread worker after
  regenerating OpenAPI. The additive strict report contract and policy fields are
  published; generated released frontend pins were not replaced with invented hashes.
- Fresh PostgreSQL migration deployment succeeds through all 86 migrations on
  disposable databases using the existing loopback test administrator at port 55435.
  No production/shared database migration was run.
- Final completed-event SQL/HTTP set: five tests passed. Covers completed-only
  cohorts, provisional values, stable item grouping, independent hall usage/revenue,
  current adjusted invoices, refunds/net receipts, retained legacy invoice versus
  subsequent ledger credits, unknown sources, Manager authority, revoked roles,
  no-store, invalid dates and SQL payment filtering/pagination.
- Populated duplicate-MC forward migration: one test passed. The former active
  revision and price remain intact; a new inactive revision and SYSTEM audit are
  appended. MC tiệc cưới remains active and selectable.
- Actual owner HTTP/PostgreSQL cases: three tests passed together with
  `node scripts/staff-operations.verify.mjs tests/integration/commercial-contracts-api.test.ts -t 'serializes a new booking against|freezes new-booking policy|ANL-W1/W4' --pool=threads --maxWorkers=1 --hookTimeout=60000`.
  Proves config-update/booking-create serialization, frozen 30/50/100 percentages,
  proposal/contract agreement, dual approvals, manual external-receipt recording,
  immutable booking policy and reporting from real finalized invoice/appendix owners.
  Providers are controlled; no real money transfer was executed.
- Rounding mutation experiment: replacing the upward-rounding numerator adjustment
  with zero failed the arithmetic tests, including 101 VND at 10%. The original
  file was restored byte-for-byte afterward.
- Manager Web relevant set: 19 files / 108 tests passed, including booking/catalog
  workflows, financial filter request/response behavior, stale-response protection,
  rankings, invalid dates, deposit configuration and Vietnamese typography. Manager
  lint, TypeScript and production build pass.
- Couple Web relevant set: nine files / 61 tests passed, including commercial and
  booking workflows, overview behavior, deposit snapshot parsing and typography.
  TypeScript, lint and production build pass.
- Web production build checks use process-local HTTPS example configuration because
  the workstation's local HTTP development URL is intentionally rejected in a
  production build. No environment file or deployment setting was changed.
- PRM-app: `flutter analyze` has no issues; full `flutter test --no-pub` passes all
  130 tests. No APK/Gradle packaging was performed.

## Visual verification

Real Chromium on the local Manager app, controlled API fixtures:

- 1440 px: completed-event report is the first dashboard section; different usage
  and revenue leaders render correctly. Selecting revenue ranking puts Sảnh B first;
  selecting PAID removes the debt row while leaving summary/rankings unchanged.
- 390 px: no document horizontal overflow. Each financial table scrolls in its own
  container. Vietnamese headings use Be Vietnam Pro sans-serif and 32 px line height.
- No financial request was sent to a shared backend. The controlled fixture does not
  supply a websocket server, so connection-refused realtime diagnostics are expected
  fixture limitations, not a claim of verified realtime transport.
- Local screenshots: `test-results/tasks-8-10-dashboard-final.png` and
  `test-results/tasks-8-10-mobile-final.png` (ignored verification artifacts).

The actual PDF renderer generated a standard contract at 50%: 35,000,000 VND total,
17,500,000 VND deposit and 17,500,000 VND remaining. Poppler-rendered page 2 was
visually inspected: clause 5.1, clause 5.2, Vietnamese glyphs, wrapping and footer
are legible with no overlap. Unit tests cover both PDF clause variants at 10/50/100%.
Retained PDFs were not regenerated. Local PDF artifacts are in
`test-results/tasks-8-10-pdf/`.

## Limits and follow-up gates

- Large backend commercial-suite attempts terminated with Windows native process
  status `3221226505` / `-1073740791`. Focused cases above subsequently completed;
  this is not a full-commercial-suite green claim. A stable CI/full integration run
  remains a pre-merge acceptance gate.
- Broad web-suite attempts were stopped after unrelated invitation-studio failures
  and resource pressure. Relevant suites above pass, but no full-web-suite green
  claim is made. No tests, assertions, thresholds or skip policies were weakened.
- The older populated analytics-upgrade fixture cannot use today's Prisma model
  before its later columns exist; this baseline setup limitation is already recorded
  in the prior Staff evidence. Its expected venue observation count is updated for
  the new forward observation, without changing applied migrations or bypassing setup.
- Deployment, archive of the actual target's duplicate service, coordinated client
  release, released-client repinning and live provider acceptance remain separate.

See [API/release hand-off](../../docs/tasks-8-10-api-handoff.md) for formulas,
authorization, migrations, compatibility and rollback restrictions.
