# Durable invitation image jobs — backend verification

Date: 2026-10-20, Asia/Saigon. Base: `7e31f84`; branch:
`codex/invitation-image-jobs`. Owner authorized backend option B after reviewing
the frontend timeout proposal. Implementation and API hand-off:
[durable invitation image jobs](../../docs/invitation-image-jobs.md).

## Scope and safeguards

The additive API persists a job before returning 202. A PostgreSQL worker invokes
the existing generation and derive services outside the HTTP request. It preserves
paid-intent idempotency, private upload journals, current session/account/booking
authority, cutoff/quota checks and Manager evidence-backed reconciliation. Completed
jobs are included in paginated reads so frontend reload can find accepted results.
The existing synchronous generation response remains 201.

No frontend files, historical commercial records or applied migrations were changed.
No shared database, real provider, paid generation, payment or deployment was
used to manufacture acceptance. The dispatch flag defaults false. Live provider
and rollout acceptance remain **AIJ-OPS-01**, separate from local implementation.

## Disposable PostgreSQL and Windows console correction

Native PostgreSQL 18.6 ran on task-owned loopback clusters, with synthetic fixtures
and controlled AI/Storage providers. The final cluster uses port 55457, 128 MB
shared buffers and default durability settings. Prior interrupted runs on ports
55455/55456 are not accepted as full-suite evidence. The 55456 speed profile had
durability settings disabled and establishes no crash-durability claim.

The earlier direct detached `postgres.exe` launcher incorrectly allowed PostgreSQL
child consoles to appear. Closing a child console caused PostgreSQL to recreate
its processes; the logs recorded Windows exception `0xC000013A` and reinitialization.
That task cluster and its test run were stopped. Existing PostgreSQL processes
created before this task were left untouched.

The replacement launches `pg_ctl` inside PowerShell started with
`Start-Process -WindowStyle Hidden`, without `-Wait` on the background process tree.
The server and a child process were individually checked: both attach to the same
console handle, and `IsWindowVisible` returns false. The new cluster reached ready
once, without the earlier console-close/reinitialization loop. Keep this inherited
hidden console when starting local PostgreSQL; hiding only a detached Node-spawned
parent was insufficient. These temporary QA launchers are local artifacts, not
application runtime dependencies or registered Windows services.

All three task clusters (ports 55455, 55456, 55457) are now stopped. The final
cluster stopped gracefully with exit 0 after checking both its PID file and the
connected server's data directory. No listener remains on these task ports. Raw
QA artifacts are retained locally under ignored
`.local-demo/invitation-image-jobs-validation/`; they are not part of the PR.

## Regression and review evidence

- Focused native-DB, controlled-provider, runtime/config and worker run: **159
  passed, 0 failed, 0 skipped**. Cases include current authorization, short-lived
  access expiry, revoked original session, same-key replay/body mismatch, completed
  listing, HTTP compatibility, admission limits, claim races, private journal/restart
  recovery, derive-only retry, provider failures, prompt expiry, Manager abandonment
  and RLS/client privilege denial.
- Storage acceptance regression: before the fix, a 502 after accepted generation
  incorrectly produced FAILED; the regression expected RECOVERY_REQUIRED and failed.
  After correction, recovery reuses the accepted image and does not buy another one.
- Expiry/Manager race regression: a deterministic interleaving showed an expiry
  sweep resurrecting an already-abandoned job. The original test failed; cleanup
  now compares both observed status and non-null operational input before updating.
  The focused run passes with Manager's FAILED/AI_JOB_ABANDONED result preserved.
- Mutation experiment: remove the worker's active-run overlap guard. The overlap
  test fails. Restore the exact source bytes and both worker tests pass. Original
  and restored SHA-256:
  `6b60d2a9e82cb0475491b0ac51607e92ae2db67321659f2f10bdc9703dd1b81d`.
- The expiry test also detects a real mutation: remove both observed-state/input
  comparisons and its business assertion fails. Restore the exact source and it
  passes. Original/restored service SHA-256:
  `fa6d9aa03a29a13884a7483d8fd9cbe34cf5812be2f1eebaa964732ff8e3ecf6`.
- Review covered authorization/input boundaries, bounded polling/cleanup/admission,
  no DB lock during external work, token fencing, privacy, provider replay and
  additive/backwards-compatible contracts. No quality thresholds, old assertions,
  existing test selection or existing migration files were weakened.

## Migration and contract integrity

All 64 migrations apply to the fresh native task database. SHA-256 comparison with
the base confirms all 63 previously applied migration files are unchanged. New
migration `20261020130000_invitation_image_jobs` SHA-256:
`5f970582a7979c738aaa696a139ba13c3c349ccd025cba1cb9067e836aa97157`.
Tests verify private table RLS and denial of client-role SELECT/TRUNCATE privileges,
including row invisibility if a test explicitly grants SELECT.

Generated OpenAPI SHA-256 matches the pinned digest:
`20a3df4acd167d625b7ab053eeb5b57fb315d67ef8e77a98e204021c5da1164b`.
Contract suite: **99 passed**. API generation/check both pass. A whole-schema Prisma
diff also reports older hand-authored constraints, foreign keys and partial indexes;
it is not globally drift-free. The new job table is absent from that diff. No
generated drift SQL was applied and no historical migration was rewritten.

## Final quality gates

PR: [#82](https://github.com/WDP301-wedding/wedding-be/pull/82), kept in draft for
owner review. [Backend CI run 240](https://github.com/WDP301-wedding/wedding-be/actions/runs/39441752927)
is successful on exact source `fea8e8bf161b03a15792abab7e8d8ad23462c160`, using
PostgreSQL 17.11 and the repository's unchanged workflow and coverage thresholds:

| Gate | Result |
| --- | --- |
| Formatting, full lint, typecheck, build, OpenAPI check, dependency audit | Passed |
| Unit tests | 165 files, 1482 tests passed |
| Contract tests | 23 files, 99 tests passed |
| Native PostgreSQL integration | 114 files, 679 tests passed |
| Full suite with PostgreSQL and coverage | 302 files, 2260 tests passed |
| Overall coverage | 97.58% lines, 93.60% branches |
| Per-file gate | Existing 80% lines and 80% branches passed |

The [machine-readable receipt](./invitation-image-jobs-2026-10-20.json) records
the verified source, CI run, counts, digests and local PostgreSQL shutdown scope.

No skipped tests or lowered thresholds contribute to these counts. Local final
repository formatting, full lint, typecheck, production build, OpenAPI check and
the actual `npm run audit:ci` also passed. Local full-coverage attempts were stopped
and are not accepted as completed runs; full-suite acceptance comes from the CI
run above. The local focused 159-test run and both mutation proofs completed.

The first CI run on `a9807b6` caught one test-adapter defect: assigning a brand to
the native Promise's read-only Symbol.toStringTag threw before the expiry-race
assertion. A typed thenable wrapper fixes that adapter in `fea8e8b`; no assertion,
scenario, runtime safeguard or quality gate was removed. The repaired test passes
both integration and coverage on CI, and detects the cleanup mutation locally.
An initial direct audit-script invocation also failed because it lacked npm
execution context; the actual npm command passed without changing dependencies
or suppressing findings.

The final documentation checkpoint records these results; it does not change
runtime source. Live provider calls, production migrations, deployment, frontend
adoption and merge authorization remain separate from this implementation proof.
