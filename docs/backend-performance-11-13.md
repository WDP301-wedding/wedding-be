# PERF-11–13 backend handoff — 2026-10-16

This change continues the PERF-06–10 code in PR #48. The active Railway deployment
is still `0c9f9cd8-1e38-4855-b2a2-84a232bbbdd5`, source
`03b9a6be46bc11488b3de5bb56270cb008dd884e` (PERF-02–05). Candidate measurements,
the deployed baseline and live provider/readiness acceptance remain separate.
No region, service variable, deployed code or applied migration is changed here.

## PERF-11: connection budget and explicit read deadlines

Subsequent [2026-10-17 actual verification](backend-performance-11-verification-2026-10-17.md)
records observed overlap, queue/cancellation and authenticated provider findings.
Verification is complete; aggregate provider headroom acceptance remains HOLD.

The later authorized [pool trial result](backend-performance-11-pool-result-2026-10-17.md)
records the selected Catalog3/Analytics2/six-other1 profile and counted owner overrides.

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

The implementation follows the documented
[node-postgres pool acquisition/size settings](https://node-postgres.com/apis/pool)
and PostgreSQL's
[statement timeout](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-STATEMENT-TIMEOUT)
and [read-only transaction semantics](https://www.postgresql.org/docs/17/sql-set-transaction.html).
It does not treat a client-side `query_timeout` rejection as proof that server SQL
has stopped.

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

## Measurements recorded

[The sanitized receipt](../tasks/evidence/perf11-13-measurements-2026-10-16.json)
includes p50/p95/min/max, every status distribution, initial probes, page counts,
client/backend timings, artifact digests and limitations. Raw filtered samples and
request logs remain in `output/perf11-13-20261016/`.

- The unchanged deployed baseline completed 19 cases × 20 steady samples: **380/380
  HTTP 200**, plus 19 separate initial probes. The bounded workload completed six
  cases × 20 samples × reader caps 1/2/4: **360/360 HTTP 200**, plus 18 initial
  probes. All 17 session renewal/final revocations returned 204. **811/811** GET and
  session operation IDs matched sanitized application completion logs.
- Deployment ID/source stayed unchanged. All 15 selected domain-table counts and
  SHA-256 digests matched before/after and the retained pre-PERF-46 snapshot:
  Booking, Guest workspace/plan/list/groups/history, Seating plan/revisions, Staff
  settings/assignment/history/check-ins, contract revisions, final invoices and
  ledger. Session/audit and derived Analytics projection lifecycle are outside
  these domain digests. No new fixture, payment or cleanup was performed.
- The three native pool-max=3 stages each compared 20 samples per variant across
  nine cases. All normalized results matched the pinned baseline. Native model
  p95 increases under four simultaneous readers; the pool's queue is an intentional
  tradeoff, not a throughput claim.

| Native current case        | p95, 1 reader ms | p95, 2 readers ms | p95, 4 readers ms | Commands/request |
| -------------------------- | ---------------: | ----------------: | ----------------: | ---------------: |
| Templates, 20              |           190.51 |            189.08 |            281.02 |                4 |
| Requested print orders, 20 |           237.46 |            237.23 |            329.36 |                5 |
| Populated inbox            |           236.24 |            282.26 |            421.10 |                6 |
| Populated unread           |           188.73 |            235.38 |            328.57 |                5 |
| Halls with 20 media assets |           143.97 |            142.55 |            190.66 |                3 |
| Analytics warm service     |           281.68 |            297.77 |            515.98 |                6 |

These timings model 40 ms per driver submission with real PostgreSQL persistence
and fake Storage signing. The safe-read opt-in cost was measured separately with
one hall, no added delay and pool max=1: 20 alternating samples each, 1 → 5 driver
commands; local p95 1.63 → 5.49 ms. Across a remote connection, the four extra
commands are the material cost. The flag therefore remains off pending a reviewed
provider-specific rollout.

`tasks/evidence/performance-regression-budgets.json` enforces single-reader driver
command ceilings in the normal native integration test. Its modeled latency
investigation bands allow roughly 25% over repeated p95; they are observational,
not CI wall-clock failures or a Railway SLO. Shared Railway measurements varied
materially even on unchanged code: halls p95 0.712 seconds in the 19-case baseline
and 3.004 seconds in the one-reader mixed fixture stage. Billing's one-reader p95
was 3.780 seconds and four-reader p95 6.461 seconds. Record both distributions;
do not infer a candidate speedup or stable absolute live budget from them.

Analytics's initial probe took 11.854 seconds; steady p95 was 3.155 seconds but its
maximum was 11.734 seconds. All observed source statuses were READY. Changing
generations and a concurrently running scheduler prevent attributing those
durations exclusively to GET refresh. The receipt retains the entire observed
generation sequence and maximum, rather than dropping the slower path.

## Rollout, rollback and acceptance

Before rollout, require exact-head CI: typecheck, formatting/lint, unit/integration/
contract tests, unchanged per-file 80% lines/branches, API generation/check, build,
audit and migration rehearsal when applicable. This change adds no migrations.
Replay revocation, reader/writer, immutable history and idempotency regressions.

The first integration CI run exposed a test-harness pool dependency: an artificial
blocker occupied an application slot, and the helper also queried lock waiters
through that pool. The helper now uses a dedicated bounded test-only connection
for both the artificial blocker and its observer. It still requires both competing transactions to reach their locks,
and retains every monetary/idempotency/history assertion. Runtime pool limits,
test deadlines and coverage thresholds were not relaxed.

Local verification on Node 24.21.0/PostgreSQL 18 passed the 33-case commercial API
suite after that correction, including the full-contract withdrawal/timeline,
same-source finalization and adjustment/payment races. The focused pool/deadline
plus unit suite passed 27 cases; a later unit/contract run passed 67 cases (49
contract cases). The production build, API generation/check, typecheck, tracked
source lint and dependency audit passed. OpenAPI remains unchanged. Final PR CI
is the required full-suite/per-file-coverage acceptance record; local focused
success alone does not substitute for it. Earlier failed attempts remain in the
local evidence directory.

Deploy only with the owner's separate authorization. First verify the declared
process/provider allocation with the deadline flag off, then capture bounded
queue/active/wait metrics and matched fixture counts. A separate opt-in rollout
must validate hall deadline behavior through the actual pooler and its latency
cost. On unexpected errors/queues/latency, stop probes and revert to the prior
reviewed deployment; retain all domain/provider evidence. Do not restore default
pool max=10 in the new code without a larger validated capacity budget.

Pre-rollout checkpoint: PERF-11 and PERF-13 live-candidate acceptance stays open
until the optimized code is deployed and measured. PERF-12's review is complete;
cleanup is not authorized.
Assigned-Staff event-window success, container DB timing/region confirmation and
external provider/readiness RV gates remain open. The existing product **NO_GO**
decision is unchanged by code, configured credentials, health 200 or offline tests.

Subsequent owner-authorized merges, deployment, matched live measurements and
separate diagnostics are recorded in the
[Railway rollout receipt](backend-performance-railway-rollout-2026-10-16.md).
That record supersedes the undeployed-candidate status above. It preserves the
older baseline and keeps unproved latency, cancellation and provider gates open.
