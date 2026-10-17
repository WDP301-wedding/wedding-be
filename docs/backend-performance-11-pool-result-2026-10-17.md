# PERF-11: selected pool allocation — 2026-10-17

**Keep Venue/Catalog=3, Analytics=2 and the six other owner pools=1 for the verified
bounded demo scope.** Readiness remains a separate max-1 pool. This profile is live
on Railway, with endpoint deadlines and global DB diagnostics still false.
Production remains NO_GO. Provider allocation acceptance was open at this checkpoint;
the later [provider allocation closure](backend-performance-11-closure-2026-10-17.md)
records Pool size5/client200 and closes PERF-11 for the admitted demo topology.

The [sealed evidence bundle](../tasks/evidence/perf11-pool-allocation-2026-10-17.json)
contains every trial, sampled DB/deployment state, native results, failed receipts,
corrected runner conclusions, source CI, matched HTTP logs and final cleanup.
The earlier [verification checkpoint](backend-performance-11-verification-2026-10-17.md)
and [trial ledger](backend-performance-11-pool-trial-2026-10-17.md) remain historical.

## Selected configuration

| Setting                                                 | Active value                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `DB_POOL_MAX`                                           | 1: Identity, Booking, Billing, Invitation, Guest and Notifications |
| `DB_POOL_MAX_VENUE_CATALOG`                             | 3                                                                  |
| `DB_POOL_MAX_ANALYTICS`                                 | 2                                                                  |
| Readiness / planned processes                           | 1 separate connection / 2 full application processes               |
| `DB_CONNECTION_RESERVE` / `DB_MAX_CONNECTIONS`          | 36 / 60                                                            |
| Owner acquisition / idle timeout                        | 2,000 / 60,000 ms, unchanged                                       |
| HTTP replica / region                                   | 1 / SFO, unchanged                                                 |
| `DB_SAFE_READ_DEADLINE_ENABLED` / global DB diagnostics | false / false                                                      |

The aggregate guard now counts both overrides exactly once:

```text
(6 × 1 + 3 catalog + 2 Analytics + 1 readiness) × 2 + 36 = 60
```

Each full process allocates 12 instead of 25. Two-process application allocation
falls **50 → 24 (52%)**. PostgreSQL's three superuser-reserved slots leave 57
ordinary slots; after two application processes, **33** remain instead of seven.
Reserve 36 includes 3 superuser slots, current Auth/PostgREST max-10 series each,
one operator and one migration allocation, and **11 for other provider consumers
and spare headroom**. These are declared allocations, not new provider limits.

