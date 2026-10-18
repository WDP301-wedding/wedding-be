# PERF-06: bounded template snapshots and live comparison

2026-10-18 (Asia/Saigon). Backend implementation and native Railway comparison;
merge/deployment and after-rollout verification remain separate gates. The owner
authorizes a temporary SSH key, one read-only connection and the existing four
active live templates, with 1/4/20-item correctness coverage in disposable local
PostgreSQL. No live template fixture is created or changed.

## Change and preserved contracts

The deployed PERF-06 implementation already batches immutable template versions,
but still reads heads and versions separately. `StudioRepository.templatePage`
now selects at most `limit + 1` heads before joining their captured version IDs
in one statement. The outer order retains the ascending UUID cursor contract.
A left join exposes missing versions to the service's existing 404 denial;
the service explicitly verifies version ID and template ownership before parsing
content. Only the requested items are returned; the additional head is a cursor
sentinel. No historical version, price or stored pointer is modified.

Initial and final `StudioAuthorization.templates` checks remain intact, including
empty pages. HTTP authentication and the management-route Manager check are also
unchanged. There is no response/authority cache, global relation-join setting,
transaction/lock removal, password-setting change, new route/schema or migration.
The active/archive, Couple booking authority and Android/editor rules stay in
their existing owners. OpenAPI remains unchanged by this patch.

