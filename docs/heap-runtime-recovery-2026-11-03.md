# Heap recovery on the existing 512 MiB service

The initial expired-URL cleanup did not prevent another V8 heap-limit failure.
Render recorded six fatal JavaScript heap OOM messages after c7defba went live,
beginning at 2026-11-03 13:40:13 UTC, about six minutes after deployment. API and
readiness checks returned 502. This is distinct from exhausting the container RAM.

## Application ownership

The composition root now creates one shared default Prisma client for Identity,
Booking, Payments, Invitation/Seating/Staff, Guests and Notifications. Catalog and
Analytics retain separate clients and pool profiles. Standalone module runtimes
still own and disconnect their clients; injected clients are borrowed. The root
disconnects once, after all module/worker/realtime resources have finished closing,
including cleanup failures. Failed startup also releases the shared database.

The shared pool maximum is six times DB_POOL_MAX, preserving the six previous
default pools' combined connection budget instead of shrinking them to one slot.
Catalog, Analytics, readiness, deployment overlap and reserve accounting stay the
same. This does not change transaction boundaries or payment/idempotency rules.
No migrations, schema changes, customer-data deletions or provider calls are needed.

## Measurements and observability

A disposable PostgreSQL with synthetic Couple and native booking fixtures ran
200 bursts of 12 concurrent HTTP reads (2,400 requests) covering the Couple
overview, notifications, catalog, proposals, contracts, payments, guests, guest
plans, check-in settings, invitations and appendices. All returned 200. With a
256 MiB old-generation limit, retained heap after measurement GC fell from
134,986,096 bytes to 94,898,536 bytes (about 29.7%); process RSS at the endpoint fell
from 288,432,128 to 225,914,880 bytes. This is a local comparison against the former
live source; main also includes its pre-existing booking navigation changes.
Local Node/OS/PostgreSQL differ from Render; neither run reproduced live OOM.

Runtime logs now record heap used/total/limit, RSS, external/array-buffer memory,
uptime and Engine.IO client count at startup and every 15 seconds. They contain
numeric counters only. The timer is unreferenced and stopped during cleanup.
This provides live evidence for distinguishing connection load from process-wide
memory growth. No manual GC, full heap snapshots or heap-limit increase is added.

## Verification limits

The first complete offline unit run exposed pre-existing stale tests in unrelated
business and provider fixtures. They are not evidence of regression nor a green
full suite. Lifecycle tests touched by this change now explicitly mock the shared
database and verify startup/shutdown ownership. Invitation runtime tests assert
the currently implemented disk provider and use an actually invalid signing key.
Keep exact-head CI results, focused tests, offline integration, and live runtime
observations separate in the release record. Sustained live recovery must be
verified after deployment; local savings alone do not prove the incident solved.
