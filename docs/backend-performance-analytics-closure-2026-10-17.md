# PERF-10 Analytics live verification — 2026-10-17

Status: **PERF-10 accepted in the measured backend demo scope** after the
owner-authorized contention fix and a separate successful live campaign.
[Final machine evidence](../tasks/evidence/perf10-analytics-closure-2026-10-17.json)
supersedes the initial open decision, not its preserved measurements/failures.
Production remains `NO_GO`; PERF-13 and other open PERF tasks remain open.

## Initial checkpoint — historical, preserved

The initial decision left **PERF-10 open**: the first natural-expiry
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

## Authorized contention fix — verified live

After the failed wave, the owner explicitly chose reproduction, a minimal
Analytics fix, CI/review and another live campaign. The preceding result and its
machine receipt remain immutable; they are not replaced with a passing retry.

A disposable native PostgreSQL regression reproduces `P2028` when four identical
HTTP snapshot loads compete for the unchanged three-connection pool. The harness
holds each bounded-read transaction for 2.5 seconds, independently of the serving
demo; no live sleep, injected failure or timeout/pool increase is used. This
establishes the acquisition-contention failure mechanism, not the unavailable
exact error code/stack of the earlier live request.

The minimal service-only change shares an **in-flight bounded projection load**
only when Manager scope, normalized read filter and load phase match. Initial
loads cannot join post-refresh loads (or vice versa), so a post-publication read
does not reuse an older pending snapshot. Settled success/failure is immediately
evicted. Responses, authority, sessions and completed warm snapshots are not
cached; every request retains its own freshness/invalidation and final authority
rechecks. Different scopes, filters and report-owner sets never share work.

Regression tests cover four readers, separate scopes/filters, rejection fan-out
and recovery, the pre-/post-publication race, and revocation of all four requesting
sessions while the shared load is pending. All 41 Analytics unit cases and nine
native PostgreSQL integration/privacy cases pass. PR
[#57](https://github.com/WDP301-wedding/wedding-be/pull/57) merged after exact-head
CI/review; its merge also passes 2,002 tests and the existing coverage, migration,
audit and OpenAPI gates. No gate was weakened. The native projector/repository/source-reader
code is unchanged, so the earlier native comparison remains scoped to those
identical modules; HTTP warm/TTL measurements were independently repeated on the new runtime.

## Final acceptance after the fix

The independent repeat serves merge `0cb4621965b525b6b4c6bc07df5be81e0f264116`,
deployment `5e3ce740-edec-41b0-908c-354edb35cb71`, image
`sha256:54861ef48762e114b26b54f8fcef1a7f7169b9c22c1520f89b9be551da32f99a`.
SFO placement, one replica, max-3 pools, 2,000-ms acquisition, 60,000-ms idle,
85-row projection and source fences stay unchanged. The scheduler remains enabled;
no checkpoint date was edited and no rebuild POST or failed-request retry ran.

| Final gate                             | Result                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native incremental refresh             | Earlier **37.246%** p95 reduction, twenty matched pairs per variant; the measured projector/repository/current-reader source blobs are identical after the HTTP-only fix |
| Warm cohort 1                          | 20/20 same-generation READY HTTP 200; client p95 **1,500.705 ms**                                                                                                        |
| Warm cohort 2                          | 20/20 same-generation READY HTTP 200; client p95 **1,642.353 ms**                                                                                                        |
| All 40 warm reads                      | Client/backend p95 **1,630.269 / 1,405.169 ms**; all actual query decisions are `warm`                                                                                   |
| Three natural-expiry four-reader waves | **12/12 HTTP 200**, each wave one actual HTTP leader, three waiters and one six-owner-page HTTP refresh; all four reads return the same new READY generation             |
| Serial correctness and retention       | Role/session denial, cursor/filter binding, unknown attendance, integer VND, selected business digests, sixty migration checksums and zero Staff check-ins pass again    |

Each new TTL HTTP refresh loses its publication race to the existing scheduler
and records `ANALYTICS_REFRESH_CONFLICT`; these **three observed conflicts remain
in the evidence**. They are not HTTP errors: all twelve GETs recover the winning
READY generation. The important coalescing observation is six HTTP source pages
per wave, not four separate refreshes/twenty-four pages. Independent scheduler
work is separately attributed, never counted as absent. This is bounded HTTP
herd protection for the measured single replica, not cross-replica coordination.

The twelve TTL reads have client/backend p95 **14,011.302 / 8,094.306 ms**
(nearest rank with twelve samples includes the maximum). The client tail remains
visible; a two-second warm target is not a two-second refresh promise. The native
37.246% comparison belongs to the earlier deployment and unchanged projection
components, not a newly measured whole-application or HTTP improvement percentage.

After measurements, the Analytics flag is restored to its original **unset**
state. A normal same-image redeployment
`55cdfdb1-2239-468f-b57f-d44ab3ac5cd5` applies default-off behavior: READY generations
advance across two natural scheduler intervals, independent info logs are observed
and no Analytics telemetry is emitted. Health/readiness return 200 and served
OpenAPI bytes retain SHA-256
`68a47cb4d43a0ea185ce3cd7c28928011c705bc6aa101f2f92a6261ec5cda694`.
The provider hash is restored, the temporary SSH key remains revoked/removed,
and general DB diagnostics/deadlines stay off. Source/business histories and
provider funds remain untouched; local test delays run only in disposable databases.

PERF-10 is now closed for the stated synthetic/backend measurement scope.
Completed PERF tasks are **01, 02, 10 and 12**. No other checkbox is closed here.
The next focused evidence task is **PERF-09**, a matched catalog comparison using
the retained real Storage-media fixture. APAC comparison, endpoint deadline rollout,
broader PERF-13 budgets and external-provider/production readiness remain separate.

## Report publication infrastructure recovery

PR #58's first three CI attempts stop before checkout/tests when the ECR public
mirror reports `toomanyrequests: Data limit exceeded`. Static/test/build/audit gates
pass, but this does not replace the missing PostgreSQL integration/coverage job.
The owner subsequently authorizes unblocking CI, merging #58 after its required
checks and moving to PERF-09.

Only the CI service-image reference changes: use Google's
[official Docker Hub cache](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images)
and pin PostgreSQL 17 to digest
`sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`.
That is the exact manifest digest pulled by successful main CI job
`117304741020`, not a database-version downgrade. A read-only registry request
returns 200 with matching `Docker-Content-Digest` and SHA-256 of the manifest body;
the linux/amd64 child manifest is
`sha256:3cec7eb015ba8adb28139fa5c83b8489cdf0e666e53dfdf20f598ae0cc8739e3`.
Both required jobs, migration commands, integration tests, coverage thresholds,
timeouts, health checks and dependency audit stay unchanged. The three original
failures and both Analytics evidence receipts remain immutable. Passing fresh
exact-head CI is still required before merge; mirror availability alone is not CI.

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
