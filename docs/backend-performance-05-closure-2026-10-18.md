# PERF-05: Identity and Couple overview completion

Accepted scope: backend reads on the existing synthetic Railway demo, verified on
2026-10-18 (Asia/Saigon). PERF-05 is complete against its
[original acceptance criteria](../tasks/plan.md#perf-05--reduce-identity-reads-on-authenticated-gets).
The implementation was already merged and deployed through PR #46; this closure
adds verification and reconciles the subsequently completed dependencies. No new
application change, migration, configuration change or deployment was necessary.

## Acceptance evidence

| Requirement                                                                              | Evidence                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reduce actual driver work                                                                | The joined Identity reader uses one parameterized driver query rather than four; the fresh native test asserts one query and one acquisition. PERF-03 independently observed one Identity command and five commands for populated overview in the actual runtime.                                                                                                |
| Meaningful authenticated p95 reduction, initial target at least 30% on the same topology | The preserved PR #46 comparison has twenty steady samples per route on each side: Identity backend p95 616 → 153 ms (75.2% reduction); populated overview 1,097 → 627 ms (42.8%). Same fixture, US West application placement and unchanged database/configuration; diagnostics disabled on both sides.                                                          |
| Preserve authority and concurrent revocation                                             | Fresh native tests cover credential/session revocation, all three expiry limits, disabled accounts, immediate role removal and four concurrent writers. Each concurrent case observes the reader actually waiting on a database lock before release, then verifies the committed authority state. Authoritative post-lock rereads and reparent rejection remain. |
| Preserve overview response and scope                                                     | Existing tests pass for empty grants without a Booking query, WEB/ANDROID grant filtering, pagination/cursors, absent snapshots/timelines and approval flags. The narrow select, no-store response and authorization lifetime are unchanged.                                                                                                                     |
| Complete diagnostic dependency                                                           | [PERF-03 attribution](backend-performance-03-attribution-2026-10-17.md) supplies actual runtime query counts, container RTT, overhead and bounded wait observations.                                                                                                                                                                                             |

The earlier report also retained PERF-02 and PERF-04 as outstanding checkpoints.
[Assigned-Staff fixture verification](backend-performance-acceptance-2026-10-17.md)
and the [fresh region comparison](backend-performance-04-rerun-2026-10-17.md)
have since completed in their stated scopes. The region comparison keeps US West
and retains the explicitly accepted final-image artifact-equivalence exception.
These receipts resolve the old dependency notes; they do not retrospectively
change the original measurements or erase their failures.

The original performance comparison remains one before/after pair under light
load on a shared service at different times. It supports the measured improvement,
with the limitations in the [PR #46 report](perf46-railway-comparison-2026-10-16.md).
It is not a capacity test, production SLO or complete isolation of traffic variance.

## Fresh Railway verification

The [sealed receipt](../tasks/evidence/perf05-closure-2026-10-18.json) retains every
request/log pair, exact deployment identity, source continuity, fixture/migration
digests and local verification results. The active deployment was
`ba3a5b90-fa14-4ff6-9f30-5f364af57b6e`, source
`d9c41b7f12e89d62721f47242cd7345f17072b3c`, image
`sha256:66c09298ba527f19c7773ad1d29e46a5cec92886cd4a4774e4dedede6fe84e76`.
The four relevant Identity/overview source files are byte-identical Git blobs
between PR #46, that deployed source and the locally tested source.

One initial probe per route is kept separate from twenty steady samples per route.
Requests alternate sequentially against the direct Railway origin; there are no
measurement retries. The existing initialized synthetic booking appears in every
overview response. All forty steady reads and both initial probes return 200 with
`Cache-Control: no-store`.

| Route                              | Steady samples | Backend p50 / p95, ms | Client p50 / p95, ms |
| ---------------------------------- | -------------: | --------------------: | -------------------: |
| Identity `/auth/me`                |             20 |     150.594 / 155.349 |    388.676 / 518.527 |
| Couple `/couple/bookings?limit=20` |             20 |     745.172 / 754.491 |    982.853 / 991.879 |

Login returns 201, logout returns 204, and reusing the revoked token against both
routes returns 401. All **46/46 HTTP operations** match exactly one completion log
in the pinned deployment. Seventeen selected business/profile table digests and
all **61 applied migration checksums** are unchanged and match the local migration
files. Session/audit writes are the expected operational exception. Before/after
deployment, image, complete application-variable fingerprint and service
configuration fingerprint match; diagnostics and safe-read DB deadlines remain off.

This new run verifies current execution and revocation. Its timings are not a new
matched baseline/candidate experiment: the service has changed since October 16,
including later pool configuration and unrelated features. Do not recompute the
original improvement percentages from this run. Live query counts come from the
separate PERF-03 diagnostic receipt, not from latency inference.

## Native correctness and retained failures

The final focused run passes **61/61 tests in eight files, zero skipped**, using
Node 24.21.0, pg 8.23.0, Prisma/adapter 7.10.1 and a dedicated PostgreSQL 18.6 cluster
bound to loopback. Its twelve Identity performance tests assert actual driver
counts and fresh/concurrent authority; session, schema-isolated persistence,
runtime composition, scoped-reader, repository and overview tests also pass.
All 61 immutable migrations apply to the disposable database. Test databases and
schemas are removed by their owners; the dedicated cluster is stopped afterward.

Exact test invocation, with `TEST_MIGRATION_DATABASE_URL` set to the dedicated
loopback administrator URL:

```powershell
& 'output/node-v24.21.0-win-x64/node.exe' node_modules/vitest/vitest.mjs run tests/integration/identity-read-performance.test.ts tests/integration/identity-access-session.test.ts tests/integration/identity-access-runtime.test.ts tests/integration/identity-access-persistence.test.ts src/modules/identity-access/authorization/scoped-identity.reader.test.ts src/modules/booking-lifecycle/http/experience.router.test.ts src/modules/identity-access/authorization/access-credential.reader.test.ts src/modules/identity-access/session/session.repository.test.ts --maxWorkers=1 --pool=forks --reporter=default --reporter=json --outputFile=test-results/perf05-focused-final-2026-10-18.json
```

The first attempt fails because the configured local port 55432 has no server;
the next attempt against an older local cluster fails because it has no `postgres`
role. Neither attempt is counted as a pass. Their logs/results remain retained.
The older cluster is restored to stopped state; the final run uses a newly
initialized dedicated cluster and explicitly selected administrator. No timeout,
test or coverage threshold is changed. This focused verification does not claim
a new whole-repository coverage/CI run; the implementation's historical exact-head
and merge CI remain in the PR #46 receipt.

Raw operator artifacts are under `output/perf05-closure-20261018/`; JSON test
reports are under `test-results/`. The sealed receipt includes their checksums.
The live command is `node output/perf05-closure-20261018/verify-live.mjs`; it uses
the existing ignored synthetic fixture credentials and authenticated Railway CLI,
records no response payloads/tokens and performs only GETs plus session lifecycle.

PERF-13 remains open for wider repeated-load and capacity/regression evidence.
Provider acceptance, payment/attendance semantics and production **NO_GO** are
unchanged. No frontend work or paid/destructive provider operation is part of this
closure.
