# Backend read performance: Guests, Seating and Invitations

This backend-only change keeps the existing HTTP routes, schemas, pagination,
errors, role requirements and OpenAPI artifact. It adds no migration or provider
operation and does not change commercial, payment or attendance rules.

## Transaction and concurrency behavior

`PrismaBookingBoundary.run` remains the exclusive command boundary.
`runRead` takes a shared advisory lock using the same normalized booking key,
allowing readers to overlap while commands still wait. Authorization and current
Booking/Identity row locks remain inside the transaction.

A read callback must perform only database reads/validation until it calls
`requireWriteScope`. Guest workspace/default-group initialization, Staff settings
initialization and Seating revision/print-registry repair call this guard before
their first write. If the callback holds a shared scope, the boundary rolls that
transaction back, releases its locks, and reruns the complete callback under an
exclusive lock. It checks authorization and current state again, so simultaneous
first reads or stale-plan reads cannot produce duplicate history.

Never upgrade a shared lock in place. Never place provider I/O, non-transactional
effects or unguarded mutations inside a `runRead` callback. Nested commands request
the same exclusive retry rather than silently running under a shared lock. These
facades are internal; the HTTP caller cannot choose its authority or lock mode.

`createScopedLayoutReader` enlists layout snapshot reads in the active transaction.
Seating and Printable no longer acquire a second pool connection while holding
booking locks. This removes the application-level wait cycle where the other pool
connections are occupied by transactions waiting for that booking lock.

Booking-owned readers reuse a locked Booking snapshot only within a shared read
transaction. Weak transaction keys bound its lifetime. Command scopes read again
to observe their own changes; subsequent requests use a new snapshot. Session,
role and access permissions are not cached across requests.

## Bounded database work

Invitation lists read a page of design heads and their immutable revisions in two
queries rather than invoking the public detail reader for every item. Each revision
must belong to the captured design and booking. The service checks current booking
authority before reading and again before returning the whole page, including an
empty page. A concurrent edit does not reprice or rewrite any immutable revision.

Venue provides an optional batch eligibility capability alongside the existing
single-layout reader. Both use the same implementation: resolve version ownership,
lock distinct Hall keys then template keys in sorted order, take corresponding
row locks, and re-read lifecycle/current-version/capacity facts after locking.
Geometry is summed in SQL. Draft or missing versions are still concealed.
Seating uses the batch capability for options; compatible older port implementations
can still serve single-version eligibility.

Seating reuses the planning facts already checked during revalidation instead of
reading them again only to fill the response. Current planning fields remain
separate from the immutable plan's original revision/headcount.

## Validation and operational limits

On the same Node 24.21.0/Prisma 7.10.0 and isolated PostgreSQL, three samples per
case at a controlled 100 ms driver delay gave these medians:

| Case                                       | Original | Updated | Driver SQL commands, original → updated |
| ------------------------------------------ | -------: | ------: | --------------------------------------- |
| Four concurrent Guest/current-Seating GETs | 12.004 s | 3.978 s | 27/27/27/50 → 25/25/25/37               |
| Ten layout options                         | 13.665 s | 3.643 s | 134 → 34                                |
| Twenty invitation designs                  |  6.538 s | 3.310 s | 331 → 32                                |

This comparison isolates the performance code change. The subsequent aligned
Prisma 7.10.1 patch removes the vulnerable deepmerge-ts dependency from the CLI
configuration path. The old exception expired on 2026-10-16 and is removed rather
than extended. The [upstream patch](https://github.com/prisma/orm/releases/tag/7.10.1)
and [advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) are the remediation
sources; the audit policy and its expired-exception tests remain unchanged.

Regression tests cover a pool with one connection, constant query work for a
1-item versus 20-item invitation page, correct latest revisions and pagination,
1-layout versus 10-layout eligibility, concurrent first workspace reads,
same-booking reader/writer exclusion, single stale seating repair, and fresh facts
after a planning change. Invitation authorization tests revoke real access during
the read and require denial for both populated and empty pages.

The investigation and repeatable timing experiments use a separate loopback
PostgreSQL cluster, immutable migrations and synthetic fixtures with controlled
Storage and no AI/provider operations. The comparison uses the same Node runtime,
database configuration and 100 ms driver-delay model for original and updated
source. Driver-command counts include transaction/locking SQL; Prisma query-event
budgets in tests exclude some driver control commands and are compared within
the same instrumentation.

Do not treat local timings or controlled-provider tests as a deployed Railway
latency measurement or external integration acceptance. Existing Linux CI migration,
integration, per-file coverage, dependency-audit and quality gates remain required.
The broad parallel Windows coverage attempt and any native-worker/time-limit
failures are retained as failed evidence, not converted into a full-suite pass.

HTTP deadlines, transaction timeouts and pool sizes are unchanged. In particular,
an HTTP timeout is still not proof that a database transaction or provider effect
was canceled. Operational pool budgeting and cancellation need a separately
verified rollout; no payment retry/idempotency/UNKNOWN semantics are weakened here.

Guest counts never replace explicit planned attendance. NONE check-in remains
unknown/null. Contract, invoice, seating and print history remains immutable.
