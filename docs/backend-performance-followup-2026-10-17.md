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
The repository predeploy command deploys migrations first, then skips the optional
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
This closes that narrow pooler-protocol experiment only. The runtime endpoint is
different and was tested independently below. The observer uses a fixed
SQL comment because the pooler did not preserve the client application name in
the earlier observation. That failed observation is retained rather than counted
as a passing run.

## Verification checkpoint

Focused unit tests passed 25 cases, including adapter wiring in both modes; the
disposable PostgreSQL pool/deadline suite passed nine cases. Typecheck, production
build and changed-source lint/format passed. Independent review resolved two
Required findings: missing adapter-wiring regression coverage and conflating
predeploy metadata with runtime-replica placement.

[PR #51](https://github.com/WDP301-wedding/wedding-be/pull/51) merged as
`89e6f68cf74462fba79451b550cf70dcf7cd791b`. Exact-head CI passed, followed by
[merge-commit CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38942586396):
160 unit files / 1,394 tests; 18 contract files / 49 tests; 103 integration files /
538 tests; 281 full-suite files / 1,981 tests. Lines were 97.55% and branches 93.49%,
with unchanged per-file 80% gates. Reviewed and merged source trees match.

The PR #50 merge-commit rerun also passed. Its initial failure was Docker Hub's
image download limit during container initialization, before tests started; the
failure log is preserved and no check was weakened.

Railway's existing service override retained the old migrate-only predeploy command
on the first candidate. That deployment supplies no container-probe evidence.
The controlled experiment therefore temporarily overrides predeploy and startup
commands through the service API. Startup uses an explicit shell and `exec` for
the exact original Node server command, preserving PID 1/SIGTERM behavior. Commands
are restored after measurement. Predeploy and actual runtime-replica probe results
are tracked separately; neither is inferred from a successful deployment status.

The temporary predeploy override also used an unwrapped `&&` chain. The saved
logs show migrations but no identifiable predeploy probe result; this is
`NOT_OBSERVED`, not a passing probe. Docker command execution requires an explicit
shell for chaining. [PR #52](https://github.com/WDP301-wedding/wedding-be/pull/52)
corrects the repository command with `/bin/sh -c`, following
[Railway's Docker predeploy guidance](https://station.railway.com/questions/pre-deploy-command-parsing-of-develop-71b60872).
That correction does not retroactively establish predeploy execution.
PR #52 passed [exact-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38947126261)
with the same 1,981 tests and coverage gates, then merged as
`df70188f80738c0744c7411adf9e922463f2193c`. Its only source change from the
benchmarked merge is the shell wrapper in `railway.json`; application runtime,
Docker image instructions, scripts, dependencies and migrations are unchanged.

The separately identifiable runtime probe on deployment
`c664712c-2efe-4cc8-b28e-3c9ad0d93df4` used the application's direct database
endpoint and reported region `sfo`. Twenty `SELECT 1` round trips were about
155–157 ms, after a 1,132 ms connection. Cancellation observed one active tagged
sleep query before the deadline and zero afterwards, `REQUEST_TIMEOUT` from the
actual helper, read-only mode, SQLSTATE `57014`, and a reusable connection. Total
elapsed time was 5,469 ms for a 5,000 ms deadline. This establishes the controlled
runtime cancellation experiment; the global request deadline flag remains off.

## Matched live connection variants

Both variants use source `89e6f68`, the same initialized fixture, one SFO replica,
pool max 3 and acquisition timeout 2000 ms. Diagnostics and global safe-read
deadlines are off. Reader starts are spaced at least 750 ms, with at most 80 starts
per minute, no automatic retries, and aborts on unexpected status, transport error
or latency above 25 seconds. Initial probes remain separate from twenty steady
samples per case and reader stage. All request IDs are correlated with exact
deployment application logs; client elapsed time and backend duration are separate.
Timing receipts did not serialize the fixture object, and application logs redact
booking parameters. Fixture identity is based on the reused initialized operator
configuration and actual before/after DB snapshots, not a comparison of absent
receipt fields or an independent per-request booking-parameter trace.

The nineteen-case single-reader comparison completed 399/399 successful reads per
variant. Selected steady backend p95 values are:

| Route                                | Idle 10 s | Idle 60 s | Reduction |
| ------------------------------------ | --------: | --------: | --------: |
| Couple Identity                      |   1222 ms |    158 ms |       87% |
| Couple booking overview              |   2754 ms |    617 ms |       78% |
| Couple inbox                         |   2897 ms |   1821 ms |       37% |
| Couple unread count                  |   1657 ms |    626 ms |       62% |
| Manager invitation templates         |   1964 ms |    941 ms |       52% |
| Manager print orders                 |    913 ms |    945 ms |       -3% |
| Manager Analytics, mixed generations |   6797 ms |   1526 ms |       78% |

The complete receipt retains all cases, including increases. Halls, menu-package,
profile, Staff Identity, consultation and readiness backend p95 varied by about
2–5%; the health-live difference is below 0.2 ms. OpenAPI's client p95 increased
436 → 2819 ms while its backend p95 decreased 49 → 34 ms, illustrating why client
and backend results must be reported separately. The mixed-generation Analytics
row does not establish automatic refresh improvement.

Each variant also completed 378/378 reads across six cases at reader caps 1/2/4.
Together the four runs contain **1,554/1,554 HTTP 200 reads**. Every measurement
session was revoked with 204, followed by a denied 401 reuse check. No read hit
the status/transport/25-second stop condition.

Benefits depend on the cohort. Bounded one-reader inbox backend p95 decreased
2891 → 1849 ms, while templates were 928 → 943 ms. At two readers, inbox was
1801 → 866 ms and templates 1956 → 940 ms; Billing increased 3388 → 3643 ms.
Four-reader backend p95 was largely unchanged: inbox 1805 → 1898 ms, templates
909 → 899 ms, Seating 4493 → 4489 ms and Billing 4768 → 4818 ms. These results
support retaining idle 60000 ms for connection reuse, with the pool cap unchanged;
they do not support a blanket speedup across all routes/stages. The complete
receipt preserves all 37 route/reader comparisons and cardinalities.

## Isolated Analytics and the stopped rebuild experiment

The first cohort retained an initial GET, twenty GET trials and two waves of four
GETs. Nineteen trials kept the prior generation; one changed generation and took
8160 ms client / 7943 ms backend. A generation change alone cannot distinguish
GET-triggered work from a concurrent scheduler publication. The eight concurrent
GETs returned 200 with client/backend p95 1825/1423 ms; this is not a stale-start
herd experiment.

The explicit full-rebuild protocol planned twenty POST/GET pairs. Five rebuilds
returned 200 (client 5829–7780 ms). Attempt six returned 409
`ANALYTICS_REFRESH_CONFLICT` after 5442 ms client / 5228 ms backend. The runner
stopped, performed no POST retry, and revoked its session. **This protocol is
incomplete, not a passing twenty-sample refresh result.** Full rebuild is also
different from automatic TTL/incremental refresh; no 30% refresh improvement is
claimed from these five successes.

The conflict matches the existing publish guard: after acquiring the scope lock,
`projection.repository.ts` rejects a changed expected generation before creating
the replacement. The native integration race requires exactly one winner and one
`ANALYTICS_REFRESH_CONFLICT`, and passed in final-source CI. The HTTP rebuild path
publishes directly, while the scheduler refreshes scopes every sixty seconds.
A scheduler collision is consistent with these observations; the winning
publisher's identity was not traced. No guard, worker, source fence or immutable
business history was changed to make the measurement pass.

A separate GET-only follow-up retained its initial probe plus twenty reads on one
generation, all 200, with no POST retry. Steady client p50/p95/max and backend
p50/p95/max are retained in the receipt; client p95 was **1639 ms**, backend p95
**1411 ms**, and client maximum **2164 ms**. This cohort meets the warm p95
experiment target; the earlier slower trials and the stopped rebuild remain
visible. Client-computed generation ages may include clock skew and do not prove
an exact TTL boundary.

## Retention and acceptance checkpoint

The fresh read-only inventory matches all selected fifteen business-table
count/digests to the before snapshot. All sixty migration checksums match tracked
applied migrations. The 145 public tables and 363 rehearsal tables remain retained.
The synthetic booking is outside the notification booking allowlist. This does
not assert that session, audit or Analytics projection rows received no writes.

Final merge-commit [CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38948084889)
passed all 1,981 tests with the same coverage gates. Driver-command regression
ceilings remain enforced; shared Railway timings remain observational, with
separate reader/generation cohorts rather than a new CI wall-clock threshold.

PERF-10's automatic refresh comparison and concurrent stale-start proof remain
open. Real assigned-Staff event-window reads, the APAC placement experiment, catalog
with real Storage assets and external provider acceptance remain separate gates.
Runtime RTT and controlled cancellation now have actual container evidence, but
the global deadline flag remains off pending an endpoint rollout and latency-cost
decision. The existing product **NO_GO** decision is unchanged.

## Final deployment and rollback

Deployment `dd402ca3-7474-47e9-945f-5bf0698f5cfb` is successful on final reviewed
source `df70188f80738c0744c7411adf9e922463f2193c`. Postflight verifies exactly one
running current replica, with the temporary predeploy/startup commands restored
to `npm run db:migrate:deploy` and the original direct Node start command. The
original sole GitHub `main` deployment trigger is restored with CI checks required.
Health/live and readiness returned 200, anonymous Identity returned 401 and the
OpenAPI SHA-256 remains
`68a47cb4d43a0ea185ce3cd7c28928011c705bc6aa101f2f92a6261ec5cda694`.

| Final control                                    | Value                 |
| ------------------------------------------------ | --------------------- |
| Pool max / acquire timeout                       | 3 / 2000 ms           |
| Idle timeout                                     | 60000 ms              |
| Planned processes / maximum / reserve            | 2 / 60 / 10           |
| Replica / region                                 | 1 / SFO               |
| Diagnostics / safe-read deadline / one-off probe | false / false / false |
| Deployment overlap / draining                    | 0 / 35 seconds        |

The declared worst-case allocation remains `(8 × 3 + 1) × 2 + 10 = 60`, not a
claim of sixty observed live connections. Provider configuration matches its
pre-experiment hash. The probe's bounded connections closed before application
startup; no test pool or altered service command is retained.

Rollback for an idle-lifecycle regression is to set `DB_POOL_IDLE_TIMEOUT_MS=10000`
and redeploy the reviewed source while retaining pool max 3, acquire timeout
2000 ms, all three flags off and the existing process/provider reserve. This
requires no schema rollback, fixture deletion or history rewrite.

The [machine-readable receipt](../tasks/evidence/perf-live-followup-2026-10-17.json)
retains raw timings and exact request IDs, all 37 comparisons, initial/steady
cohorts, the partial Analytics stop, successful warm follow-up, runtime probe,
CI/review/deployment/configuration receipts, fixture digests and hashes of raw
operator artifacts. All **1,708 measurement/session/cleanup operations** match
application logs. Credentials and tokens are excluded.

References: [pg Pool lifecycle settings](https://node-postgres.com/apis/pool),
[PostgreSQL statement timeout](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-STATEMENT-TIMEOUT).
