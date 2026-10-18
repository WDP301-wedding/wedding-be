# PERF-06–10 backend read optimization

Date: 2026-10-16 (Asia/Saigon). Baseline source: `3c6e898`.
Backend-only implementation. No migration, Railway rollout, region change,
provider write, paid generation or real-money payment is part of this change.
The existing SPEC/RV acceptance history and product NO_GO decision are preserved.

2026-10-18 PERF-06 follow-up: [joined template snapshot and controlled live comparison](backend-performance-06-verification-2026-10-18.md)
reduces service work from four to three commands while preserving both authority
checks. In the owner-authorized four-template live scope, twenty matched native
triplets per case show 43.9–44.3% lower p95 versus the original pre-PERF-06 source,
and 16–16.5% versus the deployed batching implementation. Local 1/4/20/empty-page,
ownership, schema and revocation checks pass. The report keeps native/public timing
and the pending reviewed rollout gate separate; the original experiments below
remain unchanged.

Subsequent [PERF-06 closure](backend-performance-06-closure-2026-10-18.md): PR #66
is merged/deployed after owner authorization and both exact-head/merge CI pass
2,076 tests. All 63 after-rollout public reads return 200, revoked-token checks
pass and all 71 operations correlate. Backend p95 improves 17.2–17.5% over the
already optimized deployed version; client p95 worsens in this cohort and stays
visible under PERF-13. Histories/configuration remain unchanged; production NO_GO
is not lifted.

## Implementation and contracts

| Task    | Implementation                                                                                                              | Preserved behavior                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PERF-06 | Capture template heads, fetch immutable versions as one set, validate ownership                                             | Cursor/order, active/archive selection, captured revision, both authority checks including empty pages                                                       |
| PERF-07 | Fetch print lines/current revisions in sets; select latest unexpired successors with SQL DISTINCT ON                        | Descending createdAt/id cursor, immutable totals/charges, order/booking ownership, missing revision behavior, post-read Manager recheck                      |
| PERF-08 | Avoid transactions around pure role checks; Booking-owned audience EXISTS query; initial/final identity and audience checks | Account visibility, roleless consultation eligibility, Manager assignment, revoked access/session denial, no permission cache                                |
| PERF-09 | SQL-bounded public hall pagination and media set reads for halls/dishes/menu packages                                       | Invalid/retired hall cursor 422, publication/active concealment, stable order, detached-asset exclusion, fresh signing with existing expiry                  |
| PERF-10 | Join generation metadata; read at most three reporting owners concurrently; coalesce automatic GET refreshes per Manager    | 60-second freshness, source fences/cursors, failure fallback, strict rebuild failure, generation CAS, cursor pinning, nullable attendance and money formulas |

The new media batch method is internal. HTTP routes, schemas, OpenAPI identity and
provider versions are unchanged. Inbox/unread resolve authority in the service
before and after reading instead of another middleware resolution. A changed
audience during a read returns the existing 404 envelope; revoked/expired sessions
still return 401. Manager analytics reads and exports revalidate the requesting
session/role after projection work. Command locks, idempotency and post-lock
authority gates are unchanged.

SQL identifiers come only from the constructed client's schema metadata; all
request/owner values are bound parameters. Print proposals are reduced in PostgreSQL,
avoiding transfer of every historical proposal for in-memory distinct. No catalog
cache or signed-URL cache is added.

The initial template experiment was neutral: Prisma already batched the old
per-item findUnique calls into one driver command (six total commands per page).
The retained change additionally uses an Identity-owned authority-only reader
where clientKind is unused, removing two Session reads while retaining both
authority checks. Editors still resolve clientKind, and scoped command reads
retain Identity's locks and post-lock revalidation. The neutral experiment is
recorded separately instead of attributing a speedup to explicit batching alone.

Refresh coalescing is process-local and retains pending work, never responses or
permissions. It is keyed by Manager scope and deleted on success/failure. Scheduled
refresh/rebuild and other replicas retain generation compare-and-swap protection.
This is not a distributed refresh lock. Pagination remains sequential within each
source; independent owners run in two groups of three without raising pool limits.

## Reproduction and evidence boundaries

`scripts/performance-06-10.mjs` exclusively creates temporary copies of pre-change
modules from the pinned commit, runs the native-owner measurement and removes
exactly those files in finally. Run separately from compiler/lint/coverage, which
discover source files. It uses only the loopback administrator in private
`.env.demo` and disposable databases. It never resets branches or shared data.

