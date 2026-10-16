# PERF-11–13 backend handoff — 2026-10-16

This change continues the PERF-06–10 code in PR #48. The active Railway deployment
is still `0c9f9cd8-1e38-4855-b2a2-84a232bbbdd5`, source
`03b9a6be46bc11488b3de5bb56270cb008dd884e` (PERF-02–05). Candidate measurements,
the deployed baseline and live provider/readiness acceptance remain separate.
No region, service variable, deployed code or applied migration is changed here.

## PERF-11: connection budget and explicit read deadlines

Every runtime `createPrismaClient` now supplies `max` and
`connectionTimeoutMillis` to the normal and diagnostic PostgreSQL adapters.
Defaults are **3 connections per owner pool** and **2 seconds for acquisition**.
The budget is checked before constructing the adapter:

```text
(8 owner pools × DB_POOL_MAX + 1 readiness) × DB_PLANNED_PROCESSES
  + DB_CONNECTION_RESERVE <= DB_MAX_CONNECTIONS
```

Defaults are `(8 × 3 + 1) × 2 + 10 = 60`. The second process budgets rollout
overlap; it does not enable HTTP replicas. `BACKEND_REPLICA_COUNT=1` remains
required by the process-local rate limiter. In-process Notifications workers use
the existing owner pools. Any separate worker, retention/bootstrap CLI, old/new
deployment overlap or replica sharing the database must be counted in planned
processes. Dedicated processes are conservatively charged a full 25-connection
budget. Operator/provider/migration connections consume the reserved ten; this
is a declared allocation, not automatic discovery or proof of provider headroom.
Adding owner runtimes requires updating the explicit eight-pool calculation.

For three simultaneous processes, max=2 still needs 61 connections with reserve=10;
max=1 fits at 37. Increase neither declared database capacity nor pool size without
provider/topology evidence. The observed database limit is 60. Supavisor client
limits/backend multiplexing need their own verification; a PostgreSQL limit alone
does not establish the pooler's limits. Readiness retains its existing one-connection
pool and independent bounded probe.

The HTTP deadline now exposes an AsyncLocalStorage deadline and abort signal.
Only the public hall cursor and hall-page queries explicitly enroll through
`safeReadQuery`. With `DB_SAFE_READ_DEADLINE_ENABLED=true`, each enrolled callback
submits one database read in a PostgreSQL read-only transaction, with a local
`statement_timeout` calculated from remaining request time. The callback must not
call providers, submit multiple commands or start nested transactions. New work
is rejected after expiration/disconnect, and an expired result is not returned.
The existing 408 `REQUEST_TIMEOUT` contract is retained.

PostgreSQL's server timeout stops active SQL. A client disconnect prevents later
enrolled work; SQL already submitted remains bounded by its original statement
deadline rather than receiving an immediate cancel-protocol request. Pool wait is
bounded separately. Small scheduling/network transit differences are not a hard
real-time deadline guarantee. This uses no connection-wide timeout on mutation
sessions, no SQL-text classifier and no broad GET cancellation: Analytics and
lazy-initializing booking GETs can write and are deliberately unenrolled.

The flag defaults to **false**. Its safety cost is four additional driver commands
per enrolled read (1 → 5). Native local measurement and rollout conditions are
recorded with the PERF-13 evidence. Verify startup/session-setting support through
the selected provider pooler and accept the added round trips before enabling it.
Disabling the flag immediately restores the normal read path on the next request.

HTTP timeout/disconnect never establishes the outcome of a payment, provider call
or transaction already submitted. Their existing UNKNOWN, idempotency, settlement
evidence and reconciliation paths remain authoritative. No payment/provider logic
or immutable money history is rewritten.

## PERF-12: retention review

The [schema review](backend-schema-retention-review-2026-10-16.md) and
[145-table matrix](backend-schema-retention-matrix-2026-10-16.md) retain every public
table and all three rehearsal schemas. The 363 rehearsal tables have no approved
deletion. In particular, the RV-16 schema retains cited provider/UNKNOWN evidence.
The review contains an owner/dependency/backup/restore procedure for a future,
separately approved cleanup. There is no cleanup DDL or speed claim in this change.

## PERF-13: repeatable verification

`scripts/performance-regression.mjs` accepts an ignored private fixture
configuration through `PERF_FIXTURE_CONFIG` and exclusively creates `PERF_OUTPUT`.
It requires a pinned deployment/commit and initialized synthetic fixtures. Baseline
mode repeats the 19 original route/role cases; bounded mode uses selected existing
fixture routes at reader caps 1/2/4. Each stage has separate initial probes and
20 steady samples per case. Starts are spaced at least 750 ms, below 80/minute;
this is a bounded workload, not a saturation/capacity benchmark. Unexpected status,
transport failure, 429/5xx or latency above 25 seconds stops subsequent dispatch,
drains in-flight requests and revokes the runner's sessions without automatic retry.

The first live attempt stopped at the old Analytics refresh using an incorrectly
low 10-second abort threshold (the prior audit already observed about 13 seconds).
That failure and successful session cleanup are retained separately. The corrected
25-second guard remains below the existing 30-second HTTP deadline. HTTP 200 with
Analytics source readiness metadata is retained as such, not provider readiness.
Changing generation IDs observes a generation transition; it does not prove which
request or scheduler performed the refresh. Native tests measure warm/refresh
paths separately.

`scripts/performance-06-10.mjs` additionally supports `PERF_POOL_MAX=3`,
`PERF_READERS=1|2|4`, `PERF_SAMPLES=20` and explicit `PERF_CASES` for concurrent pure
reads. It compares identical native fixtures to pinned pre-change owner code,
normalizes generation IDs, retains all samples and counts real driver submissions
with a 40-ms-per-command local model. Run this harness separately from compiler,
lint and coverage because it exclusively creates then removes temporary baseline
source modules. Modeled latency is not a Railway latency budget. Per-request
command counts under concurrency may reflect Prisma cross-request batching;
single-reader command ceilings are the stable regression guard.

## Rollout, rollback and acceptance

Before rollout, require exact-head CI: typecheck, formatting/lint, unit/integration/
contract tests, unchanged per-file 80% lines/branches, API generation/check, build,
audit and migration rehearsal when applicable. This change adds no migrations.
Replay revocation, reader/writer, immutable history and idempotency regressions.

Deploy only with the owner's separate authorization. First verify the declared
process/provider allocation with the deadline flag off, then capture bounded
queue/active/wait metrics and matched fixture counts. A separate opt-in rollout
must validate hall deadline behavior through the actual pooler and its latency
cost. On unexpected errors/queues/latency, stop probes and revert to the prior
reviewed deployment; retain all domain/provider evidence. Do not restore default
pool max=10 in the new code without a larger validated capacity budget.

PERF-11 and PERF-13 live-candidate acceptance stays open until the optimized code
is deployed and measured. PERF-12's review is complete; cleanup is not authorized.
Assigned-Staff event-window success, container DB timing/region confirmation and
external provider/readiness RV gates remain open. The existing product **NO_GO**
decision is unchanged by code, configured credentials, health 200 or offline tests.
