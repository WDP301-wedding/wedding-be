# PERF-07 print-order read acceptance

Date: 2026-10-18 (Asia/Saigon). Backend scope: management print-order listing.
The owner authorizes three existing live orders and full local cardinality,
proposal and financial-race checks. The batched implementation is already deployed;
this follow-up adds regression coverage and acceptance evidence. No application
source, schema, OpenAPI, provider setting or applied migration changes.

## Source and experiment boundaries

The sole active Railway deployment is `f0332652-cf57-4b46-807a-d0d92e75d5e3`,
source `df945b6f4ad10a44f37134e76a662f041283325b`, image
`sha256:cb99729e156b0d563c2463a92589cc65597bdb6f449092a353b67fa442dc0388`.
Its print service is unchanged from the implementation covered by the earlier
[PERF-06–10 report](backend-performance-06-10.md). Full-runtime CI on that deployed
source passes 2,076 tests; new regression tests have their own PR checks and must
pass before merge. No new runtime optimization or rollout is represented here.

The native comparison runs the actual management Express router over loopback
HTTP inside that same SFO container. The historical variant loads only the pinned
pre-optimization print service, Studio authorization and Invitation Editor reader
from `3c6e8984c547d92f25dc4959c44503321e5f5528`; the deployed variant uses the
container's modules. The comparison includes the associated authority-reader
changes, and does not isolate SQL batching alone. Both retain the same current
router, resolver, database, one-connection pool and selected records. Source and
transpiled-module hashes are recorded; historical modules are imported from memory.

Each case retains one initial pair and twenty alternating steady pairs, sequential
requests, 750 ms spacing and nearest-rank p95. All 126 native responses return 200,
retain `Cache-Control: no-store` and match their paired complete response hashes.
There are no retries or discarded tail samples. This is a light-load experiment,
not capacity, concurrency or public-ingress proof.

## Native result on three existing live orders

The three existing statuses are REQUESTED, IN_PRODUCTION and CANCELLED. Two have
commercial revisions; none has a pending proposal. The cursor case returns the
remaining two existing orders. No fixture is created or changed live.

| Returned case                 | Before p95 ms | Deployed p95 ms |    Reduction | HTTP driver commands |
| ----------------------------- | ------------: | --------------: | -----------: | -------------------- |
| One requested order           |       754.766 |         902.459 | **−19.568%** | 5 → 6                |
| Three mixed orders            |     1,348.201 |         908.967 |  **32.579%** | 9 → 6                |
| Two mixed orders after cursor |     1,350.984 |       1,054.579 |  **21.940%** | 9 → 7                |

The selected three-order page meets the original at-least-30% target. The one-order
page regresses and the cursor case stays below that target; these results remain
visible under PERF-13. The retained final fresh Manager check costs an additional
query on the small requested-only page. Do not remove that check to improve a
benchmark. No blanket per-case or end-to-end improvement is claimed.

Separate public reads exercise this deployed source through real ingress, with
one initial and twenty steady requests per case, complete native-response hash
comparison, request/completion-log correlation, logout and revoked-token checks.
They establish public behavior and current latency only: no public before/after
rollout comparison is performed in this follow-up. The sealed receipt retains
client and backend timings separately.

All **63/63 public reads** succeed, and **81/81 public/session operations** match
exactly one completion log in the pinned deployment. Login returns 201, logout
204, and revoked reuse returns 401 on both Identity and the print-list route.

| Public case  | Client p95 ms | Backend p95 ms |
| ------------ | ------------: | -------------: |
| One order    |     1,160.227 |        901.526 |
| Three orders |     1,197.130 |        901.436 |
| After cursor |     1,306.561 |      1,047.617 |

## Local cardinality and commercial correctness

A dedicated loopback PostgreSQL 18.6 cluster applies all 61 migrations to disposable
databases. The controlled timing model holds a single connection and adds 40 ms
to each real driver submission in both variants. Twenty samples per variant,
alternating execution and separately excluded initial reads retain identical
responses. These modeled service timings exclude HTTP, real provider latency and
live monetary operations.

| Requested orders | Before p95 ms | Current p95 ms | Reduction | Service driver commands |
| ---------------- | ------------: | -------------: | --------: | ----------------------- |
| 1                |       202.167 |        250.462 |  −23.889% | 4 → 5                   |
| 3                |       282.119 |        249.983 |   11.391% | 6 → 5                   |
| 20               |     1,096.086 |        244.316 |   77.710% | 23 → 5                  |

Regression tests also cover 1/3/20 **approved orders each with a successor
proposal**, with constant driver-command counts, complete expected snapshots and
separate accepted/proposed totals. That is a cardinality/correctness check, not a
twenty-approved-order before/after timing claim. Additional assertions cover:

- Stable descending UUID tie-breaks for identical creation times, cursor continuity
  and complete requested-order views.
- The newest unexpired successor, exact expiry boundary, unchanged accepted charge,
  and identical order, line, revision, ledger and audit histories across reads.
- Wrong order/booking ownership denials and the existing missing-revision behavior.
- Session and Manager-role removal during both empty and populated reads; the final
  check denies every revoked request. Removing that check in a temporary mutation
  probe causes all four tests to fail, and the original file is restored byte-for-byte.
- Simultaneous replacement approval and cancellation: exactly one succeeds, the
  loser conflicts, and the old accepted charge receives exactly one credit.
- Existing native lifecycle, stale/expired/superseded quotation, replacement and
  historical-report invariants. Three existing commercial API cases cover frozen
  contract print prices, over-allocation and fulfillment without a second charge.

The first added race fixture omitted its required cancellation reason and failed
validation; it is corrected to use the existing command contract. A later tied-time
fixture changed Prisma's `updatedAt`; the fixture now sets both timestamps explicitly
and still compares complete responses. Both failures and the mutation failure are
retained. No assertion, gate, test or runtime policy is weakened.

## Preservation, cleanup and disposition

The native connection is transaction-read-only and capped at one, allocated from
an existing ordinary spare slot; the provider/pooler utility allocation and total
capacity of 60 stay unchanged. Operator inventory and the native pool do not
overlap. Application pools, reserve, acquire/idle settings, workers, region and
provider configuration remain unchanged. General diagnostics and DB safe-read
deadlines remain off. Only the isolated probe collects driver diagnostics.

Before/after digests cover 21 selected booking, consultation, planning, guest,
staff, contract, invoice, billing and print-history tables. All 61 applied migration
checksums match their source files. Session lifecycle/audit operations are the
operational exception; no live order, quotation, charge, payment, contract or
invoice mutation is submitted. No paid/provider generation or frontend work occurs.

The native pool and loopback servers close. The dedicated SSH key is revoked at
`2026-10-18T06:05:21.863Z`, reuse is denied, and only its owned discovery/key files
are removed, well before the authorized deadline `2026-10-18T06:42:07.754Z`.
Temporary local databases and the local cluster are cleaned up after verification.

The [sealed receipt](../tasks/evidence/perf07-closure-2026-10-18.json) retains source,
raw numeric samples, paired-response hashes, query counts, public completion-log
matches, preservation and cleanup evidence. PERF-07 acceptance closes in this
explicit three-live-order / 1-3-20-local backend scope after final checks. PERF-13
retains the small-page regression and unmet cursor target. Production **NO_GO** and
provider acceptance remain unchanged. Existing reviewed source/image rollback is
available without rewriting a migration or financial history; no rollback is needed.
