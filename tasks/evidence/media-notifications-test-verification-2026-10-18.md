# Media / Notifications test verification — 2026-10-18

Owner requested diagnosis and resolution of the failed test runs before merge.
Scope: backend tests and verification only; disposable local PostgreSQL on
127.0.0.1:55435, pinned Node 24.21.0. No live Storage, FCM, paid generation,
real-money operation, deployment or shared database migration is authorized by
this verification. The provider integrations in these tests are controlled doubles.

## Preserved failure evidence

Earlier whole-repository coverage attempts were interrupted after reporting
11/22 failed Media cases, 5/8 failed FCM cases, and a failed Automation case.
They did not reach the final detailed error report. Case durations alone do not
establish timeout type, pool exhaustion, insufficient memory, or a code defect.
The original failures remain recorded in the multi-menu extension evidence.
One previously isolated Media case and one Automation case passed; that did not
verify the rest of either file or any of the five FCM failures.

## Complete-file reproduction

Run the complete three files, retain output through process completion, and ask
Vitest for verbose output plus a machine-readable JSON report. `NODE_OPTIONS`
contains `--trace-deprecation` for this diagnostic command only. No timeouts,
assertions, test bodies, provider responses or coverage thresholds are changed.

```text
output/node-v24.21.0-win-x64/node.exe scripts/staff-operations.verify.mjs
  tests/integration/invitation-studio/media-native-providers.test.ts
  tests/integration/notification-fcm.test.ts
  tests/integration/notification-automation.test.ts
  --maxWorkers=1 --pool=threads --reporter=verbose --reporter=json
  --outputFile.json=output/media-notifications-diagnosis-results.json
```

The trace locates the overlapping-query deprecation in `pg.Client.query`, called
through `@prisma/adapter-pg`'s `PgTransaction.performIO/queryRaw` and Prisma's
query interpreter. A deprecation warning is not a failing assertion. It also
occurs in successful test cases, so it is not sufficient evidence of causation.
Do not patch the driver globally or change application authorization/money rules
to hide this warning.

Baseline CI: the pre-extension commit
`32a25a8bf0eed993b3de2fe73e116e38698cdb65` has a successful
[Backend CI run](https://github.com/WDP301-wedding/wedding-be/actions/runs/39084286438).
After fetching main, `origin/main` is merge commit
`9bbd251fa318abed8210e1b15aa72a825d7e9876`; `git diff origin/main HEAD` is empty
before staging the multi-menu changes. This is baseline evidence, not acceptance
of the uncommitted feature. Candidate CI must verify the feature itself.

Complete-file result: **34/34 tests in 3/3 files passed**, zero failed/skipped,
exit code 0 and clean teardown. Duration 240.49 seconds. All 61 migrations were
applied to disposable PostgreSQL. This includes all 22 Media, all eight FCM and
all four Automation cases; it is stronger than the earlier named-case diagnostics.
No product/test logic patch is justified by this reproduction. The original
interrupted failures are not erased or reclassified as successful.

A second complete-file run with V8 coverage also passes **34/34 assertions**, zero
skipped. It collects only MediaService, AndroidPushDispatcher and Scheduler for
diagnosis. MediaService branch coverage is 75.75% because this subset omits its
other unit/contract cases; the unchanged 80% threshold correctly makes that
diagnostic command exit 1. This is not claimed as coverage acceptance. Only the
complete repository test/coverage run can close the repository coverage gate.

The candidate is submitted as a draft PR for Linux CI to run every repository
test and the unchanged per-file coverage gates on the multi-menu extension.
Candidate CI results will be retained separately after completion. A clean run
would establish current candidate verification, not the cause of past failures.

## Confirmed historical-fixture defect and fix

The first candidate [CI run](https://github.com/WDP301-wedding/wedding-be/actions/runs/39092504565)
on `b519cb8bd6496440c2786a3d47527c7fba3b6306` passes static/unit/contract/build/audit
gates but fails seven populated-upgrade suites/cases with Prisma **P2022**:
`BookingProposalSnapshot.menus` does not exist. The detailed CI stack traces
identify six failures at `native-booking-fixture.ts` and one at the Billing
upgrade's `readHistory`. These are verified regressions from adding the schema
field, separate from the earlier interrupted Media/FCM/Automation runs.

Those tests intentionally populate an older schema before subsequent migrations.
The latest Prisma client's implicit scalar selection tries to read the new column
too early. Fix the shared fixture's lookup/update to return only the proposal ID
it needs. Billing's before/after history comparison explicitly omits the later
`menus` field while retaining every pre-existing field; it additionally asserts
that the fully upgraded historical row has NULL menus. All existing preservation,
authorization, migration and settlement assertions stay in place. No applied
migration, application money rule, timeout or threshold changes are needed.

RED evidence is the complete failing candidate CI report: 540 integration tests
passed, four failed and six skipped after three suite setup failures. The seven
affected files are Analytics upgrade, Guest security, Staff upgrade, FCM upgrade,
Notifications upgrade, Seating upgrade and Billing upgrade.

GREEN after the two fixture changes: **10/10 tests across all seven affected
files passed**, clean teardown and exit 0, on pinned Node/local PostgreSQL with
all 61 migrations. Duration 96.56 seconds. Command uses the same disposable
verification wrapper, all seven affected file paths, `--maxWorkers=1
--pool=threads --reporter=verbose`. Final complete CI is still required.
