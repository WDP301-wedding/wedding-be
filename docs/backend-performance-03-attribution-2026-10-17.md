# PERF-03: request and database attribution

Measurement date: 2026-10-17 (Asia/Saigon). Request attribution is complete for the
sixteen measured read families in the admitted synthetic demo scope. Exact-source
Linux CI passed all 2,037 tests with unchanged quality gates. This is diagnostic
evidence, not an optimization, latency SLA or production-readiness decision.

The [sealed receipt](../tasks/evidence/perf03-db-attribution-2026-10-17.json)
retains every diagnostic request, matching completion logs, raw native timings,
sampled waits, baseline failure, deployment controls and cleanup. The
[measurement runbook](performance-03-measurement-runbook.md) describes the approved
temporary change. Earlier SPEC/RV and PERF evidence remains historical.

## Target and measurement

The experiment reused reviewed source `13fa708252a9e3d11a6a76998f60709b2e58166d`,
image `sha256:a029e36681f1b24950eabe022bd2a0cdc9c6b8d866658fd8a5faf516d6518460`.
The diagnostic deployment was `860b8a84-94e4-4a02-9bd0-f4c26fe08163`; both runtime
metadata and SSH program provenance identify the actual SFO container.

Only `DB_DIAGNOSTICS_ENABLED` changed temporarily. Common owner pools stayed 1,
Catalog 3, Analytics 2; acquire 2000 ms, idle 60000 ms and the existing 60-slot
budget/reserve remained unchanged. Deadline and startup-probe flags stayed false.
Workers, region, provider configuration, commands and source/image were preserved.

One initial request and three steady requests per family produced **64/64 HTTP
200 reads**. Two logins, two revocations, two denied token-reuse checks and the
disabled metrics probe bring the diagnostic campaign to **71/71 operations matched
to completion logs of that deployment**. No diagnostic command reported a query
error. Starts were spaced at least 750 ms; unexpected status, transport failure or
25 seconds stopped a campaign. Initial probes are retained separately.

The existing initialized booking was reused. No new business fixture, check-in,
companion rule, payment, provider generation/delivery or data deletion was involved.
Session/audit writes and normal derived Analytics publications remain distinct
from the unchanged business-history digests.

## Actual slow-request attribution

Each row selects the slowest of that family's three steady requests. Milliseconds
are from its exact completion log, not client wall time. The receipt supplies its
request ID, client timing, all other samples and numeric diagnostics.

| Family                     | Backend ms | Driver commands | Acquire sum ms | Query RTT sum ms |
| -------------------------- | ---------: | --------------: | -------------: | ---------------: |
| Identity                   |    157.730 |               1 |          0.049 |          156.066 |
| Couple overview            |    745.036 |               5 |        148.503 |          740.897 |
| Inbox                      |    921.643 |               6 |        153.139 |          915.451 |
| Unread count               |    768.163 |               5 |        153.317 |          763.527 |
| Invitation templates       |    898.554 |               6 |          0.350 |          892.695 |
| Print orders               |    899.768 |               6 |          0.374 |          892.294 |
| Analytics, heavier request |   9394.491 |              70 |       2143.932 |        11531.692 |
| Public halls               |   1146.234 |               3 |          0.137 |          444.703 |
| Public dishes              |   1129.371 |               4 |          0.206 |          592.796 |
| Guest groups               |   2684.367 |              18 |          0.114 |         2673.940 |
| Guests                     |   2681.600 |              18 |          0.176 |         2671.063 |
| Explicit guest plan        |   2681.632 |              18 |          0.129 |         2671.644 |
| Current Seating            |   4476.055 |              30 |          0.128 |         4606.574 |
| Seating options            |   4030.424 |              27 |          0.112 |         4158.731 |
| Booking invitations        |   3438.356 |              23 |        594.761 |         3416.678 |
| Billing                    |   2312.175 |              15 |          0.293 |         2303.963 |

