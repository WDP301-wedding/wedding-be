# PERF-06–13: merged code and controlled Railway verification

The owner authorized sequential merge, controlled deployment and bounded live
verification in this chat on 2026-10-16. This record extends the earlier
[PERF-06–10 implementation](backend-performance-06-10.md) and
[PERF-11–13 implementation](backend-performance-11-13.md); their original
undeployed-candidate measurements remain historical evidence.

## Source and CI

- [PR #48](https://github.com/WDP301-wedding/wedding-be/pull/48) merged as
  `c315a9eee9fcfead6c4080b55ee0a79c56c16649`.
- PR #49 incorporated that main revision, passed exact-head CI at
  `6d68b603d9d0352ccb830004ccc05ab6d852c228`, then
  [merged](https://github.com/WDP301-wedding/wedding-be/pull/49) as
  `266dfa87d86d8d9229c4f86344a2fd1078b78765`.
- Both required jobs passed again on the actual merge commit in
  [main CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38927835255).
  Unit: 159 files / 1,383 tests; contract: 18 / 49; integration: 103 / 538;
  full coverage: 280 / 1,970. Coverage: 97.55% lines and 93.49% branches,
  with the unchanged per-file 80% line/branch gate. Formatting, lint, typecheck,
  API check, production build and dependency audit passed. Empty PostgreSQL
  migration rehearsal applied all 60 migrations.
- The reviewed head and merge commit have identical Git trees:
  `4516181de7bb87d3fceafcd4c9fa549b85279d69`.

## Controlled deployment

Railway target: the owner's existing synthetic demo service, named `production`;
one SFO application replica. Ingress previously reported `sin1`; the database
region is not provider-confirmed. No region or external provider configuration
was changed.

The GitHub main trigger was held during the controlled rollout. The old deployment
`0c9f9cd8-1e38-4855-b2a2-84a232bbbdd5` used uncapped defaults, so it was explicitly
stopped and its instances verified `REMOVED`/`EXITED` before starting the new
build. Setting Railway overlap to zero alone would not prevent startup overlap.
The first transition therefore had approximately three minutes of planned
unavailability. The stopped historical deployment can still appear in Railway's
`activeDeployments` list; instance state and `deploymentStopped` distinguish it.

The first successful candidate deployment was
`d492dbe5-8deb-4c4f-b3ce-e61dac040f0f`, pinned to merge commit `266dfa8` and image
`sha256:97d401bad22eed4bfcbf1fe9a44ac9697f3f5ca8068c3eefe609ffd1850907f7`.
Startup reported 60 migrations and no pending migration. Live OpenAPI SHA-256
remained `68a47cb4d43a0ea185ce3cd7c28928011c705bc6aa101f2f92a6261ec5cda694`.

| Control                                        | Deployed value                  |
| ---------------------------------------------- | ------------------------------- |
| `DB_POOL_MAX`                                  | 3 per owner pool                |
| `DB_POOL_ACQUIRE_TIMEOUT_MS`                   | 2000                            |
| `DB_PLANNED_PROCESSES`                         | 2, including deployment overlap |
| `DB_MAX_CONNECTIONS` / `DB_CONNECTION_RESERVE` | 60 / 10                         |
| `BACKEND_REPLICA_COUNT`                        | 1                               |
| `DB_SAFE_READ_DEADLINE_ENABLED`                | false                           |
| `DB_DIAGNOSTICS_ENABLED`                       | false for matched measurements  |
| `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`           | 0                               |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`          | 35                              |

The declared worst-case allocation is `(8 × 3 + 1) × 2 + 10 = 60`.
This verifies the application's configured allocation against PostgreSQL's
advertised maximum; external consumers and provider pooler limits still require
separate confirmation. The safe-read deadline remains opt-in. Native cancellation
proof is not proof of cancellation through the live pooler, and an HTTP timeout
does not determine a payment/provider outcome.

## Live correctness and measurement

The API smoke passed 28 HTTP checks: health/readiness, unchanged OpenAPI,
unauthenticated access, validation, three-role login and identity, management
concealment, cross-booking concealment, existing Group/planning/seating/contract/
billing reads, and the assigned Staff event-window denial. All three created
sessions were revoked with 204 and subsequently returned 401. An earlier smoke
attempt expected 403 for manager-only Studio access; the implemented contract
intentionally returns 404. That incorrect test expectation was corrected and the
failed attempt retained. The service was not changed to satisfy the smoke.
Business endpoints were read-only; login/revocation and the existing denial-audit
behavior can write session/audit records. Analytics reads can refresh derived
projections. These records are outside the selected business-history digests.

The fixture contains four Groups, eight listed Guests, separately entered planned
headcount 50 and five menu tables. Staff check-in success remains outside the
fixture's future event window. Public halls returned no media assets, so this
smoke provides no new real Storage signing/download acceptance.

The main comparison ran with diagnostics and safe-read deadlines disabled:
19 routes × (one initial + 20 steady samples), followed by six routes × the same
sample count at each of 1/2/4 readers. All **777/777** read samples returned 200.
Dispatch spacing was at least 750 ms, with no retries; the runner would stop on
unexpected status, transport failure or a sample exceeding 25 seconds. No such
stop occurred. The 37 initial samples remain separate from 740 steady samples.
All measurement sessions were revoked and checked for subsequent 401 responses.

The earlier comparison ran on the same fixture, SFO placement and provider
configuration, using the previous PERF-02–05 code. The new cohort includes both
PERF-06–10 changes and the smaller pool allocation; this is a rollout comparison,
not an isolated causal experiment for each optimization. Every selected response
cardinality matched its earlier cohort.

| 19-route campaign, 20 steady samples/case | Before backend p95 ms | Candidate backend p95 ms | Before client p95 ms | Candidate client p95 ms |
| ----------------------------------------- | --------------------: | -----------------------: | -------------------: | ----------------------: |
| Public halls, 2 items, no media           |                472.47 |                   473.13 |               711.69 |                  806.85 |
| Empty inbox                               |               2359.49 |                  2982.34 |              2588.01 |                 3286.76 |
| Unread count                              |               1090.36 |                   634.15 |              1335.69 |                 1898.86 |
| Manager templates, 4 items                |               2572.92 |                  2057.23 |              2798.42 |                 2422.70 |
| Manager print orders, 3 items             |               1405.86 |                   942.67 |              1651.77 |                 1311.48 |
| Analytics overview, mixed generations     |               2511.54 |                  6551.21 |              3154.79 |                 6771.53 |

Client durations include ingress, network and response transfer. For example,
candidate OpenAPI client p95 was 2346.48 ms while matched application p95 was
42.21 ms. Neither client p95 nor application duration alone is pure SQL time.
The inbox slowdown is also present in application timing and must not be dismissed
as client network overhead.

| Bounded campaign, backend p95 ms | Before 1 reader | Candidate 1 | Before 2 readers | Candidate 2 | Before 4 readers | Candidate 4 |
| -------------------------------- | --------------: | ----------: | ---------------: | ----------: | ---------------: | ----------: |
| Halls                            |         2669.81 |     1576.10 |          2553.12 |     1501.47 |          2607.23 |      455.97 |
| Inbox                            |         2351.51 |     2950.83 |          2335.81 |     1878.02 |          2304.97 |     1966.32 |
| Templates                        |         1403.33 |     1954.08 |          2467.81 |      940.16 |          2446.40 |      944.07 |
| Groups                           |         3915.25 |     3968.76 |          3465.82 |     3904.31 |          3830.57 |     2814.62 |
| Current seating                  |         4669.27 |     4592.34 |          4668.19 |     4684.66 |          5648.15 |     4676.54 |
| Billing                          |         3443.62 |     3459.32 |          3827.63 |     3499.89 |          6229.47 |     5007.49 |

The current seating campaign included a 15414.88 ms client sample; its maximum
is retained even though nearest-rank p95 with 20 samples omits the single largest
observation. Analytics reached 11237.95 ms. The scheduler changes generations,
so these Analytics samples do not isolate warm GET cost from refresh contention.
The warm ≤2-second target and refresh improvement are not demonstrated by this
campaign. Inbox and single-reader templates also prevent a blanket live speedup
claim. The existing native driver-command ceilings remain the enforceable
regression budgets; these variable live distributions do not justify a new
wall-clock CI gate or a stable Railway SLO.

## Diagnostic follow-up and final state

A separate deployment of the same commit enabled diagnostics for 72 bounded
reads plus 12 focused unread/print/Analytics reads. All 84 returned 200 and all
84 had matched database diagnostics with zero recorded DB errors. Observed
per-pool maxima were three active and two waiting connections. These are sampled
extrema, not a global connection sum or proof of provider capacity.

| HTTP read                           | Observed driver commands/request |
| ----------------------------------- | -------------------------------: |
| Halls                               |                                3 |
| Inbox / unread                      |                            6 / 5 |
| Manager templates / print orders    |                            6 / 6 |
| Groups / current seating / billing  |                     18 / 30 / 15 |
| Analytics overview, focused samples |                                8 |

These include the HTTP authorization boundary, so service-only native ceilings
are not directly interchangeable with this table. No SQL text or parameters were
logged. One inbox sample had 1966.03 ms of aggregate acquisition time and
841.61 ms of aggregate query round-trip, with 2672.80 ms application duration.
A template sample with a reused connection had 0.31 ms aggregate acquisition,
830.95 ms query round-trip and 836.79 ms application duration. Parallel components
can overlap; these totals are not an additive wall-time decomposition. Acquisition
includes establishing a connection as well as waiting. The evidence localizes a
material acquisition cost but does not separate TLS/network setup from external
pooler waiting. Query time includes network/server/lock time, and the process-wide
event-loop maximum is not attributable to one request.

This small diagnostic follow-up does not replace the 20-sample main comparison or
establish stable warm/refresh latency. Next investigations are a controlled
experiment on connection lifecycles in the owner pools, container-to-DB timing and
a confirmed region comparison. Preserve authority rechecks while investigating; do not increase the
pool cap or keep connections alive by assumption.

Diagnostics was then disabled and the same source redeployed as
`c4cf32b6-8072-48dc-b06a-cb0fcb967fa8`. Postflight verified exactly one running
instance on `266dfa8`, live/ready 200, unchanged OpenAPI and anonymous auth/me 401.
The original GitHub main auto-deploy policy was restored with `checkSuites=true`
and verified as the sole trigger. Safe-read deadlines and diagnostics are both
false in the final configuration; one replica, region and provider settings are
unchanged. No rollback was executed.

All 828 HTTP operations from the two main campaigns and all 96 diagnostic
operations (including session lifecycle/revocation checks) matched application
logs by request ID. The
[sanitized receipt](../tasks/evidence/perf06-13-railway-rollout-2026-10-16.json)
retains sample status, duration, cardinality, generation, request ID, matched
application timing, all cohort summaries, raw-artifact SHA-256 values, CI,
configuration and final-state evidence. Credentials, tokens and response payloads
are excluded.

Before/after read-only snapshots matched counts and SHA-256 digests for all 15
selected business tables, including contract revisions and ledger entries.
This does not claim that session/audit or derived-projection rows were unchanged.
All 60 applied migration checksums matched the repository. The 145 public tables,
363 rehearsal tables and provider-owned schemas were retained. No business writes,
new fixture, payment, paid generation or retention deletion were performed.
Existing session/audit effects and permitted derived refreshes remain separate.
The notification worker configuration was unchanged and this fixture remained
outside its booking allowlist.

## Rollback and remaining gates

On unexpected statuses, overload or transport failures, stop dispatching probes,
drain in-flight requests and revoke measurement sessions. The reviewed prior
deployment retained rollback/redeploy availability before the transition. Returning
to its uncapped code requires stopping the current instances first; never overlap
the uncapped old process or restore max=10 in the new code without a larger
validated allocation. Retain immutable histories, provider UNKNOWN evidence and
all applied migrations.

PERF-12 remains a completed retention review with zero approved deletions.
Assigned-Staff event-window success, provider-confirmed region comparison, live
safe-read cancellation and external-provider RV/readiness evidence remain open.
A normal Railway SSH attempt found no registered key; no key was created or
revoked, and no container-to-database timing is claimed. The existing product
**NO_GO** decision remains separate from successful backend deployment and CI.
