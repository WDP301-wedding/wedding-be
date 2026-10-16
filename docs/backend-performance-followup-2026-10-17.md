# PERF follow-up: connection lifecycle, Analytics and fixture data

The owner authorized the next investigation, fixes, CI, controlled Railway
rollout, repeated measurements and read-only deadline verification on 2026-10-17
(Asia/Saigon). PR #50 passed exact-head CI and merged as
`f07b625b7147aa8f6abb841002c9bcc4e8b8bf4e`. Earlier rollout and provider evidence
remain preserved.

## What the fixture writes

The [original fixture receipt](performance-railway-fixture-2026-10-16.md)
records creation on the shared Railway database, not a create-and-delete test:

| Data                                                                | Disposition                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Booking `PERF-TEST-20261016`, event 2026-11-19                      | Retained and reused                                                                                       |
| Four Groups, eight named Guests, planning headcount 50              | Retained; planning is independently entered                                                               |
| Compatible published layout and confirmed five-table Seating plan   | Retained                                                                                                  |
| Staff assignment and explicit named-Guest check-in configuration    | Retained; no actual check-in was performed                                                                |
| One invitation draft                                                | Retained; no AI generation, publication or delivery                                                       |
| Timeline/contract approvals and synthetic manual accounting receipt | Retained immutable history, never erased between benchmarks                                               |
| Measurement sessions                                                | Created and revoked; revocation marks them REVOKED rather than physically deleting the fixture            |
| Audit/session/refresh evidence                                      | Retained under the existing retention policy                                                              |
| Analytics projections                                               | Derived data may be refreshed/replaced; normal projection publication prunes obsolete derived generations |

The contract total is 17,500,000 VND and the synthetic deposit accounting fact is
5,250,000 VND. These are test database facts, not real funds or provider settlement.
No new receipt or business fixture is required for this follow-up. Before/after
count/digest comparisons cover selected business tables; they do not assert that
session/audit/projection tables received no writes. Local/CI native integration
tests use disposable local databases and remove those isolated databases after
the test. That cleanup does not delete the Railway fixture or its financial history.

## Connection lifecycle experiment

The pinned pg driver defaults to 10 seconds of idle eviction. Several mixed-route
cycles revisit an owner after that interval. The existing per-request diagnostics
showed acquisition costs near one or two seconds, despite the small pool cap.

`DB_POOL_IDLE_TIMEOUT_MS` now accepts 1000–60000 ms, defaults to the existing
10000 ms, and is forwarded to both normal and diagnostic pools. It changes reuse
of established idle connections, not the number of pools/connections, prewarming,
query authority, transactions, request deadlines or provider outcomes. Pool max=3,
acquisition timeout=2000 ms and the declared aggregate budget of 60 remain unchanged.
The 60000 ms variant must be retained only after matched live measurement.

`scripts/performance-pool-lifecycle.mjs` compares six alternating pairs across
10000/60000 ms, with 12-second idle gaps and max=1 per pool. It runs fixed read-only
transactions and reserves at most two operator connections. It does not create
business rows. The operator-only eight-second connection timeout is explicit and
does not change the application's two-second budget.

The direct runtime DB hostname currently resolves only to IPv6, and the operator
machine's TCP connection to that address timed out. The saved IPv4 pooler URL in
the existing local configuration was verified against the same project reference
and database before use. No Railway database URL or credential was changed.
The first failed direct attempts are retained separately. The successful pooler
experiment created six connections with the 10-second variant, versus one with
the 60-second variant; the latter's five subsequent acquisitions were below 1 ms.
This is operator evidence through an alternate same-project endpoint, not
container RTT, deployed endpoint p95 or provider region confirmation.

## Read-only container probe

The runtime image includes the existing `scripts/performance-db-probe.mjs`.
Its normal mode measures twenty `SELECT 1` round trips; `--container` requires
Railway region metadata. An explicit `--deadline` mode adds fixed, bounded,
read-only checks: a server statement timeout returning SQLSTATE 57014, the real
Prisma safe-read helper rejecting expired work, active-query observations before/
after, a read-only transaction check and a reusable connection. It does not lock
tables, submit business mutations, call providers or impose timeouts on money flows.

Predeploy evidence is labeled separately from runtime-replica evidence: the
predeploy container can have different placement. Its project/environment/service
metadata is required; region is recorded if supplied and never invented. A
predeploy RTT does not close runtime-replica RTT or provider-region acceptance.
The predeploy command still deploys migrations first, then skips the optional
probe unless `PERF_READONLY_DB_PROBE=true`. The flag is enabled for one controlled
synthetic deployment and disabled afterwards. Invalid explicit values fail closed.
The probe uses the selected runtime endpoint. A successful operator pooler
probe alone does not establish container or deployed cancellation acceptance.
The global safe-read flag remains off until runtime compatibility and added
latency are measured. Existing native pool/deadline integration regressions are
retained without relaxing their thresholds.

The operator same-project pooler follow-up observed server timeout SQLSTATE 57014,
one active tagged sleep query before the deadline, zero afterwards,
`REQUEST_TIMEOUT` from the actual helper and a successful subsequent `SELECT 1`.
This closes that narrow pooler-protocol experiment only; the runtime endpoint is
different and its container proof is still pending. The observer uses a fixed
SQL comment because the pooler did not preserve the client application name in
the earlier observation. That failed observation is retained rather than counted
as a passing run.

## Verification checkpoint

Focused unit tests passed 25 cases, including adapter wiring in both modes; the disposable PostgreSQL pool/deadline suite
passed nine cases. Typecheck and production build passed. Exact-head full CI,
matched live variants, isolated Analytics cohorts, final configuration and fresh
business digests will be recorded before closing their corresponding live gates.

References: [pg Pool lifecycle settings](https://node-postgres.com/apis/pool),
[PostgreSQL statement timeout](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-STATEMENT-TIMEOUT).
