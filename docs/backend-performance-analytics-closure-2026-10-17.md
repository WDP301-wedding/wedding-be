# PERF-10 Analytics verification plan — 2026-10-17

Status: in progress; PERF-10 is not closed. Earlier evidence and the production
`NO_GO` decision remain unchanged. This work is backend-only and does not authorize
paid generation, real-money transactions, business-history cleanup, an APAC move
or enabling endpoint deadlines.

The owner explicitly authorized branch `codex/perf10-analytics-verification`,
commit/PR and Railway/demo deployment after exact-head CI/review. The owner also
authorized a dedicated temporary Railway SSH key for native runtime measurement,
with mandatory revocation afterwards. Its private key remains in ignored operator
configuration; only its public discovery file is placed in the local SSH directory.

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
