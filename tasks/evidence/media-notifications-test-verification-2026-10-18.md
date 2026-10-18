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

The candidate is submitted as a draft PR for Linux CI to run every repository
test and the unchanged per-file coverage gates on the multi-menu extension.
Candidate CI results will be retained separately after completion. A clean run
would establish current candidate verification, not the cause of past failures.
