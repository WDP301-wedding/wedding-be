# PERF-11: live verification and budget disposition — 2026-10-17

Later checkpoint: [authorized pool allocation trials and selected profile](backend-performance-11-pool-result-2026-10-17.md).
The unchanged-pool inventory below predates those separately authorized changes.

**Verification is complete for the authorized inventory and bounded demo campaign.
PERF-11 acceptance remains HOLD: provider headroom at simultaneous configured caps
is not established. Keep endpoint deadlines disabled. Production remains NO_GO.**

The [sealed evidence bundle](../tasks/evidence/perf11-live-verification-2026-10-17.json)
contains the initial inventory, native tests, full live campaign, failed runner
receipts, cleanup, authenticated Supabase SQL/log reads and three current metrics
scrapes. Earlier OPEN dispositions remain unchanged inside their historical
receipts; this document records the subsequent provider findings and decision.

## Actual topology and budget

Verified source: `650e14f154027dca3bfacb7b1ae6f395fa2d9ed5`, with
[successful exact-merge CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39007933969).
One HTTP replica runs in SFO. Notifications and the Analytics scheduler run inside
that process and reuse owner pools. No separate full worker process was found.
The separate Railway `spec11-staging` database does not share this DB budget.

| Allocation                                                | Verified value                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Owner pools                                               | 8 × max 3 = 24 per full application process                                                                  |
| Owner acquisition / idle                                  | 2,000 / 60,000 ms                                                                                            |
| Readiness                                                 | Separate max 1; acquisition 4,000 ms; SQL 700 ms; probe 5,000 ms; concurrent checks share an in-flight probe |
| Planned full application processes                        | 2, including old/new overlap; 25 × 2 = 50                                                                    |
| PostgreSQL                                                | max_connections 60; superuser reserve 3; other reserved slots 0                                              |
| Ordinary connection ceiling                               | 57; application role `postgres` is not superuser                                                             |
| Ordinary slots after both application processes reach cap | **7**                                                                                                        |
| Declared total reserve                                    | 10, which must also account for the 3 superuser slots                                                        |
| Deployment controls                                       | overlap 0 seconds; draining 35 seconds; app shutdown budget 30 seconds                                       |

The arithmetic `(8 × 3 + 1) × 2 + 10 = 60` passes the application's declared-budget
guard. It does not discover provider consumers or guarantee their headroom. A third
full application/worker/CLI process would require 85 slots under the same declaration.
Migration/predeploy and operator clients also consume slots; do not omit them.
Runtime uses the direct Supabase DB endpoint; the observer used a verified
same-project IPv4 pooler. Their connection setup timings are not interchangeable.

## Measured overlap, queue and cancellation

Two controlled redeployments used the same commit and image. The first enabled
temporary DB diagnostics and a connection label; the second restored the original
configuration. Neither changed owner pool limits, region or endpoint deadlines.

| Evidence                              | Result and scope                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual old/new runtime overlap        | Both transitions have simultaneous RUNNING snapshots, then old runtime EXITED; polling does not establish exact SIGTERM time                                      |
| DB observations                       | 246 snapshots, 06:29:10.031–06:32:24.575 UTC; peak 15 client backends including observer; no sampled lock waiter or blocked backend                               |
| Provider-role observations            | Peak 5 client backends during the campaign; includes superuser roles and is not a historical or configured maximum                                                |
| HTTP                                  | 33/33 status 200 with 33/33 correlated server logs; maximum four in flight; three waves of four readers all passed                                                |
| Current owner pool diagnostics        | 17 samples; maxActive 3, maxIdle 2, maxWaiting 1; no DB errors                                                                                                    |
| Queue timeout inside serving replica  | Separately owned max-3 pool, same direct DB endpoint: held three clients, fourth waiter timed out at 2,001.96 ms, waiting 1 → 0; connection reusable; pool closed |
| Safe-read cancellation inside replica | SQLSTATE 57014; tagged active query 1 → 0; helper REQUEST_TIMEOUT; READ ONLY; connection reusable; 5-second synthetic budget elapsed 5,448.57 ms                  |
| Native regression                     | Seven files, 36/36 cases, zero skipped, on disposable loopback PostgreSQL 18.6; cluster stopped afterwards                                                        |

The native cases include small-pool readers/writers, waiter removal, expiry while
queued, disconnect before submit, server cancellation, rejected writes in READ ONLY,
unenrolled writes completing after an HTTP deadline, independent readiness and a
blocked hall read returning 408. These tests do not claim every HTTP route is safe
to cancel. The live probe used the existing synthetic helper with the global
deadline flag false; it was not endpoint rollout.

