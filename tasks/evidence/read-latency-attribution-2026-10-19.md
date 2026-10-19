# Connection, lock and SQL attribution — Seating follow-up

## Outcome and bounded claim

The owner requested separate timings and a fix to the slowest endpoint, with a
GET side-effect audit before removing locks. The 38-route direct Railway HTTP
screen selected `GET /bookings/{bookingId}/seating-plans/{planId}` (median
4,992.84 ms, three steady screening observations). Current Seating followed at
4,965.26 ms, then layout options at 4,399.68 ms. The complete ranking, initial
probes and outliers are retained in `read-latency-20261019/http-screen.json`.
These small screening groups identify the candidate; they are not an SLA/p95
estimate, a controlled cold-cache test or an exhaustive ranking of every API.

The focused change preserves locks and cuts duplicate database round trips.
Twenty alternating same-container baseline/candidate pairs per route produced:

| Native owner operation | Baseline median | Candidate median | Reduction | Commands before → after |
| --- | ---: | ---: | ---: | ---: |
| Seating detail | 4,823.67 ms | 3,268.50 ms | **32.24%** | 31 → 21 |
| Seating current | 4,667.78 ms | 3,270.32 ms | 29.94% | 30 → 21 |

The native measurements invoke real owner compositions, include one actor
resolution matching router authentication, and compare identical DTO hashes.
They exclude public HTTP ingress/serialization and are **not a deployed HTTP
before/after result**. No new serving release was deployed in this campaign.
The selected detail endpoint meets the task's 30% median target; do not round
current's 29.94% into an independent passing claim. This does not close the
broader frontend-first website remediation backlog.

## Source, fixture and unchanged controls

- Serving baseline: `7b07d8bbf38e6a9808c08ab1642b2eb58e364a78`, Railway deployment
  `8333a351-49d2-497f-9cd8-ab146891fb6e`, SFO, Node 24.21.0. Image and module source
  SHA-256 values are in `source-and-controls.json`. Candidate source commits are
  `8592305`, `68e8b3d`, `9a216aa`; compiled modules were passed in memory to a
  one-off native worker, never installed into the serving app.
- Existing initialized synthetic developer fixture: Guest/Staff state present,
  Seating's observed Booking revision current, positive settled-deposit evidence.
  Raw credentials, token, fixture identifiers and SQL values are excluded from
  committed evidence. Payment control was inventory-verified MANUAL, SUCCEEDED,
  DEPOSIT; no VNPay reconciliation or paid/provider command ran.
- Ordinary pool max 1, catalog 3, analytics 2; acquire timeout 10,000 ms, idle
  60,000 ms; declared processes 2, reserve 36, database cap 60. Production
  diagnostics and safe-read deadline flags both remain false. No pool/deadline,
  placement, region, schema or frontend change was used to manufacture a win.
- One bounded native pool (max 1) plus one read-only observer used the two
  existing ordinary spare slots. The operator inventory connection closed before
  each worker started; no second app or background-worker composition was started.
  Native connections closed before the post-run operator inventory.
- Scoped business, catalog and migration counts/checksums matched before/after
  every HTTP screening round and native campaign. Normal test login/revoke was
  cleaned up (204, then reused token 401). This is not a claim of live external
  integration readiness or of whole-database immutability.

## The three timings

**Connection acquisition.** In the paired steady serial observations the median
instrumented acquisition total per operation was 0.138–0.152 ms, with no new
connections. Initial native acquisition was 1,101.90 ms and first-query wall time
1,318.69 ms; that includes connection establishment, not merely queueing.
Five two-reader cohorts per variant exposed the separate pool bottleneck at
max 1: request acquisition medians were 2,489.45 ms baseline and 1,710.32 ms
candidate. Their operation medians were 7,323.92 and 4,986.40 ms. The pool and
contention conditions remain in those raw observations, rather than being
removed as outliers. These ten-request cohorts are not a capacity benchmark.

**Locks.** Client `lockRoundTripMs` includes SQL/network time and is already a
subset of `queryRoundTripMs`; it is not server lock wait. Server-side
`clock_timestamp()` around each baseline advisory acquisition measured median
summed acquisition 0.0595–0.060 ms in the paired serial groups. Candidate's
Booking advisory acquisition was 0.008 ms; its combined lifecycle lock statement
was 0.059 ms median, including reference lookup and advisory/row fences. The
latter is not a pure advisory-wait metric.

