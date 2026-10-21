# PERF-07 verified merge and Railway rollout

Completed on 2026-10-18 (Asia/Saigon). The owner explicitly authorizes merging
[PR #67](https://github.com/WDP301-wedding/wedding-be/pull/67) and checking the resulting rollout. Reviewed head
`30e65b23740e3b1546766907a31aa429130703a7` merges as `873aa4c56eca6ef80563768554d726e5bae9eb46`.
Their Git trees match exactly; zero review threads remain unresolved.

The [original acceptance](backend-performance-07-closure-2026-10-18.md) and its
[sealed receipt](../tasks/evidence/perf07-closure-2026-10-18.json) stay unchanged,
including all raw results and preserved failures. This report supersedes only
their pending merge/rollout status. PERF-07 is complete on main in the authorized
three-existing-live-order and 1/3/20-local backend scope.

## CI and active source

[Exact-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39103129775) and
[merge CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/39103797172) both pass on their first attempt: 1,461 unit,
59 contract, 566 PostgreSQL integration and the full **2,086-test coverage suite**.
Coverage is 96.66% statements, 93.52% branches and 97.56% lines, with existing
per-file thresholds intact. Formatting, lint, typecheck, build, OpenAPI, immutable
migration checks and dependency audit pass. No gate is weakened.

The sole active deployment is `f100e2bd-1ad5-497b-989b-28f2f2e2f705`,
exact source `873aa4c56eca6ef80563768554d726e5bae9eb46`, image `sha256:cb99729e156b0d563c2463a92589cc65597bdb6f449092a353b67fa442dc0388`.
The preceding deployment `f0332652-cf57-4b46-807a-d0d92e75d5e3` stops.
This PR changes tests, evidence and checklists only. Application source, Prisma
schema/migrations, OpenAPI, dependencies, build and deployment configuration match
the preceding deployed source. Pool caps/reserve, acquisition/idle settings, workers,
region and provider settings remain unchanged. General diagnostics and DB safe-read
deadlines stay off. No new native pool or SSH key is introduced after merge.

## Public verification after rollout

All **63/63 print-list reads** return 200: one initial and twenty steady reads for
one order, three orders and the remaining two after a cursor. Every complete
response hash matches its native acceptance counterpart and retains no-store.
Health/live, readiness and OpenAPI return 200; the OpenAPI checksum matches source.
Anonymous management access returns 401. Login returns 201, logout 204, and revoked
token reuse returns 401 on both Identity and print listing. All **71/71 operations**
match exactly one completion log in the new deployment. No retry or discarded sample
is used; p95 is nearest rank.

| Case   | Before backend p95 ms | After backend p95 ms | Before client p95 ms | After client p95 ms |
| ------ | --------------------: | -------------------: | -------------------: | ------------------: |
| one    |               901.526 |              896.773 |             1160.227 |            1157.093 |
| three  |               901.436 |              896.885 |             1197.130 |            1167.372 |
| cursor |              1047.617 |             1047.005 |             1306.561 |            1378.185 |

These before/after cohorts use identical application code and selected records at
different times. They verify behavior and current latency; shared-load variation
is not attributed to a new optimization or any particular provider/network stage.
Cursor client p95 increases about 5.48% in this cohort; retain that tail result
under PERF-13 alongside the original small-page limits.
The earlier same-container comparison against pinned pre-optimization print and
authority modules remains the performance evidence: three mixed orders improve
32.579% (9 -> 6 HTTP driver commands), while one requested order regresses 19.568%
and cursor improves only 21.940%. Preserve both limits under PERF-13. The controlled
local twenty-requested-order model improves 77.710% (23 -> 5 service commands),
separate from live timings. No twenty-order or pending-proposal live fixture is claimed.

## Preservation and closure

All 21 selected business-table digests and all 61 applied migration checksums match
before/after. No live order, quotation, charge, payment, contract, invoice, planning
or check-in mutation is submitted. Session/audit lifecycle operations are the
operational exception. No paid/provider generation or frontend work occurs.

The original temporary read-only pool/servers are closed, its SSH key is revoked
with failed reuse, and its owned key files are removed. The dedicated local cluster
is stopped with zero test databases remaining. The original acceptance receipt and
all 46 pinned operator artifacts retain their checksums.

The [rollout receipt](../tasks/evidence/perf07-pr67-rollout-2026-10-18.json) records
owner approval, both CI runs, exact source/image continuity, raw numeric public
samples and log pairs, preservation and cleanup. The canonical main checklist is
closed for PERF-07. **PERF-13 remains open**; provider acceptance and production
**NO_GO** stay unchanged. No rollback is needed; the preceding reviewed source/image
remains the rollback reference without rewriting migrations or financial history.
