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

Final full-suite/coverage receipts are recorded below when complete. Final
whole-repository lint, typecheck, production build and OpenAPI check passed on
the implementation in `67e985a`. `npm run audit:ci` passed without high or critical
findings. An initial direct audit-script invocation failed because it
lacked npm execution context; it was corrected by invoking the actual npm command,
without modifying dependencies, suppressing findings or weakening the audit.