Acquisition includes connection establishment: the largest cumulative acquire time
was 1,101.22 ms over four acquisitions in one request. Do not call all of it queue
wait. Waiting=1 does not by itself prove exhaustion. No shared table locks or
business writes were deliberately submitted by the campaign. Existing background
workers kept running. This workload does not establish all-pool saturation capacity.

## Authenticated provider findings and HOLD

The Supabase connection subsequently became available for the same `wedding`
project, `zjibuegbbwzvdqrnujjf`. Management SQL reconfirmed the 60/3/0 DB limits,
ordinary `postgres` role, and unlimited per-role connection settings (`rolconnlimit=-1`).
The project's Metrics API returned HTTP 200 using existing server credentials held
only in memory; credentials and the raw metrics body were not persisted.

At 06:54:32.238 UTC, the attributed scrape reported:

| Metric                                               | Value             | Interpretation                                                               |
| ---------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `db_sql_connection_max_open{service_type="gotrue"}`  | **10**            | Configured Auth pool maximum, not observed usage                             |
| `db_sql_connection_open{service_type="gotrue"}`      | 0 idle / 0 in use | Current usage only                                                           |
| `pgbouncer_databases_pool_size{database="postgres"}` | 15                | PgBouncer exporter configuration; not claimed to be shared Supavisor's limit |
| `pgbouncer_config_max_client_connections`            | 200               | Client connection limit, not 200 PostgreSQL backend slots                    |

Auth's configured maximum alone exceeds the seven ordinary slots left by two
fully occupied application processes. No enforced shared admission bound has been
verified that makes those maxima mutually exclusive. This is evidence that the
current declaration does **not establish a safe worst-case allocation**; it is not
a claim that the campaign exhausted the database. Do not blindly add provider pool
ceilings across potentially multiplexed paths or count every background worker as
a client backend. The [Supabase pool limits guide](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits)
distinguishes client and backend limits; the official
[metrics collector configuration](https://github.com/supabase/supabase-grafana)
documents the project metrics scrape used here.

`log_connections` and `log_disconnections` are off. Available Postgres/pooler logs
were inspected through aggregate fields only. Returned SQLSTATE groups had no
53300 entry; existing timeout, serialization and other error groups are preserved.
Event counts are not concurrent connection peaks. No stored historical time series
was obtained, and new snapshots cannot recreate it. A final metadata read found
no blocked session and only a one-second maximum idle-transaction age.

**The provider gate has a concrete negative/incomplete conclusion, not an access
excuse.** Acceptance needs a feasible aggregate app/provider/operator/migration
allocation, or a supported provider concurrency bound plus overlap admission
policy. Select and authorize that change separately, then verify the affected
allocation. No further redeploy, PERF-09 rerun or invented historical peak is
needed to finish this verification report. This report does not authorize changing
provider settings, pool size, region or deadlines.

## Endpoint disposition and cleanup

| Endpoint/work type                                                 | Current decision                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Catalog hall cursor/page reads already enrolled in `safeReadQuery` | Keep flag false; defer rollout pending budget acceptance and measured acceptance of four extra driver commands per enrolled read |
| Other reads, Analytics and GETs with lazy initialization           | No blanket cancellation enrollment established                                                                                   |
| Money, submitted writes and provider effects                       | Preserve UNKNOWN, idempotency, reconciliation and immutable history; HTTP timeout does not prove cancellation                    |

Current deployment is `5e3602e4-f90f-4564-b2bc-66ed6a767339`, instance
`b102c1ca-0cb5-40e3-8fa2-3b57ca937c41`, with the original source/image, one SFO
replica, diagnostics=false and deadline=false. Original variable hashes match;
temporary labels/SSH keys/key files are gone; no owned probe session or tagged
sleep remains. Sixty migration checksums and OpenAPI are unchanged; readiness 200.
The provider follow-up performs reads only and changes none of these controls.

Initial runner failures remain visible: request-ID echo expectation, CLI SSH key
registration and counting the PID-1 init wrapper as a second Node process. The
corrected process classification uses argv/known start command; `/proc/*/exe`
was inaccessible and no binary-path verification is claimed. Successful SQL
subreceipts and corrected inventory are recorded separately from failed attempts.

PERF-11 stays unchecked until the provider allocation gate is resolved. Its
**inventory and actual verification substeps are finished**, and the evidence is
now versioned beside the checklist. No PERF-09 20-item cohort was repeated.
