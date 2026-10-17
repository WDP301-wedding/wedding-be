# Railway backend performance plan — 2026-10-16

Status: measurement and planning only. The owner requested a Railway baseline before
implementation. Application code, deployment settings, migrations and business
rules are unchanged by this plan. Canonical task status is in
[backend-revision-todo.md](backend-revision-todo.md#railway-performance-extension--2026-10-16).
Earlier SPEC/RV acceptance and the product NO_GO decision remain independent.

## Evidence and decisions

- Target: `wedding-be` / Railway environment named `production`, deployment
  `b1b875c0-25d8-4bcf-a6fe-2484bbb25c74`, commit
  `5b2536212e9a6feafbb48d9a71bba1f90ded08ae`.
- Baseline report: [Railway API audit](../docs/railway-api-performance-audit-2026-10-16.md).
  Raw measurements and scripts: `output/railway-api-performance-20261016/`.
- Existing Guest/Seating/design-list improvements from PR #45 are already deployed;
  their local simulated-RTT results are not a new Railway before/after comparison.
- Debug response headers identify backend `railway/us-west2`, while ingress is
  `sin1`. The same Supabase project's saved pooler is `ap-southeast-2` (Sydney).
  Confirm DB region with provider metadata and measure inside the container before
  attributing an exact percentage of latency to geographic distance.
- The live `public` schema contains 144 Prisma models plus `_prisma_migrations`,
  about 10.5 MiB including indexes/TOAST. No extra public table is proven obsolete.
  Table count alone is not a reason to merge or delete business/history tables.
- Preserve existing routes, schemas, pagination, role/owner boundaries and OpenAPI.
  No cross-request authorization/balance cache, weakened locks, mutable monetary
  history, changed Guest counts or inferred companion rules.

## Ordered work

### PERF-01 — Establish the live baseline

Dependencies: none. Scope: audit scripts, sanitized evidence, plan/backlog documents.
Measure 20 successful GET requests per selected route/role, initial probes separately,
and correlate request IDs with the exact deployment's application duration logs.
Keep client wall time, server duration, desktop DB timing and server SQL execution
as separate metrics. Publish sample counts, response item counts and unmeasured routes.
Acceptance: reproducible measurements with deployment identity, no secrets or payload
PII in evidence, and every coverage limitation stated explicitly.

### PERF-02 — Complete booking and Staff fixtures

Dependencies: PERF-01. Scope: authorized test-fixture/runbook and measurement extension.
The supplied Couple has no booking; do not create fake settlement or grant access
directly to manufacture a passing journey. Select an authorized existing synthetic
FULL booking with initialized Guest workspace/settings and stable Seating, plus an
assigned Staff event; otherwise arrange a dedicated fixture through normal owners.
Acceptance: successful measurements of groups, guests, planning, current seating,
layout options, invitation list, billing and assigned guest search, with counts and
no first-read initialization/repair mixed into steady-state numbers. Separate any
authorized initialization experiment from steady reads. No paid generation/payment.

### PERF-03 — Attribute DB round trips and pool waits

Dependencies: PERF-01; extends PERF-02 when its fixtures are ready. Proposed files:
`src/core/database/prisma.ts`, observability integration and focused tests (3–5 files).
Record bounded route/request correlation, driver query counts, acquire/lock/execute
timing, event-loop delay and pool active/idle/waiting, without SQL parameters/tokens.
Acceptance: explain at least one slow request in each measured high-priority family;
measure instrumentation overhead; protected metrics remain protected. Container-local
DB ping must be explicitly identified as such; desktop ping cannot substitute.

2026-10-17 completed measurement: [actual request/container attribution](../docs/backend-performance-03-attribution-2026-10-17.md)
records sixteen read families, exact request/log correlation, paired overhead,
runtime RTT and bounded DB wait snapshots. Distinguish lock-command/network elapsed
from pure server lock wait; the earlier Seating 500 remains unresolved PERF-13
evidence. Diagnostics/key cleanup and exact-source CI are recorded separately.

### PERF-04 — Test application location with the DB unchanged

Dependencies: PERF-03. Scope: authorized staging deployment configuration plus receipts
and rollback runbook (2–3 files). Confirm provider DB region, then compare the exact
same build/fixtures from current US West and an available APAC region, such as
Singapore. Keep replica count, connection configuration and worker activity controlled.
Acceptance: repeated matched p50/p95, container→DB timing, errors and provider
connectivity results; review any VNPAY egress-IP, TLS, cookies or callback consequences.
No DB migration or production region switch is part of this audit. A deployment
change requires its own reviewed rollout and authorization.

2026-10-17 execution: [same-image regional experiment](../docs/backend-performance-04-region-2026-10-17.md)
stopped at the required Singapore Seating 500 gate after a complete US West cohort
and a partial Singapore cohort. Full three-pair acceptance is not achieved.
Provider Sydney metadata, twenty runtime RTT samples per region, all 541 selected
HTTP/log matches and complete cleanup/retention are retained. Runtime stopped
within the owner's extended 120-minute ceiling. Canonical backlog disposition
remains in backend-revision-todo.md; the original acceptance and failures are not
rewritten by an owner decision about task closure.

Checkpoint after PERF-03/04: choose whether geography or query count is the larger
measured contributor. Do not combine the region switch and code optimization into
one un-attributable before/after result.

### PERF-05 — Reduce Identity reads on authenticated GETs

Dependencies: PERF-03. Proposed files: Identity session/scoped readers and their
focused integration tests (3–5 files). Resolve credential/session/account/roles using
a measured batched/joined owner query where supported; narrow selects to required
fields. Reuse only authority whose lifetime and transaction context are valid.
Inspect Couple overview's empty-grant path and response-only relation selection.
Acceptance: lower driver round trips and authenticated p95 by a meaningful amount
(initial target ≥30% at the same topology); expiry, disabled account, token/session
revocation and role changes still deny correctly, including concurrent revocation.
Never remove authoritative post-lock rechecks or reduce password security settings.

### PERF-06 — Batch invitation template versions

Dependencies: PERF-03; remeasure after PERF-05 if Identity changes land first.
Proposed files: `design.service.ts`, owner-level integration tests and evidence
(3–4 files). `listTemplates` currently loads current versions per template and
authorizes at both ends. Batch captured version IDs and validate template ownership;
retain both authority checks and immutable version semantics.
Acceptance: version lookup work remains bounded for 1/4/20 templates, same JSON and
cursor behavior, and revocation/archive/concurrent revision tests pass. Target ≥30%
p95 reduction on an identical fixture, with no authorization response cache.

### PERF-07 — Batch print-order detail reads

Dependencies: PERF-03. Proposed files: `print-order.service.ts`, print-order tests
and evidence (3–4 files). Fetch page lines, current commercial revisions and pending
proposals by sets of order/revision IDs, rather than awaited queries per order.
Acceptance: bounded query-count growth for 1/3/20 orders; identical ordering/cursors,
pending-proposal selection and immutable amounts. Preserve contract-linked once-only
charges and concurrent replacement/cancellation semantics. Target ≥30% p95 reduction.

### PERF-08 — Reduce repeated notification authority/scope reads

Dependencies: PERF-03/05. Proposed files: notification settings, Identity/Booking
reader only if required, and focused tests (3–5 files). Middleware resolution is
followed by `actor`, role-transaction and booking-scope reads even for an empty inbox.
Measure and consolidate redundant work within the correct owner/transaction scope.
Acceptance: empty/populated inbox and unread count keep current visibility; revoked
session/access cannot return old inbox data; no cross-request permission cache.
Target ≥30% p95 reduction for both endpoints.

### PERF-09 — Bound catalog pagination and media lookup work

Dependencies: PERF-03. Proposed files: catalog query/media readers, router and tests
(4–5 files). Public lists invoke `listSigned` per item, which rechecks resource
existence then loads assets; halls pagination currently loads all active halls before
slicing. Batch resource/assets lookups and push compatible pagination into SQL.
Acceptance: unchanged invalid-cursor and publication/retirement concealment behavior,
bounded query work for 1/20 items, fresh authorized signed URLs within their expiry.
Benchmark with/without assets separately; real Storage timings remain provider evidence.
Add public catalog caching only if this result still needs it, with explicit TTL,
invalidation and signed-URL expiry rules. Target ≥30% p95 reduction.

2026-10-17 owner disposition: PERF-09 is closed by explicit acceptance of the
read-only 1–3 Hall demo scope, without a twenty-item live measurement. No measured
cohort reaches the original 30% target. Preserve both original targets above,
the [initial evidence](evidence/perf09-catalog-readonly-2026-10-17.json) and the
[later owner decision](evidence/perf09-owner-acceptance-2026-10-17.json); this is
an accepted scope exception, not proof that those gates passed or a waiver for
other PERF tasks. No new fixture, cache, pool/region change or deadline rollout
is authorized by this disposition.

### PERF-10 — Separate analytics read and refresh cost

Dependencies: PERF-03. Proposed files: analytics service, projector/store and focused
tests (4–5 files). The current GET can refresh after 60 seconds or invalidation;
this refresh publishes/replaces derived generations and reads all reporting owners.
Measure fresh generation, stale/invalidated generation and concurrent first reads
separately. Coalesce or schedule refresh only while preserving the existing freshness,
source-ready, actor-scope and pinned-cursor contract; avoid unreviewed behavior changes.
Acceptance: warm p95 target ≤2 seconds at current topology, refresh p95 improves ≥30%,
no thundering herd, wrong-scope projection or hidden stale/unknown attendance/money.
These are experiment targets, not a promised SLA before implementation measurements.

Checkpoint after PERF-05–10: land and measure one slice at a time. Keep only changes
whose benefit exceeds run-to-run variance; record unsuccessful experiments too.

### PERF-11 — Budget aggregate pools and request cancellation

Dependencies: PERF-03 and the chosen topology. Split into separate small changes if
pool configuration and cancellation both need edits. Eight module pools can default
to ten connections each, plus readiness, while the DB advertises 60 connections.
This is theoretical oversubscription, not proof that this audit saw pool exhaustion.
Acceptance: explicit budget across replicas/workers/provider reserve, bounded waiting,
small-pool reader/writer regression proof, and deadline behavior that stops safe read
work. Preserve payment/provider UNKNOWN, reconciliation and idempotency: HTTP timeout
does not prove a transaction or external effect was canceled.

2026-10-17 [actual verification and sealed evidence](../docs/backend-performance-11-verification-2026-10-17.md):
inventory/overlap/queue/cancellation/regression verification is complete; acceptance
is HOLD because two full app processes leave seven ordinary slots while Auth's
configured maximum is ten. Resolve aggregate provider allocation separately;
deadline remains disabled and no PERF-09 cohort is repeated.

Subsequent authorized [pool allocation trial and adjustment](../docs/backend-performance-11-pool-result-2026-10-17.md)
keeps Catalog3/Analytics2/six others1, reducing two-process app allocation50 →24.
Source `6c08b1e` passes exact-head CI and bounded demo verification;68 focused tests
pass. Other provider allocation and endpoint decision remained open at that checkpoint.

The subsequent [PERF-11 closure](../docs/backend-performance-11-closure-2026-10-17.md)
records the owner-applied provider Pool size15 ->5/client200 setting, matched60/60
Storage HTTP200 and explicit allocation60 including two ordinary spare slots.
Queue/cancellation/small-pool proof is retained; the endpoint decision is DB deadline
OFF with the existing HTTP timeout30s active. Close PERF-11 for the admitted dedicated
demo topology; new processes/pool combinations require rebudgeting. Production and
PERF-13 gates remain separate; no PERF-09 repeat or missing-history invention.

### PERF-12 — Review schema cleanup separately

Dependencies: PERF-01, PERF-03. Scope: 145-table inventory, owner/dependency/retention
matrix and a cleanup proposal (2–3 documents initially). Check direct Prisma/raw-SQL
references, workers, FKs, JSON references, immutable snapshots, migrations and external
consumers. Three rehearsal schemas contain 363 additional tables; these are cleanup
candidates only after verifying no running consumers and retained-evidence requirements.
Acceptance: every proposed deletion has an explicit owner, dependency proof, backup/
recoverability and reviewed forward migration or environment-only cleanup procedure.
Never delete provider-owned `auth/storage/realtime/vault`, applied migrations, ledger,
audit, idempotency, outbox or snapshot history based on emptiness or low scan counts.
No business-table deletion or `DROP ... CASCADE` is authorized by this plan. Do not
promise an API speed gain from reclaiming unused rehearsal storage.

2026-10-16 review completed: [145-table owner/retention matrix](../docs/backend-schema-retention-matrix-2026-10-16.md)
and [review/procedure](../docs/backend-schema-retention-review-2026-10-16.md).
All public/rehearsal objects are retained; no deletion is eligible or approved.

### PERF-13 — Verify and guard the improved baseline

Dependencies: accepted optimization slices and PERF-02 for booking/Staff claims.
Scope: repeatable measurement/regression budgets and final handoff (3–5 files).
Re-run the exact baseline and an explicitly authorized bounded 1/2/4-reader test
with representative fixtures; abort on overload. Compare topology, cardinality,
warm/initial conditions, all statuses and p50/p95, rather than only the fastest run.
Acceptance: regression thresholds from measured stable results; no correctness or
security regression; rollback and unresolved provider/readiness gates recorded.

## Verification for implementation

After each source/schema slice, run required typecheck, lint, unit/integration and
contract tests, build, API generation/check and existing coverage/audit gates. New
migrations require disposable empty/upgrade rehearsal and retain migration history.
Tests must cover revocation, reader/writer races and immutable contract/payment/
invoice history where touched. Backend acceptance does not require frontend builds.

Documentation-only audit checks: changed-document Prettier, local evidence links and
`git diff --check`. No full application test result is claimed for this planning change.

## References

- [Railway regions](https://docs.railway.com/deployments/regions) and
  [edge/upstream distinction](https://docs.railway.com/guides/multi-region-api-failover).
- [Supabase region identifiers](https://supabase.com/docs/guides/platform/regions).
- [Prisma query optimization](https://www.prisma.io/docs/orm/v7/prisma-client/queries/advanced/query-optimization-performance).
- [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/17/using-explain.html) and
  [node-postgres pooling](https://node-postgres.com/features/pooling).

## Execution checkpoint — PERF-02–05

The owner's subsequent instruction on 2026-10-16 authorizes backend implementation
of PERF-02–05. The measurement-only status at the top records the original planning
phase. [Implementation and local verification](../docs/backend-performance-02-05.md)
keeps prepared code, controlled tests and pending Railway acceptance separate.
The owner confirmed no live initialized fixture is available (“chưa có”); proceed
with local synthetic fixtures without manufacturing shared settlement or FULL access.
PERF-04's [concrete experiment and rollback](../docs/performance-region-experiment.md)
await a selected test target, valid fixture and deployment authorization.

## Execution checkpoint — PERF-06–10

The owner's 2026-10-16 instruction authorizes these five backend implementation
slices and provides Railway test accounts for bounded verification. Implementation,
native-owner correctness and controlled measurements are recorded in
[PERF-06–10 evidence](../docs/backend-performance-06-10.md). Runtime rollout and
matched Railway p95 acceptance remain separate; retain canonical open checkboxes
until the live targets are demonstrated. No provider payment/generation or shared
data cleanup is authorized by this extension.

## Execution checkpoint — PERF-06–13 Railway rollout

The owner's subsequent instruction authorized sequential merge of PRs #48/#49,
controlled deployment and live verification. Commit `266dfa8` is now deployed;
exact merge-commit CI passed and all 777 matched read samples returned 200.
[The rollout receipt](../docs/backend-performance-railway-rollout-2026-10-16.md)
records the separate diagnostic experiment, unchanged selected business digests
and migrations, final configuration and restored auto-deploy policy. It supersedes
the earlier undeployed-candidate status, while keeping unmet latency, live
cancellation, assigned-Staff, region/container and provider gates explicit.

## Execution checkpoint — connection lifecycle and Analytics follow-up

The owner authorized the follow-up investigation, confirmed fixes, exact-head CI,
controlled deployment and repeated live verification, and requested an explanation
of fixture writes. [The 2026-10-17 follow-up](../docs/backend-performance-followup-2026-10-17.md)
records PRs #50–52, matched 10/60-second idle variants with the same pool cap,
separate runtime cancellation proof and Analytics cohorts. The fixture remains
retained in the shared demo database. Session revocation, derived projection
replacement and disposable local/CI database cleanup have different effects and
are documented separately. No business cleanup, provider payment/generation or
unconfirmed region change is part of this work. Earlier measurements and unmet
acceptance gates remain preserved.

## Execution checkpoint — remaining PERF evidence

[The 2026-10-17 acceptance follow-up](../docs/backend-performance-acceptance-2026-10-17.md)
records PR #53 merge and its exact-head/merge CI separately, real private Storage
media checks, natural-TTL Analytics observations and the Staff-window fixture
decision. The previous rebuild 409 remains retained. APAC placement and deadline
rollout stay deferred; no new application optimization is part of this follow-up.

The owner subsequently chose the separate audited historical synthetic Staff
fixture. Its draft date was seeded before the first commercial revision/payment;
normal owner APIs then established the confirmed named-Guest context. The
[Staff-window appendix](evidence/perf-staff-window-2026-10-17.json) retains actual
DB-clock window checks, separate initial/steady reads, unchanged original fixture
digests and session cleanup. This supplies the missing PERF-02 role/window cohort,
not a matched Staff speed-improvement baseline or production readiness.

## Execution checkpoint — PERF-04 matched region decision

The owner requested correction of the aborted Seating/pool experiment and a fresh
comparison, then explicitly accepted the byte-equivalent final Singapore image
and extended the total ceiling to 150 minutes. The [final report](../docs/backend-performance-04-rerun-2026-10-17.md)
records six complete cohorts / three pairs, sixteen families and 2,016 successful
business reads with exact request/log matching. Retain the original US West
service. Both temporary runtimes are stopped and scrubbed, source detached and
five temporary SSH keys revoked; selected business history and migrations match.
PERF-04 is complete in this synthetic scope. The earlier failed campaign remains
immutable; historical acquisition holder, enabled-worker capacity and production
readiness are not closed by scheduler isolation. PERF-13 and NO_GO remain.
