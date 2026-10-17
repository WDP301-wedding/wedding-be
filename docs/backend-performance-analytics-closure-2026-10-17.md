# PERF-10 Analytics live verification — 2026-10-17

Status: measured, but **PERF-10 remains open**: the first natural-expiry
four-reader wave returned three HTTP 200 and one HTTP 500. The campaign stopped;
the failed request was not retried and the remaining two waves were not executed.
Earlier evidence and the production
`NO_GO` decision remain unchanged. This work is backend-only and does not authorize
paid generation, real-money transactions, business-history cleanup, an APAC move
or enabling endpoint deadlines.

The owner explicitly authorized branch `codex/perf10-analytics-verification`,
commit/PR and Railway/demo deployment after exact-head CI/review. The owner also
authorized a dedicated temporary Railway SSH key for native runtime measurement,
with mandatory revocation afterwards. Its private key remains in ignored operator
configuration; only its public discovery file is placed in the local SSH directory.

The dedicated key has now been revoked. A subsequent SSH command fails, Railway
lists no registered keys, and the owned public discovery file and ignored key pair
have been removed. No remote worker file was written. The temporary Analytics flag
has been restored to its original unset state; general DB diagnostics and read
deadlines remain off.

## Results and decision

Sanitized machine receipt:
[PERF-10 live evidence](../tasks/evidence/perf10-analytics-verification-2026-10-17.json).
PRs [#55](https://github.com/WDP301-wedding/wedding-be/pull/55) and
[#56](https://github.com/WDP301-wedding/wedding-be/pull/56) are merged after
exact-head CI/review. Their heads pass 1,992 and 1,996 tests respectively; the
runner merge also passes 1,996 tests and unchanged coverage, migration, audit and
OpenAPI gates. The telemetry merge first failed while pulling PostgreSQL from the
registry (`toomanyrequests: Data limit exceeded`), before checkout/tests. Its
unchanged-SHA rerun passed; that infrastructure failure is preserved.

Measured deployment `3fdf33f8-75ee-470e-a178-eea1b6a7257f` serves merge
`619c82d05cd84d09c03645b3fd21d890fa8f92d0`, image
`sha256:585178e09d695674d7af7ac26793abcd437d96a17466a20e16f1fade5e6cf475`,
on one SFO replica. Pools stay max 3/acquire 2,000 ms/idle 60,000 ms. The two
existing scopes remain; the measured Manager projection has **85 rows**:
20 each booking/billing/guest/staff, three invitation and two venue. The native
comparison reads unchanged source fences and returns zero changed source rows
on six actual owner pages per refresh. It is not a large mutation-feed benchmark.

| Gate                                                        | Observed result                                                         | Decision                                         |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| Native incremental refresh, 20 matched pairs per variant    | Baseline p95 10,081.847 ms; current 6,326.750 ms; **37.246% reduction** | Meets 30% target in this measured scope          |
| Warm HTTP, cohort 1, 20 same-generation READY reads         | Client/backend p95 2,152.607 / 1,446.739 ms                             | Client target **miss**, retained                 |
| Warm HTTP, cohort 2, 20 same-generation READY reads         | Client/backend p95 1,703.021 / 1,447.729 ms                             | Meets 2,000 ms target                            |
| All 40 warm reads, not a replacement for individual cohorts | Client/backend p95 1,940.448 / 1,447.222 ms                             | Aggregate meets target; no uniform-latency claim |
| Natural-expiry wave 1, four simultaneous readers            | Three 200; one 500 `INTERNAL_ERROR`                                     | **Fails** concurrent acceptance; stopped         |

All warm reads correlate to actual `warm` decisions and exact request logs.
Initial reads and unmeasured native pilot/warmup pairs are separate. Native
baseline/current ordering alternates; all twenty pairs preserve the same canonical
facts digest and source fences, remain READY, and have no overlapping application
scheduler/HTTP refresh interval. Native timings compare only the two pinned
projector/repository implementations with the same current real source readers;
they are not HTTP end-to-end refresh improvement or a whole-application rollback.

The failed TTL wave observed one HTTP refresh leader and **two** joined readers,
not three. The actual HTTP projector ran once, read six owner pages, then lost the
publication race to the already running scheduler and reported
`ANALYTICS_REFRESH_CONFLICT`; its three surviving GETs returned the scheduler's
new READY generation. The fourth request failed before an Analytics query
decision, with `PrismaClientKnownRequestError`, backend duration 2,365.202 ms,
request ID `3fddfc58-261b-4831-949c-99e2e83cad02`. Pool/interactive-transaction
acquisition contention is a **hypothesis**, not a proven error code or root cause:
existing secret-safe error logs record only the exception name. Do not call this
a four-reader coalescing pass or discard the failure because three reads succeeded.

Independent serial correctness checks pass: Manager access; Couple/Staff 403;
anonymous/revoked session 401; distinct pinned cursor pages and rejection after
filter changes; disabled check-in remains `NOT_RECORDED` with null attendance;
VND fields remain integers or null. Full CI also preserves post-refresh session
revocation, source-fence/cursor/failure fallback and private reporting boundaries.
These are not live fault injection, nonempty-delta throughput or provider proof.

The fifteen retained original business-table digests remain identical, all sixty
applied migration checksums match, 145 public tables remain, and the separately
approved historical Staff fixture still has zero check-ins. No source/business
history, provider funds, paid generation, startup command, region or deadline was
changed. Excluding only the intentionally temporary Analytics flag, the provider
configuration hash remains
`0360ba04dc6ac1e37617f90f33a850809e78589f7587de63cdd4c4b619006507`.

**Next:** reproduce the pre-decision concurrent Prisma failure with safe stage and
allowlisted error-code attribution; establish the root cause, add its regression
test, then review/CI a minimal fix before repeating all three four-reader natural-
expiry waves. Do not silently raise pool, timeout or freshness budgets. No further
optimization is included in this evidence checkpoint. PERF-10 and PERF-13 remain
open, and production remains `NO_GO`.

## Instrumentation slice

`ANALYTICS_DIAGNOSTICS_ENABLED` is strictly `true` or `false`, defaults to `false`,
and does not enable general DB diagnostics or request deadlines. Enabled structured
logs distinguish HTTP/scheduler/CLI, refresh start/completion, published/conflict/
failure, per-owner source-page/row counts and monotonic durations. Query decisions
distinguish warm, pinned, refresh leader and joined in-flight work. Scope IDs are
hashed; no source DTO, filter, credential, raw error or money payload is logged.
An observation sink failure cannot change the original result or error.

Focused tests first reproduced absent observations and scheduler entry-point
attribution, then passed after implementation. The instrumented unit suite passes
37 cases; two native PostgreSQL integration files pass seven cases, including a
four-reader/one-refresh observation and post-refresh session revocation. The new
observation modules meet the unchanged per-file coverage bar. A mistakenly broad
focused coverage invocation reported unrelated unexecuted files; it is not a
full-suite result, and no coverage configuration or threshold was weakened.

## Questions and evidence

1. Did an HTTP read execute a refresh, join existing work, or read a fresh/pinned
   generation? Count actual projector invocations, not returned generations.
2. Which refresh was initiated by HTTP, the scheduler or an explicit native
   benchmark? Retain successful publication, conflict and failure separately.
3. How many source pages ran per owner and how long did the incremental refresh
   take? Source rows, tokens, filters, monetary payloads and raw errors must not
   appear in telemetry.
4. Does a matched comparison demonstrate at least thirty-percent incremental
   refresh p95 improvement, while isolated same-generation warm HTTP reads meet
   the two-second client p95 experiment target?

## Ordered slices

1. Add opt-in, allowlisted Analytics observations and focused tests. Keep the
   existing refresh algorithm, HTTP scope/rechecks, scheduler cadence, checkpoint
   fences, cursor behavior and conflict propagation unchanged.
2. Review instrumentation and its overhead before any Railway/demo deployment.
   Keep DB diagnostics and safe-read deadlines off. New commit/PR/deployment work
   requires the owner's authorization; do not infer runtime proof from local tests.
3. Use the retained synthetic fixtures and real clocks. Capture deployment,
   image, pool settings, one SFO replica, source fences, fixture digests and all
   exact request/refresh IDs. Do not backdate checkpoints or disable the scheduler
   to manufacture a stale cohort.
4. Compare at least twenty matched incremental refresh samples per variant using
   immutable baseline source and current source at the same runtime/DB topology.
   Identify native projector timings separately from end-to-end HTTP timings;
   full rebuild POST is not incremental TTL-refresh cost. Determine the safe
   runtime benchmark mechanism before deployment, rather than adding an HTTP
   baseline switch or downgrading the entire application.
5. Collect separate warm HTTP cohorts and three four-reader natural-expiry waves.
   Classify by observed refresh/query events, not a client-side warm label.
   Keep scheduler collisions and nonqualifying attempts; never retry a failed
   command silently. State cardinality, background workload and all sample caps.
6. Close PERF-10 only if the actual evidence meets its targets and scope/cursor,
   source-ready, revocation, unknown-attendance and money correctness gates pass.
   An unmet target remains open; do not lower it or call every API faster.

## Native runner boundary

The operator-only runner transports two immutable Analytics modules from
`3c6e8984c547d92f25dc4959c44503321e5f5528` over the authorized temporary SSH
connection. It does not replace the serving application, expose a baseline HTTP
switch, persist credentials remotely, or modify service startup commands. Both
variants use the same current real owner readers, database, scope and one additional
bounded pool. This compares the incremental projector/repository implementation,
not an old whole-application deployment or HTTP refresh latency.

A single native process keeps its pool and module imports warm. An unmeasured
pair zero precedes twenty alternating-order matched pairs. Each pair waits for a
new READY publication with checkpoint age below ten seconds; the scheduler remains
enabled. Refreshes have a 25-second observation budget, pairs a 45-second budget,
and publication waits a 130-second cap. These checks stop subsequent work; they
do not cancel or retry an in-flight publication. Every completed/failed attempt
is emitted immediately. Any conflict, source-fence change, fact mismatch or budget
failure stops the campaign and remains in the evidence. Post-hoc application logs
must independently exclude scheduler/HTTP refresh overlap from qualifying pairs.

Each native sample records actual per-owner source calls, READY checkpoints,
projection-row count, canonical fact digest, request ID and generation ID without
source DTOs or raw failures. The runner rechecks the active Manager before each
phase. It must pass exact-head CI/review before live execution; contract tests
validate configuration/provenance, rendering and syntax without calling Railway
or a live database.

## Preservation

The five successful rebuilds followed by `409 ANALYTICS_REFRESH_CONFLICT` remain
an incomplete historical protocol. The supplementary warm cohort exceeding two
seconds remains visible. Earlier natural-stale samples are valid observations,
not retroactive refresh-invocation counts. Approved contracts, appendices,
finalized invoices, payment/idempotency/settlement evidence and applied migrations
are not modified by this verification.
