# PERF-13 verification checkpoint

PERF-13 remains open. The exact baseline and two bounded live campaigns were run;
both bounded campaigns stopped at the declared pressure guard before four readers.
This is partial verification, without a production latency SLO or production GO.
The existing production **NO_GO** and provider/RV gates remain unchanged.

## Scope and measurement contract

Only backend measurement tooling, regression tests and evidence are changed.
Existing frontend work, applied migrations, money history, runtime pool caps,
provider reserve, deadlines and worker settings are preserved.

The runner retains the original 19-case baseline and selected 1/2/4-reader modes:
one separate initial probe, then 20 steady samples per route/role/stage. Starts
remain spaced by at least 750 ms. Unexpected status, 429, 5xx, transport failure
or latency above 25 seconds stops subsequent dispatch; in-flight work drains and
owned sessions are revoked. There is no automatic request retry.

New optional `expectedItemCount` values fence initialized list cardinality. A
mismatch stops the campaign even when HTTP returns 200. Role/route labels must be
unique, and cardinality expectations must be nonnegative integers.

Evidence now records the selected case expectations, actual peak active HTTP
reads per reader cap, steady status **counts**, successful sample counts and
nearest-rank p50/p95/min/max. Failed samples remain in the raw evidence and status
distribution; their timings are not mixed into successful-read percentiles. Empty
successful distributions explicitly contain null timings. `passed` requires all
20 successful steady samples in every selected case/stage and successful cleanup.
The peak counts HTTP reads through response-body consumption, not SQL concurrency.

## Verification and evidence

The contract regression executes the real CLI in child processes with synthetic
HTTPS transport and a controlled clock. No live credentials or network calls are
used. It checks normal completion, 1/2/4-reader limits, HTTP 429/500 fail-stop,
transport failure, cardinality mismatch, secret redaction and one successful
revocation per created session, including renewal. All nine final cases pass;
authorization expiry and operator-stop behavior are included. Operator stop has
its own error code and timestamp, distinct from a transport failure. A negative
control that inverts the cardinality condition fails five tests and is removed.

Local/native results and exact artifact hashes are recorded in the
[sanitized receipt](../tasks/evidence/perf13-verification-2026-10-18.json).
The native harness uses a loopback disposable PostgreSQL database, immutable
pre-change owner modules and identical fixtures. It retains response equivalence,
actual submitted-command counts and every measured sample. Its 40 ms per-command
model is separate from Railway/client/backend timing. Across 1/2/4 readers,
**1,120 baseline/current samples** pass normalized-response equality. Each of the
ten single-reader cases repeats 20 times and preserves its exact command ceiling:
templates3, print5, inbox4, unread4, halls1, warm Analytics6 and refresh Analytics58.
The empty/populated and plain/media cases stay separate in the receipt. The first
two-reader attempt failed acquisition and remains preserved; only the separate
diagnostic attempts establish successful native two/four-reader measurements.

An initial full coverage attempt overlapped static checks on the constrained
local host. It observed an earlier version of the new bounded-runner test timing
out, then was explicitly stopped along with the owned lint process. That run is
not a completed full-suite or coverage pass. Early Windows preload-path, simulated
clock and renewal-expectation mistakes are retained in the operator logs; the
final runner test uses microtask scheduling rather than a real-time sleep.
No existing timeout, coverage threshold, test or correctness assertion was relaxed.
The second full local coverage attempt recorded two native-media 10-second and
one commercial 60-second timeout before it was stopped. A fresh task-owned
loopback PostgreSQL cluster is used to diagnose those cases under their original
assertions/timeouts. Full-suite/coverage acceptance remains pending. Typecheck,
tracked-source lint, OpenAPI check, build and `npm run audit:ci` pass; the first
direct audit invocation omitted npm's required `npm_execpath` and is preserved.

## Preserved live campaigns

The original 19-case baseline completes **399/399 HTTP200** (19 initial and 380
steady). The first bounded run completes the one-reader stage and part of the
two-reader stage before its observer sees one blocked backend. All **555 actually
submitted baseline/bounded reads return200**; a further dispatch is suppressed
before transport. All575 GET/session operation IDs match exact-deployment logs.
All47 scoped table digests, the separate19 single-booking digests,61 migration
checksums, serving identity and configuration match before/after.

The separate diagnostic run submits **177 reads, all200**, then suppresses the next
dispatch at the same guard. All185 operation IDs match exact-deployment logs;
the same retained-data/configuration checks pass. At the stop sample, one advisory
waiter has query age517.252ms; its blocker is idle in a transaction aged3659.086ms.
Sanitized SQL fingerprints and both backend IDs are retained. This establishes the
observed wait edge, not the exact owner/request or the historical Seating500 cause.
Thirty later metadata-only samples find no blocking edge.

The original guard stops on any sampled lock waiter, regardless of duration.
An explicit owner decision about distinguishing transient serialization from a
sustained backlog is pending. Neither stopped run is resumed or combined into a
successful full cohort. All owned campaign sessions revoke204; pressure observers
close. No business HTTP correctness smoke is added after either safety stop.

## Remaining live acceptance and rollback

The read-only runtime inspection pins deployment
`50960339-9348-4e77-947e-f71232c606ba`, source
`41a7824d271fbcd9e382f506adf6855b525f8cac` and image
`sha256:2236f991eebb147e6a31d3000f0cc422fdc987b0b335e22e777365ebc5a72285`.
It is an inspection checkpoint, not proof those identifiers are still serving at
the start of a future campaign.

Reconfirm that identity before measurement. With explicitly authorized existing
synthetic accounts/fixtures, rerun the exact baseline and bounded stages, capture
fixture cardinalities and selected immutable-history/migration hashes before and
after, correlate every operation with the exact deployment logs, and retain all
initial/steady client and backend distributions. Keep Analytics warm/refresh
generations separate, and distinguish Staff identity reads from event-window
search/check-in acceptance. Earlier Seating acquisition failures and public/client
tails remain evidence; later successful reads do not identify their exact cause.

The owner explicitly authorized live and local verification. The campaign reuses
the existing synthetic fixtures and records its 45-minute authorization boundary,
one admitted read-only pressure observer and selected deployment/configuration.
No fixture, provider effect or deployment is created by this task. Original service
configuration is unchanged; no runtime rollback is needed. On probe failure, stop
dispatch, drain/revoke and retain evidence.
Any proposed runtime fix/rollout needs its own reviewed change and acceptance.

Keep existing deterministic command ceilings. Historical modeled latency bands
remain investigation-only until stable repeated measurements support an update.
Shared-service observations cannot establish an absolute p95 SLO or saturation
capacity. Preserve the separate [PERF-11 allocation](backend-performance-11-closure-2026-10-17.md)
and [runtime/provider audit](../tasks/evidence/spec01-05-runtime-audit-2026-10-10.md).