Configured Storage/other provider aggregate ceilings, hosted instance multiplicity,
historical peak and admission for unrelated clients remain unverified. Do not
equate a PgBouncer client ceiling with backend slots, or blindly sum multiplexed
paths. See [Supabase connection limits](https://supabase.com/docs/guides/database/connecting-to-postgres/pooling-and-limits).
Changing pools alone does not establish production capacity or endpoint rollout
acceptance. Third full application/worker processes are not admitted by this budget.

## Why this profile survived

| Attempt                               | Evidence                                                                                                                                                                                    | Disposition                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| All owner pools 2                     | 118/118 GETs passed. Four-reader halls p95 851.10 → 1,061.99 ms; clean repeat at pool2 was 1,084.72 ms. Dishes median also rose.                                                            | Superseded to preserve the hot catalog pool    |
| Catalog 3 / seven others2             | Two app processes need 36 slots, leaving 21 ordinary; Auth/PostgREST maxima 20 plus operator/migration2 already need 22.                                                                    | Arithmetic rejected before deployment          |
| Catalog 3 / seven others1             | Halls p95 recovered to 850.08 ms. Analytics mixed-cohort four-reader p95 8,252.26 → 10,425.17 ms (+26.33%). Generation/refresh changes were retained.                                       | Rejected and restored to original pool3/source |
| Catalog 3 / Analytics 2 / six others1 | Fresh controlled comparison passed; no owner readiness regression in captured overview sources; final three-report check confirms all six sources READY.                                    | Selected                                       |
| Catalog 3 / Analytics 3 / six others1 | Twelve same-generation four-reader samples: median 1,743.36 → 1,737.93 ms; p95 1,917.40 → 1,886.39 ms. Extra 2 slots bought only 0.31%/1.62%, below predeclared 5% improvement requirement. | Returned to Analytics 2                        |

The uniform 2 trial initially passed the existing 25% investigation band; it was not
claimed as a latency improvement. Further measured tradeoffs and the new provider
finding justified the owner-specific allocation. Neutral latency is acceptable
here only because the deterministic connection-budget benefit is the objective.

## Final bounded comparison

Same routes, limit1, two blocks, four waves at reader caps 1/2/4, same source query
logic, diagnostics/deadlines false and no competing local test/typecheck process.
The fresh baseline is uniform 3; selected source changes only pool allocation/wiring.

| Route / readers                         | Baseline p95 ms | Selected p95 ms |
| --------------------------------------- | --------------- | --------------- |
| dishes / 1                              | 859.44          | 864.33          |
| dishes / 2                              | 2,076.13        | 2,020.33        |
| dishes / 4                              | 2,059.91        | 2,027.80        |
| halls / 1                               | 698.80          | 684.24          |
| halls / 2                               | 737.77          | 699.89          |
| halls / 4                               | 843.87          | 891.97          |
| Analytics overview / 4, same generation | 1,758.68        | 1,917.40        |

Both dishes cohorts include cold expansion in the first parallel block. The second
four-reader block was 1,143.61 → 1,125.24 ms; halls second block 843.87 → 828.45 ms.
Do not remove cold samples or infer a speedup from them. Catalogue cohorts have
only 4/8/16 samples per route/cap. Analytics has 12 same-generation four-reader
samples per profile; its ~9% difference from the earlier uniform 3 window is not
established as a causal pool effect: restoring Analytics 3 in a later same-source
comparison improved only1.62%. The observational bands are not an SLA.

The selected campaign returned 118/118 catalog/readiness GETs and 28/28 Analytics
GETs across baseline/candidate. Business snapshot/entity-ID hashes matched; auth
sessions were revoked with 204 and rejected with 401 afterwards. A final overview,
attendance and print-orders check on the restored selected runtime covered booking,
billing, venue, guest, staff and invitation: all READY in one generation. Overview
alone exposes only its three relevant checkpoints, not all six.

Across the full allocation campaign, **450/450 request IDs matched server logs**,
including expected login 201/logout 204/revocation 401. There were 1,054 DB snapshots,
peak 17 client backends including observers, and no sampled lock waiter/blocked
backend. Six observed old/new transitions completed; no third full runtime was
introduced. The transition from old uniform 3 to selected profile could allocate 37
application slots; subsequent selected/selected overlap is 24. Observed bounded
transitions do not prove arbitrary concurrent provider peaks fit.

## Correctness and cleanup

Publication review additionally rejects unknown/prototype JavaScript owner keys
before adapter construction, preventing fallback to the driver's default pool.
Three RED/GREEN regression cases were added; the publication native rerun passed
71/71 cases with zero skipped. Valid owner selection and measured query paths are
unchanged. Final PR CI is tracked in [PR #60 checks](https://github.com/WDP301-wedding/wedding-be/pull/60/checks).

Source `6c08b1ede2b27118693472b05098c492932368b6` passed
[both exact-head CI jobs](https://github.com/WDP301-wedding/wedding-be/actions/runs/39014538279),
including PostgreSQL integration/full coverage, static checks, OpenAPI/build/audit.
Locally nine files passed 68/68 focused tests, zero skipped. Separate disposable
loopback max3/1/1/3 reader/writer phases completed 192 operations and 96 updates
without error, then stopped PostgreSQL. Forwarding, owner selection, runtime wiring
and aggregate guard mutations were killed; source was restored after each review.

On the final serving replica, the compiled factory produced owned pools with active
caps 3/2/1, successful synthetic reads and reusable connections. Those probes are
separate from the serving pools and do not claim live per-request owner counters.
The same default max 1/acquire2s/idle60s configuration on the same source/direct DB
timed out an owned waiter after 2,002.61 ms, waiting 1 → 0, with reuse and pool closure.
Its unchanged default-pool configuration makes that earlier selected-replica receipt
applicable after the same-image restoration. No business pool was exhausted on purpose.

Safe-read/cancellation code, synthetic cancellation helper and OpenAPI blobs are
identical to the earlier verified source. Native cancellation tests passed again;
the earlier real server 57014/active 1 → 0 proof is retained. No HTTP endpoint deadline
was enabled; payment/provider UNKNOWN, idempotency and reconciliation semantics were
not changed, and no paid-provider/real-money command was executed.

Current deployment `53902bd7-eaed-4ad9-9c05-cd39e8412300`, instance
`f903f3d2-4d81-4880-bc3c-5e90bce83e60`, uses image
`sha256:eb5da835e553bb9e35319ed62b158eba83bb0a29a652f105d6f925c1b038ea47`.
Only the four authorized pool/reserve variables differ from the original; commands,
region, flags and sixty migration checksums match. Final readiness 200, no owned
probe session, no registered SSH key, owned key files absent and observers closed.

Failed receipts remain unchanged. Notably the Analytics 3 runner expected six
checkpoints in overview and stopped on that incorrect guard. The separate corrected
review confirms three READY overview sources and still returns to Analytics 2 on
the predeclared no-meaningful-gain rule; it does not relabel the raw attempt PASS.
The later three-report receipt supplies the six-source proof that early narration
overstated. Native max2 fixture assumptions and postflight buffer failures are also
retained with their corrections.

This completes the authorized try/adjust experiment. Six other owner endpoints were
not all load-tested at four readers; native small-pool correctness is distinct from
their full live latency acceptance. PERF-11's provider allocation/endpoint decision
gate stays open, PERF-13 remains open, and PERF-09's 20-item cohort was not repeated.
