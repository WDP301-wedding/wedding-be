# PERF-13 verification checkpoint

PERF-13 remains open. Three bounded live campaigns stop at their declared pressure
guards; the latest completes caps1/2 and stops partway through cap4 under the
owner-approved sustained-backlog rule. A billing read-lock candidate now passes
local regression tests and awaits its own CI and authorized rollout/repeat.
This is partial verification, without a production latency SLO or production GO.
The existing production **NO_GO** and provider/RV gates remain unchanged.

## Scope and measurement contract

Backend measurement tooling, regression tests, evidence and a scoped billing
read-lock candidate are changed.
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

For an authorized repeat, put credentials and selected fixtures in an ignored
private JSON file. Required fields are HTTPS `origin`, `synthetic: true`,
`initialized: true`, pinned `deploymentId`, full40-character `commit`, credentials
for each selected authenticated role, and `baselineCases`/`boundedCases` arrays.
Each case has `role`, `path`, optional stable `label`, optional `expectedStatus`
(default200) and optional `expectedItemCount`. Include verified `topology` and
`fixture` metadata. `authorization.expiresAt` must be a valid UTC timestamp when
present; expired authorization blocks dispatch while allowing session cleanup.

After reconfirming the target and the applicable pressure policy, run each mode
with a new output path. Existing evidence is never overwritten:

```powershell
$env:PERF_FIXTURE_CONFIG = '.local-demo/selected-perf-fixture.private.json'
$env:PERF_MODE = 'baseline' # then bounded, with a different output file
$env:PERF_OUTPUT = 'output/selected-perf-run/baseline.json'
$env:PERF_STOP_FILE = 'output/selected-perf-run/pressure-stop'
node scripts/performance-regression.mjs
```

Create the output parent directory first. A separately admitted read-only observer
creates `PERF_STOP_FILE` on the declared pressure limit. The operator must inspect
the runner's exit code, `passed`, complete cohorts, pressure/cleanup receipts,
deployment correlation and before/after data hashes together. A passing HTTP
runner alone does not establish those independent acceptance checks.

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

All nine existing single-reader latency investigation bands also remain within
their declared limits. Each row uses20 current samples, pool maximum3 and the
40ms-per-driver-command native model; none is a live Railway latency budget.
Analytics refresh has no established latency band and is reported separately.

| Native case              | Driver commands | Current p95 ms | Existing investigation band ms |
| ------------------------ | --------------: | -------------: | -----------------------------: |
| Templates20              |               3 |         185.84 |                            240 |
| Requested print orders20 |               5 |         294.38 |                            300 |
| Empty inbox              |               4 |         182.50 |                            300 |
| Empty unread             |               4 |         180.09 |                            245 |
| Halls, no media          |               1 |          64.02 |                            185 |
| Warm Analytics           |               6 |         319.55 |                            355 |
| Halls with media         |               1 |          91.17 |                            185 |
| Populated inbox          |               4 |         215.67 |                            300 |
| Populated unread         |               4 |         160.46 |                            245 |
| Analytics refresh        |              58 |        2148.23 |                Not established |

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
assertions/timeouts. All64 tests in the three selected modules pass in that
cluster, including the three earlier timeout cases. That attempt does not establish
local full-suite/coverage acceptance. Typecheck,
tracked-source lint, OpenAPI check, build and `npm run audit:ci` pass; the first
direct audit invocation omitted npm's required `npm_execpath` and is preserved.

The task-owned cluster's full coverage attempt later records a runtime-foundation
30-second timeout and is stopped. Its independent follow-up passes all five test
assertions but fails the original10-second cleanup hook; it remains a failed
suite. The cluster is stopped and its owned temporary databases are dropped.

