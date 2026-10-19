# GET side effects and lock decision — 2026-10-19

This is the source audit for the owner's latency-attribution request, against
serving source `7b07d8bbf38e6a9808c08ab1642b2eb58e364a78` and the focused Seating
change. It is not a claim that every GET in the application is pure, nor a
provider acceptance audit. The retained HTTP screening scope is recorded in the
accompanying numeric evidence.

## Reads that can write

| GET family                                                                  | Source and condition                                                                                                                                               | Side effect / lock decision                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/bookings/:bookingId/guest-groups`, `/guests`, `/guest-plan`               | `GuestService.read` calls `initialize` when `GuestWorkspace` is absent (`src/modules/guest-management/application/guest.service.ts`).                              | Creates plan revision, workspace, default groups, history, audit and reporting facts. Calls `requireWriteScope` **before** these writes. Keep shared-read admission and rollback/retry under the exclusive Booking fence. Planned headcount comes from the planning owner, never guest count.       |
| `/bookings/:bookingId/check-in-settings`                                    | `StaffService.settings` calls `configuration` when missing (`src/modules/staff-operations/application/staff.service.ts`).                                          | Creates configuration/history/audit and calls the configuration-change hook. Keep `requireWriteScope` and exclusive retry. Initialization does not opt a booking into name check-in.                                                                                                                |
| `/bookings/:bookingId/seating-plans/current`, `/seating-plans/:planId`      | `SeatingService.revalidate` (`src/modules/seating-plan/application/seating.service.ts`).                                                                           | Invalid current sources can persist `REQUIRES_REVIEW`, registry invalidation and revision/outbox effects. A changed source can also advance `observedBookingRevision`. Both branches demand write scope before mutation. Keep the existing retry; do not treat the route method as proof of purity. |
| `/bookings/:bookingId/payments/:attemptId`                                  | `payments-billing.http-services.ts`, `attempt`: `VNPAY` and an enabled reconciliation provider.                                                                    | Can call provider reconciliation and subsequently apply settlement. Excluded from the read-only campaign except an inventory-verified **MANUAL / SUCCEEDED / DEPOSIT** attempt. Keep financial writer fences, idempotency and settlement evidence. No live provider command was executed.           |
| `/management/analytics/{overview,revenue,bookings,attendance,print-orders}` | `AnalyticsService.query`: absent, expired or invalidated projection, without a pinned cursor (`src/modules/analytics-dashboard/application/analytics.service.ts`). | May run `projector.refresh`, publish a derived generation and update projection/checkpoint state. These routes were outside the 38-route HTTP screen. Their refresh locks remain unchanged.                                                                                                         |
| `/management/analytics/exports/overview`                                    | `analytics.router.ts`, after report authorization/recheck.                                                                                                         | May refresh as above and explicitly appends `analytics.exported` audit evidence. Do not classify it as a database-only read.                                                                                                                                                                        |

Denied authorization can also append security/audit evidence. A successful,
initialized fixture with unchanged business digests establishes only the path
actually exercised; it does not prove that a lazy-init, stale-source, provider or
denial branch cannot write.

## Other inspected paths

Invitation design/template listing and detail (`infrastructure/design.service.ts`),
print-order listing/detail (`infrastructure/print-order.service.ts`), and guest
credential metadata (`guest-links.service.ts`, `metadata`) do not initialize or
repair business data on their successful inspected paths. Credential metadata
still defaults to an exclusive repository transaction; this follow-up does not
change that separate endpoint. Public derived-asset `readPublic` reads storage
and rechecks publication; creation belongs to `derive`, not that GET. Storage,
PDF/public rendering and provider latencies are not part of the native Seating
comparison.

The screenshot's claim that the Booking boundary exclusively serializes every
GET does not match the serving code: `PrismaBookingBoundary.runRead` already uses
`pg_advisory_xact_lock_shared`. Shared reads can coexist; writers still exclude
them. It releases the shared transaction before an exclusive retry, rather than
upgrading a held lock. Pool capacity can independently serialize callers.

## Focused change and invariants

No advisory or row fence is removed. Venue eligibility now acquires the same
sorted Hall advisory, Template advisory, Hall row, Template row fences in a
dependent materialized SQL chain. Eligibility is read in a **second statement**
after acquisition, preserving a fresh ReadCommitted snapshot if a retirement
committed while the reader waited. A single-version request additionally returns
the immutable geometry through the existing `toLayoutSnapshot` validator; bulk
eligibility stays lean. Seating reuses this result and its already-read plan head
instead of loading the same immutable source/revision again.

The Billing-owned reader reuses only validated, positive monetary settlement
proof in one shared Booking transaction, with a fresh Date value returned to
callers. It still validates the current scope before lookup, does not cache
absence/errors, and does not cache in write/unscoped reads or across requests.
The audited settlement writer creates monetary proof; promotion updates only
promotion metadata, which this port does not expose. This is an application
writer invariant, not a claim that every settlement column has an immutability
trigger. No new cross-owner table access is introduced.

Native regression tests cover exact snapshot equivalence, missing-plan behavior,
bounded command count, retirement while waiting, retained Hall/Template row
fences against a writer that bypasses advisory locking, and read-transaction
proof lifetime. Existing Seating tests continue to cover source invalidation,
authorization, stale writes and repair. No public schema, migration, payment
behavior, pool cap, timeout or frontend behavior is changed.
