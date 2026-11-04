# Demo final invoice date-policy fix — 2026-11-04

The owner reported HTTP 500 from Manager finalization and explicitly requested
settlement before the wedding date for demo/final-payment testing.

## Root cause and reproduction

`createEventEndReader` already skipped the date check by default. PostgreSQL's
`require_event_ended`, called by both expense and final-invoice insert triggers,
still unconditionally required the event to have ended. The new native HTTP tests
reproduced `500 INTERNAL_ERROR` with a future, confirmed booking and both zero
expenses and a 100,000 VND expense. Explicit strict mode correctly returned 409.
The initial legacy paid-fixture helper used an obsolete Couple contract-creation
route; the regression instead uses current Couple selection/submission, Manager
contract creation, dual approval and a controlled local deposit record.

## Change

- Forward migration `20261104110000_demo_settlement_date_policy` replaces only
  `require_event_ended`. Existing migrations and financial rows are unchanged.
- The authorized settlement transaction sends the existing server policy through
  `set_config('app.strict_settlement_date_check', value, true)`. The `true` argument
  restricts its lifetime to that transaction. Missing settings keep direct SQL strict.
- CONFIRMED/COMPLETED phase and proposal evidence remain mandatory even in demo.
  Manager authority, approved commercial sources, payment pins, integer VND,
  ledger atomicity, idempotency and immutable history remain in force.
- `STRICT_SETTLEMENT_DATE_CHECK=true` keeps the optional application/database
  date gate. The default demo configuration does not enable it.
- OpenAPI descriptions/digest and CI now include this behavior and its regressions.

## Verification

The final native run passed **4/4 cases** on disposable loopback PostgreSQL after
all 79 migrations: zero/nonzero expenses, replay without duplicate invoice/charge,
correct remaining-balance checkout amount, no leaked transaction setting,
strict-mode rejection without invoice writes, and application/database refusal
of an unconfirmed booking even with demo mode enabled. Command:

```text
node scripts/staff-operations.verify.mjs tests/integration/commercial-contracts-api.test.ts -t 'demo finalizes|strict mode refuses|demo settlement rejects' --pool=threads --maxWorkers=1 --hookTimeout=60000
```

The combined print/demo run passed all **8 selected assertions**, then exceeded
the existing 10-second cleanup-hook budget. A subsequent fork worker exited with
Windows code `3221226505` before running assertions. The final isolated thread
run above completed successfully, including cleanup. No test was disabled and
repository timeout/coverage thresholds were not changed.

Static checks passed: `npm run typecheck`, `npm run lint`, `npm run build`,
`npm run api:generate`, `npm run api:check`, changed-source Prettier and
`git diff --check`. A deliberate inversion of the strict-mode condition failed
all three existing reader tests; the original source was restored and the focused
reader/invoice/OpenAPI tests passed.

The broad modules/contract run passed **1,158 tests** and failed five unrelated
contract assertions: old CI workflow expectations, invitation public-schema
regex, seating/staff operation counts and venue-wide schema regex. These surfaces
are unchanged except for settlement descriptions and the added CI command.
Comparing the generated API against HEAD after removing the two intended
description changes produces identical JSON structure, confirming that this fix
does not change those route counts or public schemas. The remaining 40 source
test files passed 510 cases and hit two environment assertions when `.env.demo`
selected development mode. Re-running those two files with `NODE_ENV=test`
passed; no source changes were needed. The thread-pool attempt at that core
subset exited early, so the recorded completed core run uses the default forks.
The unisolated full-suite attempt also encountered database/configuration and
other existing integration failures and was stopped; it is not a successful
full-project acceptance or coverage result. Logs remain ignored under
`test-results/demo-settlement-*.log`.

Review found no remaining defect in the scoped fix. The API shape is unchanged;
the runtime change adds one transaction-local configuration query per authorized
settlement mutation. No dependency or Prisma model change is required. Deployment
and real browser/provider verification remain open as DFI-02.

All money/provider interactions in these tests are synthetic local records and a
controlled VNPay checkout adapter. No actual provider settlement or deployed UI
success is established. Deployment requires the new migration and matching backend.

## Owner-authorized deployment — 2026-11-04

The owner explicitly requested deployment of the migration and matching backend.
PR [#98](https://github.com/WDP301-wedding/wedding-be/pull/98) was reviewed and merged
after its exact-head CI passed, with no unresolved review comments. The merge commit
also passed all four current release checks:
[main CI run](https://github.com/WDP301-wedding/wedding-be/actions/runs/41749852834).
The generated API structure is unchanged except for the two settlement descriptions.

- Commit: `50b7a37af52a7eb9cd2f02ac900f83d77743c2b8`.
- Target: existing Render service `wedding-be-render-trial`,
  `srv-dbct9ao473hc73a5qud0`, workspace `tea-dbcss8ks728c73851hl0`.
- Deployment: `dep-dbl84ee1egvs73e2gn80`, status **live**, finished at
  **07:56:29 on 4 November 2026 (Asia/Saigon)**.
- Explicitly merged `STRICT_SETTLEMENT_DATE_CHECK=false` into the service's
  environment, preserving all other variables. This save triggered the matching
  deployment, so no duplicate deploy was triggered. The existing service uses
  Dashboard/API configuration; its Blueprint is not linked, and omission of this
  service variable from the Blueprint does not delete it on a future sync.
- New instance `srv-dbct9ao473hc73a5qud0-xv6b7` logged
  `Applying migration 20261104110000_demo_settlement_date_policy` at 07:56:19,
  followed by `All migrations have been successfully applied.`
- Live `/health/live` and `/health/ready`: **200**. Live canonical OpenAPI SHA-256
  matches the release: `1f88df2ec5b6ca8ad4a701b003267cc875d473bf32ba632575d6b21e9af8d7c4`.
- A valid-shaped final-invoice POST without credentials returned **401**
  `AUTHENTICATION_REQUIRED`. No invoice or payment was created by this check.
- No error/fatal logs were returned for the new instance during the startup and
  immediate post-deploy verification window.

The GitHub connector could not create the PR (403); the existing configured Git
identity completed the normal PR/CI/merge flow without exposing its credential.
Direct database inspection was unavailable because external connections remain
blocked, and SSH had no authorized key. Neither access control was relaxed.
Migration completion is evidenced by the exact new-instance startup logs rather
than inferred from health alone. No live invoice creation, payment, provider
transaction or authenticated browser acceptance was performed; DFI-03 remains open.

Rollback target is the prior retained deployment `dep-dbl73pvb9u1s73doa6kg`
(commit `c1e5856fa697f6be1b9090a0a49c5a5291ca7b99`). Keep the forward migration,
explicit demo policy and all financial history; do not reverse or delete invoices,
ledger entries or settlement evidence. Ignored sanitized runtime receipt:
`test-results/demo-settlement-live-receipt.json`.