Real contention occurred and is retained: the separate baseline campaign had
eight sampled advisory waits on one cohort request, with 2,091.456 ms on its
Booking advisory acquisition (2,092.182 ms summed advisory acquisition). The
paired campaign had 19 sampled lock observations on two baseline requests,
with Booking acquisition 2,330.286 ms and 2,425.606 ms. Its observer recorded
hashed blocker statements touching Booking, settlement and Seating/catalog
sources, often idle in transaction between round trips. This pattern is
compatible with the existing Seating reconciliation path, but process identity
was not traced and is not asserted. Candidate observations had no sampled Lock
event; a finite sample cannot prove the absence of short or future waits.

**SQL execution versus round trips.** Trusted ordinary SELECTs were separately
replayed as `EXPLAIN (ANALYZE, TIMING OFF, BUFFERS, FORMAT JSON)` on a read-only
observer: 13 baseline plans, max execution 0.243 ms; 14 paired-campaign plans,
max execution 0.348 ms. Captured client commands generally spend about
148–156 ms per network round trip (some Prisma relation reads require more).
That combination supports duplicate round trips as the dominant steady
median cost for this fixture. EXPLAIN excludes the lock statements, and is a
separate replay, not historical per-request server execution telemetry. Do not
subtract or add overlapping client timers to invent an exact wall-time partition.

## Change, safety and review

The [GET source audit](../../docs/read-get-side-effects-2026-10-19.md) identifies
Guest/Staff initialization, Seating repair/revision advancement, VNPay
reconciliation, and Analytics projection/export writes. Shared Booking reads
already existed in the serving baseline; the screenshot's blanket exclusive-GET
description is inaccurate. This follow-up removes **no advisory or row lock**.

Venue batches the same sorted lifecycle fences, then reads eligibility in a new
statement snapshot after acquiring them. A single-version read returns the full
immutable layout through the existing canonical validator. Seating reuses it and
the already-read head/revision. The Billing-owned reader reuses validated monetary
proof only inside one shared Booking transaction; dates are defensively copied,
missing/error results and write/unscoped/cross-request reads stay uncached.

Review checked correctness (including retirement while blocked), readable
orchestration, owner boundaries, parameterized SQL, retained scope/authority
checks, unchanged monetary invariants, and measured performance. The materialized
dependency chain is intentional: eligibility cannot reuse the snapshot taken
before a lock wait. Native regressions assert retained Hall and Template row
fences even against a writer bypassing advisory locks. Existing Seating repair,
stale/foreign and HTTP authorization regressions are retained. A manual mutation
inverting `isReadScope()` caused two proof-lifetime tests to fail; restoring the
condition returned all eight reader unit tests to green.

## Verification and reproducibility

Focused real-PostgreSQL source/Seating/HTTP and proof-reader checks passed (the
new native file now contains five tests). Formatting, full lint, typecheck,
OpenAPI check and build passed locally before evidence-only additions. A broad
Windows coverage attempt was stopped after discovering its newly created local
base database had not been migrated; it is not counted as passing. After local
migration, runtime-foundation's five tests passed; a busy local recheck still had
an idempotency pool-acquire timeout and notification cleanup-hook timeout.
Required Linux/PostgreSQL 17 exact-head CI remains the release gate; final CI
outcomes are recorded with the pull request. No timeout, pool cap, assertion,
coverage threshold or test was weakened to hide those failures.

Numeric raw operation/command samples, EXPLAIN receipts and every positive lock
observation are in `read-latency-20261019/{baseline,comparison}.json`; other wait
categories are retained as counts. HTTP samples, module fingerprints, fixture
digest, controls, inventories and summary calculations are adjacent. Even-N
medians use the arithmetic mean of the two central values; initial probes are
excluded. No SQL text, parameter, bearer token, cookie or personal value is stored.

`scripts/bench/read-latency-worker.mjs` preserves the one-off worker. It is an
operator-only harness, not an application entry point. It asserts the approved
deployment/region/caps/flags and fixed sample bounds, loads only trusted compiled
candidate modules by fingerprint, rejects write SQL, disables provider paths and
always closes its clients. The original transport passed configuration and token
via stdin over a temporary task-only Railway SSH key. A repeat requires an
explicitly selected synthetic fixture, a fresh ordinary session, a verified
connection budget, pre/post read-only inventory, and the same cleanup. Never put
credentials into arguments/files or run this against an unreviewed provider GET.

Official timing semantics: [node-postgres pool API](https://node-postgres.com/apis/pool),
[PostgreSQL advisory locks](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS),
[WITH materialization](https://www.postgresql.org/docs/17/queries-with.html), and
[EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html).
