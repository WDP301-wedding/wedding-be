# PERF-02–05 implementation and measurement hand-off

Date: 2026-10-16 (Asia/Saigon). Implementation checkpoint; exact-head CI receipts
belong to the accompanying draft PR. Backend scope only. No migration, production
deployment, production-region switch, AI generation, email delivery or real-money
payment was performed in the initial implementation checkpoint. The subsequently
authorized Railway synthetic-fixture follow-up is recorded
[separately](performance-railway-fixture-2026-10-16.md). Existing provider acceptance
and the product NO_GO decision are unchanged.

## Acceptance boundaries

| Task    | Delivered locally                                                                                                                                        | Remaining acceptance                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PERF-02 | Native-owner synthetic fixture, initialized Group/Guest/Seating/settings, assigned Staff, eight-family HTTP measurement and private-config runner        | Owner subsequently authorized a Railway synthetic fixture. See the follow-up receipt; successful assigned-Staff reads still require a valid event window.                          |
| PERF-03 | Opt-in request-correlated driver/acquire/lock-command timing, pool observations, event-loop observation, safe DB probe and pool-context regression tests | Deploy approved instrumentation to a test target; measure container→DB RTT and attribute real slow request families. Pure server execution and lock wait require DB-side evidence. |
| PERF-04 | Two matching region profiles, controlled experiment and rollback runbook                                                                                 | Provider-confirmed DB region, authorized temporary services and repeated matched US West/APAC receipts. No region winner is claimed.                                               |
| PERF-05 | Joined/narrow Identity authority reads and narrow/empty-grant Couple overview reads; revocation and concurrency tests                                    | Same-topology authenticated Railway p95 improvement target (initially ≥30%); exact-source broad quality/coverage gates.                                                            |

These are partial implementation receipts, not four completed live-performance
tasks. Canonical PERF checkboxes remain open until their full acceptance evidence
exists. The former plan's “measurement only” status describes its earlier audit;
the owner's current request authorizes this backend implementation.

## PERF-02 fixture and runner

`performance-booking-cases.ts` extends the existing disposable commercial API
harness. Consultation, proposal, slot, timeline/contract approval and synthetic
manual-accounting commands go through their existing owner APIs; no settled-row
injection or direct FULL grant is added. Synthetic local accounting proves code
behavior only, never a real cash receipt or provider settlement. No such fixture
was created in a shared database during that initial checkpoint. The later
owner-authorized Railway fixture uses clearly labeled synthetic manual accounting
through the existing API, not provider or real-money settlement evidence; see the
separate follow-up. No direct settled-row or FULL-grant insertion was used.

Guest/settings initialization, explicit opt-in named check-in, Staff assignment,
compatible Seating selection/confirmation and one invitation are setup work.
Measurements follow setup and retain the initial probe separately. Workspace,
Staff configuration, current Seating pointers, audit and owner-history counts are
compared before/after the reads, so lazy repair cannot silently enter the sample.
Check-in counts and planning/money remain separate; no check-in is recorded by
the measurement.

Reproduce the focused local test against a disposable loopback administrator:

```powershell
$env:TEST_MIGRATION_DATABASE_URL = '<loopback test administrator URL>'
$env:NODE_ENV = 'test'
$env:PERF_SAMPLES = '20'
node node_modules/vitest/vitest.mjs run tests/integration/commercial-contracts-api.test.ts -t PERF-02 --maxWorkers=1
```

The test creates/drops only its unique local database. Its sanitized result is
`test-results/performance/booking-local.json`. The default integration run uses two
steady rounds to verify the fixture/read invariants; the explicit measurement run
uses twenty. Timing thresholds are not added to noisy local CI tests.

The complete 20-round rerun passed, including cleanup, on the pinned Node 24.21.0
runtime with one fork worker. All 160 steady responses were HTTP 200 and matched
request-correlated DB observations. Planning, ledger rows, contract/invoice
revisions, workspace/configuration pointers and owner-history counts were unchanged.
Local server p95 ranged from 52.50 ms for billing to 251.56 ms for assigned Guest
search. Actual driver commands were constant per family: groups/guests/planning
18, current Seating 30, layout options 27, invitations 23, billing 15 and assigned
search 54. These light-load loopback numbers are not Railway performance budgets.

