# PERF-13 verification closure — 2026-10-18

PERF-13 is complete for the selected backend verification scope. The deployed
billing read-lock change, original 19-case baseline and complete six-case cohort
at reader caps 1/2/4 pass. Native response/command regressions and full CI pass.
The four earlier stopped campaigns, exercised rollback and isolated Storage control remain preserved. Production **NO_GO** and
provider/RV gates remain unchanged; this establishes no absolute Railway latency
SLO, saturation capacity or historical Seating 500 holder.

## Implemented and deployed scope

[PR 73](https://github.com/WDP301-wedding/wedding-be/pull/73) is merged as
`224ac20b798dbe607f3c04c1ca8de1d3db6c7254`; its tree matches reviewed candidate `21eb83d10a510837a70bb016d79093bc4141e0cb`.
Serving deployment `03cc633c-4486-4473-a 41e-39141739531a` uses image
`sha256:b2a4f38c806bd06a5d7ae039dbbd726b2a43470079384d562e69b301488cf4b2`. The preceding deployment 50960339 is stopped.
Configuration and selected fixture identities match before/after. No frontend,
applied migration, pool cap, deadline flag, worker setting or provider credential
changes are included. No live business fixture, real payment or paid generation
is created by this task.

Billing views now select a database-only facade with SERIALIZABLE isolation,
the existing opaque scope checks and transaction limits, a shared booking advisory
lock and PostgreSQL READ ONLY. Enlisted ledger reads retain the shared fence
without upgrading it. Commands retain the original exclusive fence and whole-unit
retry policy. Existing authorization, history/total calculation, invoice/payment
evidence and HTTP schemas are preserved. The implementation follows PostgreSQL's
[advisory locking](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS)
and [read-only transactions](https://www.postgresql.org/docs/current/sql-set-transaction.html).

The repeatable CLI adds list-cardinality fencing, unique role/labels, authorization
expiry and operator-stop checks before transport, complete status/sample accounting,
successful-read p50/p95/min/max, null empty distributions and actual HTTP overlap
through body consumption. Failures remain in raw evidence. A pass requires every
cohort and owned-session cleanup. Native failure waves drain before cleanup.

## Live acceptance

The owner explicitly authorizes merge/deploy/demo repeat and the sustained-backlog
guard. A fresh 45-minute window retains the same initialized accounts/fixtures and
configuration. One read-only operator connection samples global client backends,
lock waits and blocking edges every 10s. Dispatch stops above 57 clients, waiter age
above 2000 ms, waiter/blocked backends in two consecutive samples, missing waiter age
or observer failure. Actual wait duration uses pg_locks.waitstart, separate from
query/transaction age. HTTP unexpected status, 429/5xx, transport failure or latency
above 25000 ms also stops dispatch. Starts stay >=750 ms apart; no automatic retries.
In-flight work drains and owned sessions revoke, including after expiry/stop.

Post-rollout smoke verifies health/live and ready 200, 201 owned Couple login,
billing GET 200 with integer totals, then 204 revocation. This confirms that this
billing path executes through the selected pooler on the new code; health alone
is not the acceptance result.

The independent campaign completes **399/399 baseline reads** (19 initial,
380 steady) and **378/378 bounded reads** (18 initial, 360 steady), all HTTP 200.
Actual HTTP overlap peaks are 1/2/4 for caps 1/2/4. The cap 4 stage reaches four overlapping HTTP reads; this remains a bounded workload, not a saturation test.
All 818/818 read/session/smoke/correctness operation IDs correlate with the exact
deployment. Client and backend distributions, initial probes, cardinalities,
statuses, Analytics generations and every sample remain in the
[sanitized receipt](../tasks/evidence/perf13-verification-2026-10-18.json).

The observer records 108 samples, peak 17 client backends,
0 waiter samples and maximum sampled wait 0.00 ms.
No accepted threshold is crossed; the observer closes. This is sampled pressure
evidence, not proof that no unrelated traffic or shorter unsampled waits occurred.
All 47 scoped table digests, 19 fixture-table digests and 61 applied migration
checksums match. Runtime/configuration remain pinned throughout. Every runner
session revokes 204. Independent Couple, Manager and Staff checks each verify
201 login, 200 identity read, 204 revocation and 401 for the same revoked token.
Staff event-window acceptance and whole-event attendance are not inferred.

Each row below contains 20 successful steady samples; initial distributions and
min/max are separate in the receipt.

| Case              | Reader cap | Steady n | Client p50 ms | Client p95 ms | Backend p95 ms |
| ----------------- | ---------: | -------: | ------------: | ------------: | -------------: |
| Public halls      |          1 |       20 |        960.47 |       1102.01 |         760.92 |
| Couple inbox      |          1 |       20 |        870.04 |       1156.80 |         611.96 |
| Manager templates |          1 |       20 |       1022.71 |       1553.32 |         764.78 |
| Guest groups      |          1 |       20 |       2946.39 |       2976.20 |        2694.52 |
| Seating           |          1 |       20 |       4748.25 |       4860.87 |        4493.67 |
| Billing           |          1 |       20 |       2494.21 |       2525.29 |        2253.97 |
| Public halls      |          2 |       20 |        937.63 |       1062.04 |         703.79 |
| Couple inbox      |          2 |       20 |        847.44 |       1253.72 |         988.51 |
| Manager templates |          2 |       20 |       1005.28 |       1229.81 |         753.98 |
| Guest groups      |          2 |       20 |       2919.93 |       2963.70 |        2689.78 |
| Billing           |          2 |       20 |       2470.64 |       2513.73 |        2237.67 |
| Seating           |          2 |       20 |       4738.11 |       5135.19 |        4488.26 |
| Public halls      |          4 |       20 |        977.33 |       1628.15 |        1103.74 |
| Couple inbox      |          4 |       20 |        863.80 |       1866.46 |         940.64 |
| Manager templates |          4 |       20 |       1094.60 |       1287.25 |         754.39 |
| Guest groups      |          4 |       20 |       2940.75 |       3233.80 |        2686.29 |
| Billing           |          4 |       20 |       2615.83 |       3022.79 |        2241.49 |
| Seating           |          4 |       20 |       4815.58 |       6193.47 |        4504.76 |

Only complete before/after billing caps 1/2 are compared below. The old cap 4 cohort
is partial and is not promoted to a 20-sample comparison. Timestamp, scheduler and
shared-service variability remain; these observations establish no general ingress
gain or stable live latency budget.

| Billing cap | Before client p95 ms | After client p95 ms | Steady n each |
| ----------: | -------------------: | ------------------: | ------------: |
|           1 |              2566.36 |             2525.29 |            20 |
|           2 |              3619.08 |             2513.73 |            20 |

## Native regression budgets and correctness

Across the independent 1/2/4-reader native runs, 1120 baseline/current samples retain
normalized response equality. The ten single-reader cases repeat 20 current samples
each and preserve driver-command ceilings: templates 3, print 5, inbox 4, unread 4,
halls 1, warm Analytics 6 and refresh 58. Empty/populated and plain/media variants
remain separate. The model uses 40 ms per driver submission and pool maximum 3;
it is not a Railway RTT model or SLO. All nine existing investigation bands pass;
Analytics refresh has no established band. No ceiling or latency band is relaxed.

| Native case               | Current p95 ms | Existing investigation band ms |
| ------------------------- | -------------: | -----------------------------: |
| templates-20              |         185.84 |                            240 |
| print-orders-20           |         294.38 |                            300 |
| inbox-empty               |         182.50 |                            300 |
| unread-empty              |         180.09 |                            245 |
| catalog-halls-no-assets   |          64.02 |                            185 |
| analytics-warm            |         319.55 |                            355 |
| analytics-refresh         |        2148.23 |                Not established |
| catalog-halls-with-assets |          91.17 |                            185 |
| inbox-populated           |         215.67 |                            300 |
| unread-populated          |         160.46 |                            245 |

The billing regression first observes the original view waiting on a held shared
reader. The candidate completes before that reader releases its fence. Native
positive controls prove writers remain fenced, PostgreSQL rejects a write in the
read facade, and normal exclusive commands still commit. All 17 focused local
cases pass. Nine CLI contract cases cover caps, expiry/operator stop, 429/500,
transport/cardinality failures, redaction and renewed-session cleanup. A reversed
cardinality condition and a deliberately injected CVV leak fail their assertions.

Both [candidate CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39125935743) and [merged-source CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39135268243) pass:
1461 unit, 68 contract, 602 integration and 2131 full-suite/coverage tests, unchanged
per-file 80% lines/branches, formatting/lint/typecheck/OpenAPI/build/audit. This
includes the existing monetary, idempotency, revocation, reader/writer and immutable
history suites. OpenAPI and migrations are unchanged.

## Preserved attempts and limits

- First campaign:399 baseline and 156 bounded reads return 200; a further dispatch
  is suppressed by the any-waiter guard. All 575 operation IDs correlate.
- Independent diagnostic:177 reads return 200; the same guard stops the next
  dispatch. All 185 operation IDs correlate. A517 ms advisory wait is observed.
- Owner-approved sustained-backlog repeat:399 baseline and 306 bounded reads
  return 200; caps 1/2 complete and cap 4 stops at 2105.337 ms and two consecutive waiter
  samples. One further dispatch is suppressed; all 729 operation IDs correlate.
  Actual peak at cap 4 is3. All three pre-rollout attempts retain unchanged scoped data,
  migration/configuration checks and successful session/observer cleanup.

The first deployment of the candidate completes its health/billing smoke, then
stops the baseline after 61 reads:60 return 200 and a Halls read returns504
PROVIDER_TIMEOUT after 10426.84 ms. All 72 operation IDs correlate. Every owned
session revokes 204, the observer closes, and 47/19-table digests, 61 migrations and
configuration match. The exact old source/image is restored at deploymentb7c91437
and independently verified healthy with unchanged data/configuration.

Four Storage signing operations in the selected upstream log window return 200 in
5–29 ms; no matching Storage log explains the failing request. The catalog/Storage
source blobs are identical across the old and candidate commits. The exact
transport failure remains unproved; it is not attributed to the billing change
or declared a provider-wide outage. An independent restored-image Halls control
then completes21/21 reads at one reader, with the same spacing/pressure limits.
This is not a 19-case baseline and is not combined into the accepted cohort.
The same exact reviewed candidate image is redeployed to 03cc633c for the fresh
accepted cohort above. No timeout, guard or configuration is relaxed; the failed
cohort and rollback remain part of acceptance history and the provider/RV limits.

Statement classification matches an exclusive-advisory waiter and a blocker
query against LayoutTemplateVersion while selected seating/billing GETs overlap.
The controlled local test proves the read-lock conflict. It does not assign an
exact request to each sampled PID or establish the historical Seating 500 holder.
Later successful reads do not erase earlier acquisition errors or public/client
tails. Small-page and cursor PERF-07 limitations and earlier provider/RV evidence
remain separate. Analytics generation changes are retained without attributing
refresh exclusively to a request or scheduler.

The first native two-reader acquisition failure, constrained-host full-suite
timeouts, failed local cleanup hook and interrupted typecheck remain recorded.
The first CI privacy failure is a CVV 123/duration 22.123 fixture collision; a distinct
canary preserves all redaction assertions and the injected-leak control fails.
An intermediate new-test fixture omitted required audit metadata; that failure is
retained. Explicit generic parameters fix the facade's initial inference lint
errors. No existing timeout, coverage bar, correctness assertion or security
requirement is lowered. Task-owned local PostgreSQL is stopped and its disposable
test databases are removed; unrelated workspace work is preserved.

## Repeat and rollback

Use an ignored private fixture JSON and a new output path for every campaign.
Required metadata pins an initialized synthetic fixture, full source/deployment,
topology, credentials, 19 baseline cases and six bounded cases. The optional
authorization.expiresAt fences dispatch; the admitted pressure observer creates
PERF_STOP_FILE on the declared limit. Execute scripts/performance-regression.mjs
with PERF_FIXTURE_CONFIG, PERF_MODE=baseline|bounded and distinct PERF_OUTPUT.
Inspect exit status, passed, complete samples, actual overlap, cleanup, deployment
correlation and before/after hashes together. Never combine stopped cohorts into
a successful run. Client/backend and initial/steady distributions stay separate.

The earlier rollback was exercised; no further rollback is required after the final accepted cohort. If a
future candidate regresses, stop/drain/revoke, retain evidence and restore the
previous reviewed image/source without database restore or configuration changes.
This task's rollback pin is deployment 50960339, source 41a7824d, image
sha256:2236f991eebb147e6a31d3000f0cc422fdc987b0b335e22e777365ebc5a72285.
Any new process/provider workload still needs the [PERF-11 allocation](backend-performance-11-closure-2026-10-17.md).
Keep the [runtime/provider audit](../tasks/evidence/spec01-05-runtime-audit-2026-10-10.md),
production NO_GO and external-integration acceptance separate from PERF-13 closure.
