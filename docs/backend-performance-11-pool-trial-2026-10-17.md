# PERF-11 pool allocation trial — 2026-10-17

The owner authorized trying pool 2 and adjusting the allocation if results worsened.
This supersedes the earlier inventory-only restriction for this bounded experiment;
region and endpoint deadlines remain unchanged. Production remains NO_GO.

The uniform-pool trial used source `650e14f154027dca3bfacb7b1ae6f395fa2d9ed5` and
the same image, with diagnostics=false and deadline=false throughout. Only
`DB_POOL_MAX` changed from 3 to 2. Two baseline blocks and two candidate blocks
used the same dishes/halls limit-1 GETs, four waves at each of 1/2/4 readers per
block. All 118 requests, including warm/readiness probes, returned 200; returned
entity-ID hashes matched. The observed DB peak was 16 client backends; no sampled
lock waiter or blocked backend. Old/new overlap was directly observed, and the
previous runtime exited before candidate measurements.

| Route/readers | Pool 3 p95 ms | Uniform pool 2 p95 ms |
| ------------- | ------------- | --------------------- |
| dishes / 1    | 851.58        | 783.50                |
| dishes / 2    | 2,140.55      | 1,887.03              |
| dishes / 4    | 2,008.50      | 1,351.13              |
| halls / 1     | 705.62        | 650.22                |
| halls / 2     | 700.14        | 648.87                |
| halls / 4     | 851.10        | 1,061.99              |

Preserve both blocks: first parallel dishes waves include cold pool expansion.
Do not claim their smaller candidate p95 proves a speedup. In the second block,
four-reader dishes p95 moved 1,152.28 → 1,335.27 ms; overall dishes median moved
999.28 → 1,195.63 ms. Four-reader halls p95 increased 24.78%. The trial's predeclared
25% investigation band did not reject uniform pool 2, but the repeated tail and
median tradeoff motivates a better allocation rather than silently calling it a
latency win. Cohorts are small and bounded, not a capacity/SLA demonstration.
Local typecheck/lint ran during the candidate window; client contention is a
potential measurement confound, so the next measured window must run without them.

## Catalog-specific allocation under evaluation

Allow an optional `DB_POOL_MAX_VENUE_CATALOG`, defaulting to `DB_POOL_MAX`. Only the
Venue/Catalog runtime selects that override. Both driver adapter paths receive
the same budgeted maximum. The startup guard counts it exactly once:

```text
(7 × DB_POOL_MAX + DB_POOL_MAX_VENUE_CATALOG + 1 readiness)
  × DB_PLANNED_PROCESSES + DB_CONNECTION_RESERVE <= DB_MAX_CONNECTIONS
```

Candidate: ordinary owner max 2, catalog max 3, planned processes 2, reserve 24.
Each full application process allocates 18; two allocate 36 instead of 50.
With three superuser-reserved slots, 21 ordinary slots remain for other clients.
This retains the catalog's tested concurrency while reducing the seven other
owner limits; it is not evidence that all provider maxima fit in those 21 slots.
Configured Auth max 10 leaves 11 for other ordinary consumers, operator/migration
and spare headroom; that allocation acceptance remains a separate open gate.

The existing defaults remain 3/3/reserve10 until explicitly configured. Pool-size
validation and the aggregate guard reject invalid/excessive catalog overrides.
No timeout, SQL enrollment, business rule, migration or OpenAPI change is included.

The first candidate-2 local run preserved 34 passing and two failed tests: the
adapter test assumed max=3 despite a correctly forwarded environment max=2. Tests
now explicitly cover 2/3 and both diagnostic paths. The retry passed 38/38 focused
tests. Separate disposable-loopback mixed readers/writers completed 192 operations
and exactly 96 updates over alternating 3/2/2/3 phases, with no errors. The cluster
was stopped. A mutation forcing max=3 killed the new max2 cases, then restoration
passed. New override tests failed before implementation and passed afterwards.

The balanced source must pass review and exact-head CI before a pinned trial
deployment. Measure with diagnostics/deadline still false, no competing local
validation process, matching routes/reader counts, and at most two runtime
deployments. Stop on unexpected status or 45 observed client backends; wait for
the prior runtime to exit. Reuse bounded queue/cancellation proof and validate the
new allocation; do not rerun PERF-09's 20-item cohort. Preserve all failed attempts,
source/variable hashes and cleanup. The final trial result is recorded separately.