For an already initialized, owner-authorized live fixture, put this structure in
an ignored private file. Use real IDs/receipt values and credentials privately;
do not commit them or place tokens in evidence:

```json
{
  "origin": "https://authorized-test-origin.example",
  "synthetic": true,
  "initialized": true,
  "bookingId": "00000000-0000-4000-8000-000000000001",
  "deploymentId": "operator-confirmed-deployment-id",
  "commit": "0000000000000000000000000000000000000000",
  "syntheticSearch": "Khách",
  "credentials": {
    "couple": { "email": "provided privately", "password": "provided privately" },
    "staff": { "email": "provided privately", "password": "provided privately" }
  }
}
```

Set `PERF_FIXTURE_CONFIG` and `PERF_OUTPUT`, then run
`node scripts/backend-performance.mjs`. Output creation is exclusive to preserve
existing evidence. The runner logs in/out through the session API, takes 20 steady
samples per family, renews sessions during long runs, stops on any unsuccessful
GET and retains partial results. Tokens, response payloads, names, credentials and
search terms are not stored. Match request IDs to exact-deployment logs separately;
the configuration receipt is supplied by the operator, not independently verified
by the runner. Its initial reads can initialize/repair an incorrectly selected
fixture, so the owner's initialized-fixture precondition is mandatory.

## PERF-03 telemetry semantics

`DB_DIAGNOSTICS_ENABLED=true` opts into instrumentation at application/client
construction. Default is disabled. No metrics route or public diagnostic headers
are added; the existing protected metrics endpoint keeps its token requirements.
Bounded numeric aggregates are attached to the existing normalized-route/request-ID
completion or abort log. SQL text, values, errors, identifiers and credentials
are not logged by this instrumentation. State is per request and has constant
size; no SQL-query list or cross-request authority cache is retained.

