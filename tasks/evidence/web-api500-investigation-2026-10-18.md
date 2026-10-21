# Web API 500 investigation — 2026-10-18

Status: reproduced on the serving backend; configuration mitigation prepared and
operator-tested, **not activated on Railway**. PERF-13 and production NO_GO remain
open. No application, migration, OpenAPI or frontend source changed.

## Live evidence

The owner reported six concurrent requests from
`https://wedding-web-silk.vercel.app` for the existing synthetic booking
`e80c6f1b-a4fc-4674-a4dd-13ef2601206b`. Use the account supplied privately in the
chat; no credentials or response data are included here.

Serving deployment: `86d2addb-b0dd-4e1f-a3cd-4ed2717eb075`, source
`cc2999acdd24dc87e713806328022b160585c599`. Check-in settings failed through both
Vercel and the direct Railway origin. Later isolated settings reads returned 200;
attendance also alternated between 200 and 500. This is intermittent backend
failure, not evidence of a Vercel-only routing defect.

One fresh six-request burst reproduced two failures. All six requests match the
serving deployment's HTTP completion logs:

| Request | HTTP | Backend ms | Request ID |
| --- | ---: | ---: | --- |
| check-in-settings | 500 | 2002.284 | 82f9d8a9-590e-44fa-a7dd-9864da27f4a5 |
| guests, first request | 500 | 2789.205 | 25e001ee-9f87-436e-8172-1c4ac5919924 |
| attendance-summary | 200 | 2641.970 | 5a8d84a5-8f51-4dd6-855d-745265558be7 |
| guests, duplicate request | 200 | 3651.282 | d131fce8-df02-4e39-a041-3ba4b0dd6153 |
| contract-appendices | 200 | 2795.989 | 1641798d-12dc-4410-a51d-1d18c339c409 |
| billing, limit=1 | 200 | 4136.321 | 4b8dbf8b-da6f-43e8-b08e-e0e3b85a5558 |

Current settings exist and are valid: BY_GUEST_NAME, revision 2, ledger revision 0.
Do not reset settings, initialize replacement data, alter attendance or rewrite
financial records to work around these errors.

## Attribution and limits

The selected Railway configuration has common pool max 1, acquisition/connection
timeout 2000 ms, Catalog max 3, Analytics max 2 and idle lifetime 60000 ms. The
same Invitation runtime pool serves Staff/Seating reads; simultaneous named-Guest
requests share the separate Guest pool. Individual successful reads already take
longer than the configured acquisition wait.

The driver's documented [pool acquisition behavior](https://node-postgres.com/apis/pool)
queues requests when a pool is full. A local fixed-query reproduction with one
connection, five readers and a 2.4-second read-only hold produced one success and
four POOL_ACQUIRE_TIMEOUT failures at approximately 2.02 seconds. A 15-second
acquisition wait produced five successes without increasing connections.

An operator run of the unchanged real Staff service against the retained booking
also encountered the exact driver connection-timeout error with the 2-second
profile. These observations support insufficient acquisition/connection time as
a contributor. Current live logs contain only generic Error and no pool telemetry;
they do **not** prove the exact holder or driver cause of every reported 500.
Historical PERF-03/04 failures remain preserved.

## Prepared mitigation

Change **only** `DB_POOL_ACQUIRE_TIMEOUT_MS`: **2000 -> 10000** on the existing
Railway backend service. Rollback is **10000 -> 2000**. Exact target and unchanged
controls are in the accompanying JSON receipt.

Keep common max 1, Catalog 3, Analytics 2, provider reserve 36, planned processes 2
and capacity 60. The [accepted provider allocation](../../docs/backend-performance-11-closure-2026-10-17.md)
still gives `12 * 2 + 36 = 60`; reserve is not unallocated application capacity.
Keep the 30-second HTTP deadline, existing transaction limits, region, workers,
providers, source commit and commands. No global timeout or pool-cap increase is
proposed.

On the operator machine, the unchanged production runtime routers were composed
with this 10-second candidate and the same existing initialized booking. The exact
six-request burst returned **6/6 HTTP 200**, in 3.97–11.94 seconds. This process
disabled its own background reconciler; the actual Railway workers were unchanged.
This is operator HTTP/source verification, **not live activation or a matched
container performance comparison**. It establishes no latency SLA or capacity claim.

A larger-pool exploratory profile passed five reads but is rejected for deployment
because reducing reserve would violate the accepted provider allocation. A separate
five-Staff-read test with max 1 and a 20-second pool wait still hit the existing
10-second Prisma transaction-admission limit for two readers. Increasing a timeout
does not fix arbitrary concurrency, slow transactions or all PERF-13 concerns.

Activation requires owner deployment authorization. After activation, verify the
serving deployment/configuration, unchanged API, normal enabled workers, the exact
six API reads through Vercel and direct Railway, request/log correlation and session
revocation. Stop on unexpected status and retain failures. Restore the old value
on regression; do not mark the incident resolved before these checks pass.

## Verification and retained artifacts

- 38 focused pool-budget/boundary/Prisma tests passed.
- Existing PostgreSQL Staff default-settings integration test passed; 11 unrelated
  cases were excluded by its focused test-name selection.
- Six candidate HTTP reads passed; login 201, logout 204, revoked credential 401.
- The live burst session was also revoked with 204 and reuse returned 401.
- No paid/provider operation, payment, migration, business-data edit or deployment
  was executed. Normal login/logout security records are expected.
- Full application CI was not rerun for this investigation-only/configuration
  proposal; the existing merge-CI evidence is historical.

Sanitized operator artifacts are under `output/api500-20261018/`:
`live-burst.json`, `live-log-correlation.json`, `pool-reproduction.json`,
`business-reproduction.json`, `business-preserved-budget.json`, and
`candidate-http.json`. Failed/exploratory runs remain separate from the candidate.
Only the accompanying curated receipt and this report are intended for publication.
