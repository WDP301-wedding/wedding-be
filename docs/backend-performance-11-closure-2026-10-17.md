# PERF-11: verified connection allocation and deadline decision

**PERF-11 is complete for the current dedicated synthetic demo topology.** The
owner changed the project's provider Pool size from15 to5; Max client connections
stays200. Independent exporter reads confirm5/200 before and after the trial.
Railway retains Catalog3/Analytics2/six other owners1 and readiness1, one SFO HTTP
replica, acquisition2000ms and idle60000ms. DB safe-read deadline stays OFF;
the existing HTTP timeout remains30000ms. Production remains NO_GO under the
other RV/PERF-13 gates.

## Allocation and admitted topology

The previous24 app +10 Auth +10 PostgREST +15 Storage +2 operator/migration
+3 reserved =64 did not fit DB60, even before utility/spare allowances.
The accepted allocation is:

| Consumer                                          |  Slots |
| ------------------------------------------------- | -----: |
| Two full app processes, including old/new overlap |     24 |
| Auth, currently exported maximum                  |     10 |
| PostgREST, currently exported maximum             |     10 |
| Storage, one admitted hosted pool combination     |      5 |
| Controlled operator                               |      1 |
| Migration                                         |      1 |
| PostgreSQL superuser reserve                      |      3 |
| Pooler utility allowance                          |      2 |
| Admin usage outside reserved slots allowance      |      2 |
| Ordinary spare                                    |      2 |
| **Total**                                         | **60** |

App startup still checks12*2+36=60. Reserve36 now has an explicit decomposition;
it is an allocation, not a SQL mechanism that reserves slots for named providers.
There are57 ordinary slots;51 go to app/Auth/PostgREST/Storage/operator/migration,
four to utility/admin allowances and two stay spare. Managed-admin allowances are
supported by samples; they are not newly enforced provider role limits.

One HTTP replica may have two full app processes during rollout. In-process
Notifications/Analytics workers reuse owner pools. At most one operator and one
migration client are admitted. No third full app/worker process, unrelated client
pool, extra Storage user/database/mode combination or new provider workload is
admitted without recalculation and measurement. Supavisor's client200 limit is
not200 PostgreSQL backend slots.

The Storage allocation uses the hosted provider's documented separate
user/database/mode pool contract plus the owner-confirmed Dashboard setting;
it is not inferred from a PgBouncer metric alone. See the
[Supavisor FAQ](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI)
and [connection limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).
This accepts the current bounded demo allocation, not arbitrary managed-service
autoscaling or future production peak capacity.

## Actual verification

The [sealed closure evidence](../tasks/evidence/perf11-closure-2026-10-17.json)
contains full before/after receipts and preserves earlier evidence references.
Both Storage cohorts use the same existing synthetic bucket metadata GET, same
source/deployment, two blocks at reader caps1/2/4 and identical metadata hashes.
There are30 HTTP200 responses per cohort, including two warm-ups each.

| Readers | n per cohort, excluding warm-ups | Before p95 ms | After p95 ms |
| ------- | -------------------------------: | ------------: | -----------: |
| 1       |                                4 |        313.33 |       295.86 |
| 2       |                                8 |        395.02 |       426.00 |
| 4       |                               16 |        790.69 |       668.22 |

No cohort crossed the predeclared investigation boundary of25% over the largest
baseline block p95. Median timings did not uniformly improve; keep the change for
the deterministic connection-budget reduction, not a universal speedup claim.
The four-reader second block is412.10 ->659.10ms while the largest baseline block
is790.69ms; retain this run-to-run variation rather than calling it steady-state gain.
Before/after DB sample peaks are12/11, with zero sampled lock waiters/blocked
backends; PostgREST pool timeout counter remains0. The separately owned read-only
probe through the operator pooler returns SQLSTATE57014 with a local200ms SQL
timeout, rolls back, and reuses its connection. Network/setup time is additional.

Readiness, public halls and dishes GETs return200. Three Analytics reports cover
six READY sources in one generation, with business snapshot hashes unchanged.
Login201/logout204/revoked-session401 are expected, not errors hidden as200.
The operator observers close; no SSH keys or owned probe sessions remain. Sixty
migration checksums, OpenAPI, cancellation code, app variables, region and commands
are unchanged. Existing app factory3/2/1 and queue2002.61ms/removal/reuse proof,
actual old/new overlaps, safe-read server57014/active1->0 and71 focused publication
tests remain applicable because executable source did not change.

Available provider logs contain19 baseline and21 candidate bucket GET200 entries;
they do not correlate every one of the60 client receipts. Earlier unsupported log
queries, raw failed runner receipts and the initial missing-local-merge comparison
remain preserved. A separate pre-change ten-minute prospective window has255
samples, peak12 and no sampled lock/blocked session. It is not historical peak or
a representative high-load test. Original PERF-11 acceptance does not require
reconstructing missing historical telemetry; retain that capacity-planning limit.
No PERF-09 20-item cohort, paid generation, real-money or destructive operation ran.

## Endpoint deadline decision

| Endpoint/work                                                | Decision                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Public hall cursor/page SQL already wrapped by safeReadQuery | Keep OFF; cancellation proof exists, but four extra commands per enrolled read need a separate live latency/rollout decision |
| Media lookup/signing after hall SQL                          | Not covered by the SQL callback's cancellation proof                                                                         |
| Other reads, including dishes                                | No implicit enrollment                                                                                                       |
| Analytics/lazy-initializing GETs                             | Keep unenrolled; these can refresh/write derived data                                                                        |
| Mutations, payment and provider effects                      | Preserve UNKNOWN, idempotency and reconciliation; HTTP timeout does not prove cancellation                                   |
| Readiness                                                    | Keep its independent bounded probe/pool                                                                                      |

Keeping the DB deadline flag false is the completed endpoint disposition; enabling
it is not required to close this verification task. Rollout remains a separate
future change. On provider errors or sustained regression after a future change,
stop probes and restore the reviewed configuration; the recorded provider rollback
is Pool size15/client200, which also reopens the aggregate-budget issue.

The [earlier pool trial](backend-performance-11-pool-result-2026-10-17.md) and
[initial provider HOLD](backend-performance-11-verification-2026-10-17.md) remain
historical checkpoints. This closure supersedes their open allocation disposition
for the admitted topology; it does not rewrite their failed or incomplete receipts.