The observed 148–156 ms container round-trip baseline and repeated commands
explain the dominant read pattern: approximately 0.75 s for five commands, 0.9 s
for six, 2.68 s for eighteen and 4–4.5 s for twenty-seven/thirty. This supports
investigating both geography and round-trip count. It does not allocate an exact
percentage to network versus business SQL execution.

The Analytics request submitted 70 commands versus eight in the lighter requests
(about 1.38–1.41 s). Its 11.53 s sum exceeds its 9.39 s wall time because commands
can overlap. This is request-correlated heavier DB work; generation changes alone
do not identify the winning publisher. Preserve the separate PERF-10 publisher,
refresh and warm-read evidence rather than relabeling this mixed cohort.

Warm acquisition is below 0.4 ms for many families. Overview/inbox/unread/invitations
also queue concurrent work in their small owner pools. First touches include about
one second of connection establishment. Acquire sums overlap other commands and
cannot simply be added to query sums. Catalog's remaining elapsed time includes
non-DB/provider work; it is not measured server CPU or a precise Storage duration.

## Locks, pool observations and event loop

Guest lock-command round trips are about 1.04 s and Seating about 1.63 s. These
are elapsed times of commands containing row/advisory locks, including their
network trips. They are a subset of query time, not an additional component and
not a measurement of pure lock blocking.

A separate read-only connection in the same container collected **180 fresh
`pg_stat_activity` snapshots** during the HTTP campaign. No sampled Lock waiter
or blocked backend was observed; peak client backends excluding the observer was 16. Observed waits were ClientRead, including idle-in-transaction sessions. These
are database-wide snapshots, not request-exclusive measurements; sampling can miss
short waits. They do not justify claiming zero lock wait for every request.

Per-request pool maxima describe a single touched pool at acquisition points.
The receipt records active/idle/waiting values; transient dispatch can appear in
`maxWaiting` and does not by itself prove exhaustion. The process event-loop
maximum was 49.414 ms, accumulated since middleware creation. It is not request
CPU time or request-exclusive event-loop delay.

## Container RTT, SQL execution and instrumentation overhead

Four native programs each retained twenty fixed `SELECT 1` RTT samples. Their
medians ranged from **148.328 to 155.732 ms**. They use the runtime direct endpoint,
not the operator's IPv4 pooler. A further twenty fixed `EXPLAIN ANALYZE SELECT 1`
reads reported server execution median/p95 **0.020/0.021 ms**, versus round-trip
median **155.753 ms**. These execution numbers describe that fixed probe only.

Both overhead experiments alternate on/off ordering across twenty measured pairs,
plus an excluded initial pair. Each retains raw fixed-read and health HTTP samples.

| Experiment, server timing                       | Off median/p95 ms |  On median/p95 ms |
| ----------------------------------------------- | ----------------: | ----------------: |
| Separate raw/diagnostic connections, fixed read | 156.340 / 157.107 | 149.658 / 150.625 |
| Shared diagnostic connection, fixed read        | 156.415 / 156.713 | 156.490 / 157.398 |
| Shared-connection apps, health without DB       |     0.457 / 0.771 |     0.444 / 0.863 |

The first experiment is preserved but its negative difference is not an
instrumentation speedup: the two connections had different base latencies. The
shared-connection follow-up controls that difference. Its fixed-read median delta
is **+0.075 ms**, p95 delta **+0.685 ms**; health p95 delta is **+0.092 ms**.
These are small observed differences in this bounded probe, not universal overhead
limits. The shared baseline still traverses an installed inactive driver proxy;
it measures active aggregation/ALS/logging separately from the full raw-pool
comparison. Both paired apps run in one process with the event-loop monitor
installed, so these differences do not isolate its process-wide cost. No
whole-route improvement is claimed from either experiment.

Metrics remained disabled on Railway: anonymous reads returned 404. Local enabled
metrics tests run with diagnostics both off and on: anonymous/wrong-token requests
are denied, valid-token responses remain no-store and normalized, and private data
and credentials are absent. No public diagnostic route/header was added.

## Preserved failures and limits

