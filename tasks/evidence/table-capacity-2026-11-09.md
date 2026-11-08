# Fixed table capacity — local verification, 2026-11-09

Scope: wedding-be, wedding-manage-web, wedding-web, PRM-app; owner-approved
fixed 10-person tables with menu quantities remaining table quantities. Couple
headcount editing remains enabled. No new per-table capacity configuration.

## Confirmed results

- Backend `npm run typecheck`: passed.
- Backend `npm run build`: passed.
- Backend `npm run test:unit -- --maxWorkers=1 --testTimeout=30000`: **182 files, 1,640 tests passed**.
- New PostgreSQL/HTTP integration regression: **7 tests passed** via
  `node scripts/staff-operations.verify.mjs tests/integration/table-capacity.test.ts --maxWorkers=1`.
  Hardened run (38.26s) also passed all seven cases after adding shared catalog
  locks and the historical correction path.
- Additional PostgreSQL regressions: guest-management 6, seating-plan 9 and
  booking-lifecycle/runtime 5 tests passed on disposable databases. The existing
  timeline-only compatibility test explicitly selects the legacy model; its
  early-completion rejection explicitly enables strict date mode.
- Unit deposit regression verifies new eligibility/reservation cannot exceed the
  published layout; exact reconciliation of an already reserved payment remains
  valid after catalog layout retirement.

## Browser verification

Real production components were rendered in temporary local Next.js routes using
synthetic props, without live account/financial writes. Routes were removed after QA.

- Manager: 100 guests/8 tables rejected, 100 guests/20 tables rejected against a
  12-table hall maximum, 95 guests/10 tables accepted. Create action disabled for
  invalid capacity. Summary capacity uses selected table count, not hall size alone.
- Couple: 101 guests/10 effective tables rejected, 95 guests accepted; reducing menu
  quantity to 9 or increasing it to 20 against maximum 12 disables saving appendix.
- Checked desktop 1440px and mobile 390px. No horizontal page overflow; no console
  errors on the final verified loads. Vietnamese headings/body visually inspected.
- Screenshots: `output/playwright/table-capacity-manager-desktop.png`,
  `table-capacity-manager-mobile.png`, `table-capacity-couple-desktop.png`,
  `table-capacity-couple-mobile.png` in the same directory.

## Resource constraints and follow-up verification

Initial simultaneous broad checks exhausted available RAM and produced test timing
failures and one Windows worker crash. Checks were restarted sequentially. No test
was disabled, no assertion removed, and no repository timeout/performance threshold
was lowered. CLI scheduling timeouts allow the resource-limited verification host.
Client, lint/OpenAPI and hardened integration results follow below.

No shared application/catalog/history rows were modified. Local PostgreSQL runs use
guarded loopback disposable databases; no provider payment, paid AI generation,
production deployment, migration rewrite or APK build was performed.

## Client and final static checks

- Manager Web full suite: **59 files, 339 tests passed**, including Vietnamese typography.
- Final capacity integration: **7/7 passed**, native disposable PostgreSQL and real HTTP owners.
  Includes a real two-actor advisory-lock race, effective sorting/paging, preservation
  of old documents/deposit, and safe headcount-then-appendix correction of legacy excess tables.
- Backend OpenAPI generation/check: passed after the additive DTO/documentation changes.
- Backend full lint found one unnecessary non-null assertion in the new regression;
  it was removed before final verification.

- Couple Web broad suite: 60 files / 384 tests passed, with one message-priority
  regression in LineSelector. After preserving the missing-menu message and adding
  minimum/maximum/partial-occupancy component coverage, the affected commercial,
  planning, capacity-helper and typography group passed **5 files / 16 tests**.
- Flutter `flutter analyze --no-pub`: **no issues** (87.6s), after fixing two brace-style notices.

- Flutter `flutter test --no-pub --concurrency=1`: **135/135 tests passed** (2m53s),
  including the appendix editor and fixed-capacity validation. No APK/Gradle packaging.
- Couple Web full lint and typecheck passed. Initial typecheck/build identified a stale generated
  `.next/dev/types` reference to the removed temporary QA route. Starting/stopping
  Next dev regenerated its route types; the temporary route remains removed.
  Production build passed against the refreshed cache. Local `.env.local` uses HTTP,
  so build-only process environment used `https://api.example.invalid` for API and
  realtime URLs to satisfy the existing production HTTPS requirement. No env file
  was modified and no deployment was performed.
- Manager Web final full lint, typecheck and production build passed. Build used
  the same process-only HTTPS placeholder URLs as Couple Web.
- Final backend typecheck and production build passed after the historical
  correction and effective-search pagination changes.
- Final combined native integration run: table-capacity **7/7 passed** (including
  wildcard search/paging); commercial contracts **61/62 passed**. The failure
  identified changed error precedence for the existing 500-table hard cap. The
  original `CONTRACT_CAPACITY_EXCEEDED` guard was restored before checking the new
  layout limit. The focused PostgreSQL/HTTP regression then **passed** (30.89s),
  with the existing assertion retained; the other 61 cases were excluded only by
  that command's test-name filter, not disabled in source.
- Final lint of every changed backend TypeScript file passed after removing the
  unnecessary assertion.
- Production build and focused contract-service lint passed again after restoring
  the existing 500-table error precedence. Working copies contain no temporary QA routes.