SQL values are bound through `Prisma.sql`; schema identifiers come from the
constructed client's metadata and are quoted. The native schema test uses a name
containing a space and quote, with different public and isolated table contents.
The query approach follows [Prisma v7 raw-query parameterization](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries)
and [PostgreSQL deterministic ordered limits](https://www.postgresql.org/docs/18/queries-limit.html).

## Native correctness

The pre-change focused template suite passes four tests. A new driver-budget test
then fails as intended, observing four commands where three are required. After
the change, the focused PostgreSQL run passes **64/64 tests in three files**, with
no skips: template performance (10), Studio lifecycle/HTTP waves (42) and Identity
driver/fresh-authority checks (12).

Template cases cover actual three-command service budgets for 1/4/20 items and an
empty page; unchanged JSON/order/cursors; active/archive and quoted schema reads;
missing/misowned versions; a revised/archived head after snapshot capture; and both
session and role revocation on empty and populated pages. The previous batched
read tests are adapted to the new snapshot boundary, retaining their behavioral
assertions. The native regression ceiling for `templates-20` tightens **4 → 3**;
modeled latency investigation bands remain unchanged.

Retain the first schema-fixture failure: changing a live head without advancing
its revision correctly triggers `Invitation revision must advance once`. The test
is repaired through the existing `saveTemplate` owner command, with the guard
unchanged. Retain the initial exact-optional-property type error and local log
collector failures separately. None is counted as a successful check, and no test,
timeout, audit or coverage threshold is weakened.

## Controlled measurement in the serving Railway container

The original service stays on deployment `ba3a5b90-fa14-4ff6-9f30-5f364af57b6e`,
source `d9c41b7f12e89d62721f47242cd7345f17072b3c`, image
`sha256:66c09298ba527f19c7773ad1d29e46a5cec92886cd4a4774e4dedede6fe84e76`,
one SFO replica. Provider/database endpoint, worker configuration, commands and
the full application-variable/service-configuration fingerprints are unchanged.
General diagnostics and safe-read DB deadlines remain off.

One temporary Node process in that container hosts three isolated loopback Studio
routers sharing one max-one Prisma pool. Startup requires
`default_transaction_read_only=on`; only template GETs are admitted. Storage,
provider operations and mutation/denial audit callbacks are forbidden. The native
connection uses one of the two ordinary spare slots in the existing 60-connection
allocation; the provider/pooler utility allocation stays intact. Operator inventory
connections close before native measurement. No application/provider cap changes.

The variants use the same manager session, database, exact template facts, pool,
router and region. Baseline imports the three immutable pre-PERF-06 Design,
StudioAuthorization and Identity editor modules from
`3c6e8984c547d92f25dc4959c44503321e5f5528`. Deployed imports current modules.
Candidate imports only the new Design/Repository modules, transpiled in memory.
No source file is written to the container and no old whole application is deployed.
The receipt pins source and compiled-module hashes.

An unmeasured pilot precedes one warm-up triplet per case and **twenty alternating
matched triplets per case**. Each triplet reverses baseline/candidate order between
rounds, with deployed in the middle. One request runs at a time, with 100 ms gaps,
no retries and a 25-second fail-stop. The three cases return one item, four items,
and one cursor-selected item. A `limit=20` response is not called twenty-item live
evidence; full 1/4/20 cardinality is covered locally as explicitly authorized.

Nearest-rank p95 of twenty steady samples, milliseconds:

| Returned case    | Before PERF-06 | Deployed | Candidate | Original → candidate | Deployed → candidate | Driver commands |
| ---------------- | -------------: | -------: | --------: | -------------------: | -------------------: | --------------- |
| One template     |      1,356.756 |  904.362 |   756.246 |              44.261% |              16.378% | 9 → 6 → 5       |
| Four templates   |      1,350.983 |  901.837 |   757.542 |              43.927% |              16.000% | 9 → 6 → 5       |
| One after cursor |      1,353.077 |  902.461 |   753.552 |              44.308% |              16.500% | 9 → 6 → 5       |

All **180/180 steady native HTTP samples** return 200 and all sixty triplets match
the complete response hashes, including version IDs/order/cursors. Nine campaign
warm-ups and nine separate pilot samples also return 200. These are authenticated
loopback HTTP durations inside the actual container, including router/service work;
they exclude public Railway ingress and client network. They are not public HTTP
or whole-application improvement claims. Service-only work is **6 → 4 → 3**; the
full management HTTP flow also retains middleware and management authorization.

The initial at-least-30% goal is met against the original pre-PERF-06 baseline in
this owner-selected four-template live scope. The additional patch improves the
already optimized deployed variant by 16–16.5%, not another 30%. Preserve the old
[rollout's slower/inconsistent cohorts](backend-performance-railway-rollout-2026-10-16.md)
and the initial neutral batching attempt in
[the original implementation report](backend-performance-06-10.md).

## Preservation, cleanup and release gate

Nineteen selected business/profile/template table digests and all 61 applied
migration checksums match before/after; migration files match the database. Both
native template-history digests match. Session login/logout/audit effects remain
separate from business history. All ten discovery/pilot/campaign public session
operations match the pinned deployment's logs. Native loopback requests are
recorded by their own collector and are not counted as public application logs.

A separate direct public-ingress baseline retains twenty steady reads per case
plus three initial reads, all 63 returning 200 with matching native response
hashes and no-store headers. Login returns 201, logout 204 and revoked token reuse 401. All 66 operations correlate to the same deployment's completion logs. The
receipt separates client and backend percentiles; these current-version public
observations are the baseline for a later approved rollout, not the native
comparison's improvement percentages.

The temporary pool and all three servers close. The dedicated SSH key is revoked;
subsequent SSH transport is denied and only its owned local key/discovery files
are removed. Cleanup completes well inside the conservative 04:42–05:27 UTC
45-minute window. The preflight's initial `authorizedAt` value is a conservative
window anchor, not an asserted exact human-message timestamp. Its utility-slot
label is clarified by the postflight: one ordinary spare slot is allocated and
provider/pooler utility slots remain unchanged.

The [sanitized receipt](../tasks/evidence/perf06-verification-2026-10-18.json)
contains raw numeric samples, source/module provenance, exact test/check results,
request correlation, preservation/cleanup receipts and operator-artifact hashes.
Raw artifacts are retained under `output/perf06-20261018/`; credentials/tokens and
template response payloads are excluded. The temporary program containing its
session token is held in memory only and never saved.

Merge/deployment requires the reviewed exact head, green required CI and owner
authorization under the existing backend rollout policy. After rollout, verify
the same public template cases and revocation, unchanged histories/configuration
and exact deployment logs. Rollback is a source revert to the preceding reviewed
implementation; no migration rollback or business-history rewrite is required.
PERF-06's canonical checkbox remains open until that release gate is complete.
PERF-13 and the existing production **NO_GO** remain unchanged.