[Draft PR73](https://github.com/WDP301-wedding/wedding-be/pull/73) isolates this work
from pre-existing workspace changes. First-head CI passes all599 integration tests
and2127/2128 full-suite cases. The remaining failure is a privacy-test fixture
collision: CVV123 matches legitimate duration22.123. The fixture now uses a distinct
CVV canary, preserving every leakage assertion. Both logging tests pass locally;
deliberately injecting the canary into captured logs fails the privacy assertion.
The original failed run is retained. The preceding runner-only code checkpoint
`ec66037708aa603a03bb70417a1789602c67cd99` passes
[exact-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39122692815),
including all599 integration tests, all2128 full-suite/coverage tests and the
unchanged per-file80% lines/branches threshold, static/unit/contract/OpenAPI/build
and dependency-audit gates, including1461 unit and68 contract tests. The subsequent
documentation checkpoint5999825c also passes all gates. Every failed local/first-CI
attempt is preserved. These passes predate the billing runtime candidate, whose
CI is required independently. PR73 remains a draft; no merge or deployment was
performed by this task.

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

A separate240-sample passive observation, with no agent-generated business HTTP
requests, finds zero sampled waiters and peak10 client backends. The observer
closes. This is a sampled baseline, not proof of no unrelated traffic or proof
that advisory serialization during the stopped workloads is a capacity failure.

The original guard stops on any sampled lock waiter, regardless of duration.
The owner explicitly accepts a sustained-backlog rule: stop on waiter age above
2000ms or waiter/blocked backends in two consecutive10-second samples, above57
client backends, missing waiter age, observer failure or the unchanged HTTP
failure/25000ms limits. Wait age uses `pg_locks.waitstart`, separate from query age.
Neither earlier run is resumed or combined into a successful full cohort.

The fresh third campaign repeats399/399 baseline reads successfully, then submits
306 bounded reads, all200. Caps1/2 complete126 samples each; cap4 remains partial.
The next dispatch is suppressed before transport. Actual HTTP peaks are1/2/3 for
caps1/2/4; four simultaneous reads are not established. Its99 pressure samples
include advisory waits724.712ms and2105.337ms in consecutive samples. Both accepted
backlog conditions trigger at the latter sample; the campaign correctly fails.
All729 operation IDs correlate, scoped47-table/19-fixture digests and61 migration
checksums match, and runtime/configuration stay unchanged. All owned sessions
revoke204 and the observer closes. No correctness business HTTP is added after
any safety stop. Across all three campaigns,1437 actually submitted reads return200;
suppressed dispatches are retained separately and never counted as HTTP failures.

Metadata-only statement classification matches the waiter's exclusive advisory
lock fingerprint and a blocker query against `LayoutTemplateVersion`. Both samples
overlap the selected seating/billing GETs. This supports a read-contention hypothesis,
without assigning a precise request to a backend PID or identifying the historical
Seating500 holder. A disposable local regression independently demonstrates that
the current billing view waits on a retained shared booking reader.

## Billing runtime candidate

The candidate adds a database-only read facade to the existing billing unit of
work. It keeps SERIALIZABLE isolation, the same transaction limits and opaque scope
validation, uses a shared booking advisory lock, and sets `TRANSACTION READ ONLY`.
Only billing views select it. Enlisted ledger reads keep that existing shared fence
without upgrading it. Commands keep the original exclusive boundary and whole-unit
retry policy; no payment, invoice, ledger, authorization or HTTP schema is rewritten.

The local regression first observes the original reader waiting. After the fix,
the billing view completes while another shared reader remains held. Native checks
also prove competing writers cannot acquire the fence, PostgreSQL refuses a write
inside the read facade, and the original writer commits normally with an exclusive
fence. All17 cases across billing read-lock, existing billing views/operations and
booking-read-boundary modules pass. An intermediate test fixture omitted required
audit metadata; that failed attempt is retained and the fixture is corrected.

The implementation follows PostgreSQL's [advisory-lock semantics](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
and [read-only transaction rules](https://www.postgresql.org/docs/current/sql-set-transaction.html).
Native safety and CI do not prove the selected live pooler or the full capped
cohort on the new code. Exact candidate CI, separate owner authorization for rollout,
same-token revocation, before/after digests and a fresh complete live cohort remain
required. Preserve all three failed campaigns; do not loosen their guard.

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