| Log field                            | Meaning and limits                                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queries`, `errors`                  | Actual `pg` query submissions/errors, including transaction control and failed statements. No Prisma-event/driver-count equivalence is assumed.                            |
| `acquires`, `acquireMs`              | Pool acquisition attempts and elapsed acquire time, including initial connection/TLS establishment. Not pure queue time.                                                   |
| `queryRoundTripMs`                   | Sum from driver submission to response, after pool acquire; includes network, server execution, server locks and any client-query queue. Concurrent durations can overlap. |
| `lockRoundTripMs`                    | Subset of query time for advisory/row-lock SQL, not measured pure lock wait. Never add it again to query time.                                                             |
| `maxActive`, `maxIdle`, `maxWaiting` | Maximum observed counts in any one touched pool around acquisition; not a process-wide sum or continuous gauge.                                                            |
| `eventLoopDelayProcessMaxMs`         | Process-wide maximum since diagnostics middleware construction, sampled at response completion. Not request-exclusive event-loop delay or CPU time.                        |

`DiagnosticPool` wraps clients once and restores AsyncLocalStorage context when
queued callbacks are invoked from another request's `release()`. Both pg promise
and callback styles, transaction controls, error propagation and concurrent
request isolation have regression coverage. Pool settings and deadlines are unchanged.

Run `scripts/performance-db-probe.mjs --container` inside an approved Railway
container to produce 20 bounded read-only `SELECT 1` samples and aggregate
`pg_stat_activity` wait categories. The container mode requires Railway region
metadata. Running on a desktop is explicitly labeled “operator machine”. Neither
ping nor aggregate wait categories yield request-specific server execution time.
Use a bounded DB-side lock sampler and sanitized EXPLAIN/statement statistics for
that next attribution step; do not infer execution time by subtracting desktop RTT.

## PERF-05 behavior and local comparison

Identity's owned reader selects only credential/session/account status, expiry,
IDs, display email and role values in one parameterized query. It binds the token
hash and quotes the schema registered by `createPrismaClient`; schema-isolated
migration tests do not accidentally read public tables. Plain default clients
use `public`. No global Prisma relation-join preview is enabled, so unrelated
modules retain their existing query strategy.

Outside a transaction this is a preflight read. Within a Booking scope, the
reader captures only reference IDs, keeps Account → ordered role rows → Session →
credential share locks, then runs the joined read again. It rejects a reparented
session/account and preserves the post-lock check. No authority is reused across
requests. Concurrent revocation tests require the reader to actually wait behind
each writer and then observe the committed disable/revocation/role removal.

Couple overview returns the same empty envelope without issuing a Booking query
when there are no grants. Populated pages retain grant filtering, Android rules,
cursor/order and response schema, while selecting only the used Booking fields,
hall name and approval timestamps. This does not add or remove authority rechecks.

Local matched Identity resolver comparison: one fixed synthetic principal, same
driver/pool/database, alternating legacy/candidate order, three repetitions × 20
steady samples. The legacy query shape is captured from `5b25362`; response
authority fields match (roles compared as a set).

| Added driver-delay model | Legacy p95 | Joined p95 | Commands |
| ------------------------ | ---------: | ---------: | -------: |
| 40 ms/command            |  243.47 ms |   63.19 ms |    4 → 1 |
| 100 ms/command           |  478.24 ms |  122.89 ms |    4 → 1 |

The 100 ms model improves p95 by about 74%; repeat p95 ranges are 468–479 ms
versus 121–123 ms. This supports retaining the optimization locally, not a
Railway p95 claim. The no-delay attempt is noisy and is not an SLA. Five alternating
200-read batches with diagnostics off/on were also retained; their variance
overlaps and does not support a precise production overhead percentage. Do not
interpret an observed negative overhead delta as an instrumentation speedup.
This driver-level experiment excludes HTTP log serialization and event-loop
sampling overhead; their target-runtime cost remains a live measurement gate.

Local raw comparison and failed/partial gate logs are retained under
`output/railway-api-performance-20261016/`. The first booking timing run completed
160 successful steady responses and unchanged data, but its cleanup hook timed
out while parallel compiler/lint/tests competed for resources. That overall run
is retained as failed evidence. A thread-worker attempt subsequently exited with
Windows status `0xC0000409`, and another fork attempt timed out in cleanup. The
later pinned-runtime fork runs passed at two and twenty steady rounds, including
cleanup. No timeout/coverage threshold was lowered. A broad contract attempt also
exited without a successful summary; the new CLI's two focused tests passed and
the complete suite still requires its own final receipt.

The subsequent full Windows coverage attempt recorded a 30-second timeout in the
existing actual Manager-bootstrap CLI test. That failed run was stopped without
a successful full-suite or per-file coverage receipt. The Linux CI gates on the
draft PR remain authoritative for their exact commit; no check/test/threshold was
removed to turn a local failure into a pass. Source lint identified one unbound
method in the new pool wrapper; binding the pg client fixed it, and changed-file
lint passed. The local `output/` directory contains pre-existing throwaway source
archives and is excluded from local lint selection, never from committed CI source.

## PERF-04 and next live checkpoint

Use [the concrete region rollout and rollback](performance-region-experiment.md).
At the initial checkpoint no authenticated live fixture was available (owner
response: “chưa có”), and an SSH attempt did not complete. The owner subsequently
provided test accounts and authorized the
[Railway fixture and baseline follow-up](performance-railway-fixture-2026-10-16.md).
That synthetic fixture does not close provider acceptance or the assigned-Staff
event-window gate. Container timings, provider region confirmation, temporary
deployments and matched baseline/candidate latency remain unverified. The active
deployment snapshot is still
`b1b875c0-25d8-4bcf-a6fe-2484bbb25c74` / `5b2536212e9a6feafbb48d9a71bba1f90ded08ae`.

Reference for pool observation semantics:
[node-postgres Pool API](https://node-postgres.com/apis/pool).
Reference for joined query alternatives reviewed while choosing the scoped raw
query: [Prisma v7 relation queries](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/relation-queries).