The pre-instrumentation baseline stopped on Current Seating HTTP 500 after
4185.115 ms client / 3959.203 ms backend, request
`bceabcf9-39c4-4b03-ac2a-68f133b4e76c`. All 35 attempted operations match that
deployment's logs; both sessions were revoked and rejected afterward. The generic
Error log cannot establish a root cause. Four later diagnostic Seating reads were
200, and native single-connection regressions passed; neither proves that the
intermittent error is fixed. Retain it for PERF-13 investigation and release risk.

Tooling checkpoints are also preserved: initial sandbox network/local DB denials,
local PostgreSQL startup recovery, an owned-key receipt-path correction before
registration, the revocation verifier's initial failure to recognize CLI stdout
`signup_required`, and a postflight read before log ingestion completed. The final
verification waits for matching logs; none of those setup failures is counted as
a passing measurement. An unsupported worker operation produced a RED contract
test, then was rejected before runtime imports/DB access. Removing that allowlist
again fails the contract test; the exact source was restored after the mutation.

Assigned Staff success remains the actual-window PERF-02 evidence; this run does
not fabricate a new event window. Provider DB region confirmation and APAC remain
PERF-04. Three steady samples per family do not close PERF-13's broader regression
budgets. Product/production status remains **NO_GO**.

## Verification and cleanup

Focused checks passed: 27 diagnostics/pool/logging cases, 19 disposable PostgreSQL
Identity/Seating/invitation cases, six metrics cases and five worker guard cases.
All sixty immutable migrations applied to the disposable foundation DB before the
native tests. The final worker also completed its forty-two fixed reads and
forty-two health reads against loopback PostgreSQL, explicitly labeled operator
evidence. Local typecheck, lint, production build, all 58 contract tests,
`api:generate` and `api:check` passed. Local lint excluded the pre-existing untracked
`output/` artifact tree; CI lint covers the complete committed tree normally.

The Windows broad run is **failed**, not waived or relabeled: 1,996 passed tests,
two failed tests, a runtime-foundation cleanup-hook timeout and three unexpected
worker exits (`3221226505`). The FCM failure was its disconnect hook; idempotency
failed connection acquisition. The raw log/hash is retained. Source/tests/thresholds
were not changed to erase these failures. The same source then passed
[Linux exact-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39030511075):
162 unit files / 1,435 tests, 20 contract files / 58 tests, 103 PostgreSQL integration
files / 544 tests, and 285 full-suite files / **2,037 tests**, zero skipped. Coverage
was 97.57% lines and 93.51% branches, retaining the existing per-file 80% gates.
OpenAPI, build, dependency audit and full committed-tree formatting/lint passed.

Reviewed source head is `6cd628f2440b50c24f199ecd8e2cab1f05a97998` in
[PR #62](https://github.com/WDP301-wedding/wedding-be/pull/62). Subsequent publication
changes add only this report, the sanitized receipt, runbook reproduction detail
and backlog disposition. They do not change the tested worker or application.
Final PR checks are separate from this immutable source-CI receipt. Merge remains
a separate action; completing PERF-03 does not authorize a production release.

All fifteen selected business-table digests and sixty migration checksums match
before/after; no owned probe connection remained. The dedicated key was revoked,
its transport returned signup-required rather than executing, and only its owned
local key/discovery files were removed. No remote file was written.

Restored deployment **`f0971da2-9e32-4e6b-a4d1-80fe3c423703`** is a single healthy
SFO replica of the same source/image, with diagnostics/deadline/probe false. All
other configuration hashes and service commands match. Postflight completion logs
match all five probes and contain no database diagnostics. Live/readiness/OpenAPI
return 200, anonymous Identity 401 and metrics 404. OpenAPI SHA-256 remains
`68a47cb4d43a0ea185ce3cd7c28928011c705bc6aa101f2f92a6261ec5cda694`.

References: [pg pool acquisition and counters](https://node-postgres.com/apis/pool),
[PostgreSQL activity/wait semantics](https://www.postgresql.org/docs/17/monitoring-stats.html).