Use Node 24.21.0 from `.node-version`, then run:

```powershell
node scripts/performance-06-10.mjs
```

The comparison alternates old/current execution on identical synthetic fixtures,
retains warm-up separately from 20 samples per case/variant, checks normalized
response equality and counts actual driver commands including transaction control.
It models 40 ms per driver submission with pool maximum 10 unchanged. These are
controlled local measurements, not Railway or real Storage timings. The normal
integration run uses two current-only samples without added delay. Only timings,
counts and case labels are written; tokens, credentials and payloads are omitted.

Full acceptance requires matched Railway p95 on the reviewed/deployed candidate.
The supplied accounts authorize bounded runtime tests; rollout and new provider
fixtures remain separate. Canonical PERF checkboxes stay open until live targets
have evidence. PERF-03 container/driver attribution remains a separate gate.

## Verification record

[Sanitized local measurements](../tasks/evidence/perf06-10-local-comparison-2026-10-16.json)
retain three experiments, including the neutral template attempt and sequential
notification recheck attempt. Each row below has 20 alternating samples per variant,
one separate warm-up per variant, 40 ms modeled delay, pool maximum 10 and the same
synthetic fixture. All compared response bodies matched after generation-ID
normalization; this does not imply a real provider accepted an operation.

| Case                         | Before p95 ms | Current p95 ms | Reduction | Driver commands |
| ---------------------------- | ------------: | -------------: | --------: | --------------- |
| 20 templates                 |        283.63 |         188.87 |     33.4% | 6 → 4           |
| 20 requested print orders    |       1082.62 |         236.56 |     78.1% | 23 → 5          |
| Empty inbox                  |        378.64 |         236.35 |     37.6% | 8 → 6           |
| Populated inbox              |        377.81 |         236.26 |     37.5% | 8 → 6           |
| Empty unread count           |        330.20 |         188.82 |     42.8% | 7 → 5           |
| Populated unread count       |        330.46 |         189.17 |     42.8% | 7 → 5           |
| 20 halls, no assets          |        236.15 |         141.99 |     39.9% | 41 → 3          |
| 20 halls, one asset each     |        237.42 |         141.57 |     40.4% | 41 → 3          |
| Analytics warm service read  |        333.97 |         284.44 |     14.8% | 7 → 6           |
| Analytics projection refresh |       2779.89 |        1424.44 |     48.8% | 59 → 58         |

Print-page cardinality tests cover 1/3/20 requested orders; the existing native
replacement test additionally compares pending proposal, commercial totals and
the complete management page against the detail API after superseding a proposal.
This is not a 20-approved-order monetary performance benchmark. Template tests
cover 1/4/20, revision/archive during the batch, ownership and empty-page revocation.
Catalog tests cover SQL limits, stable tied order, missing/retired cursor errors,
missing batch resources and fresh per-read signing. Inbox tests cover empty and
populated visibility, malformed/missing auth, revoked session and audience removal
during reads. Analytics tests cover isolated scopes, refresh failure/retry,
three-source concurrency, HTTP revalidation, source ordering and existing money,
unknown-attendance and cursor behavior.

Verified with Node 24.21.0: TypeScript typecheck, tracked-source Prettier, ESLint
(zero warnings), 49 contract tests across 18 files, OpenAPI generation/check,
production build and `npm run audit:ci` passed. The audit reported no high/critical
advisories. All 60 immutable migrations applied successfully to the unique local
test database. The full native suite and per-file coverage gate run separately;
their final results belong to the PR checks and verification receipt.

OpenAPI SHA-256 is unchanged from the baseline:
`68a47cb4d43a0ea185ce3cd7c28928011c705bc6aa101f2f92a6261ec5cda694`.
No migration or API version change is introduced.

Initial database recovery and failed attempts are retained in local logs and are
not counted as passing evidence. Local formatting enumerates tracked files and
new task files, avoiding existing untracked audit/UI snapshots. Local ESLint uses
`--ignore-pattern output/**` to avoid a pre-existing audit source snapshot. All
tracked source checks, test deadlines and coverage thresholds remain enforced.

SQL semantics were checked against the
[PostgreSQL SELECT reference](https://www.postgresql.org/docs/18/sql-select.html).

The subsequent owner-authorized merge and deployment are recorded in the
[matched Railway rollout receipt](backend-performance-railway-rollout-2026-10-16.md).
It separates observed live improvements, slower cohorts and incomplete acceptance
from the controlled native measurements above.
