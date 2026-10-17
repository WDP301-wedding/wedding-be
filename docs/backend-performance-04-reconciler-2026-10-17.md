# PERF-04 Seating reconciliation isolation

The owner keeps PERF-04 open and requested investigation before a fresh region
comparison. The [aborted experiment](backend-performance-04-region-2026-10-17.md)
and its sealed receipt remain historical evidence. The original serving service
is unchanged.

## Findings and correction

`createInvitationStudioRuntime` unconditionally started the five-minute Seating
reconciler. Disabling `NOTIFICATIONS_WORKER_ENABLED` did not disable this separate
scheduler. Reconciliation shares the Studio pool with Seating authentication and
HTTP work; its exclusive transaction can retain the only connection for longer
than the unchanged 2,000 ms acquisition budget. It also performs repairs, so it
must be controlled explicitly in an isolated read-only experiment.

Historical deployment logs contain a runtime manifest at 14:49:14.342 UTC and a
reconciliation retry warning at 14:54:18.700 UTC. The failed HTTP request started
near the next scheduled sweep. This is timing evidence, not proof of the exact
connection holder. A connecting client can also contribute to `maxActive`.
No pool leak was reproduced; the original production error's exact holder
remains unresolved in PERF-13.

`SEATING_RECONCILER_ENABLED=false` now prevents interval registration and all
scheduled reconciliation work. It is parsed strictly, forwarded by the Studio
runtime and declared separately in the startup feature manifest. Its default is
`true`, preserving ordinary deployments. Both temporary region cohorts must use
the same fixed source/image with this flag false, Notifications false, diagnostics
true and deadline/probe false. The existing pool maxima, reserve, acquisition and
idle settings remain unchanged.

Foreground Seating reads, confirmation, print validation, authorization and
post-lock rechecks still execute. Disabling the scheduler is experiment isolation;
it does not establish production concurrency capacity or eliminate every possible
acquisition failure. Do not present a comparison with this changed worker mode
as a speed improvement over the earlier aborted cohort. Only compare the two
regions within the new matched campaign.

## Regression evidence

The native test uses a disposable loopback PostgreSQL database, real Prisma/pg,
pool maximum one, acquisition timeout 2,000 ms and the actual Seating router.
A deliberate latch retains a real reconciliation transaction after an owner read.
The competing authenticated HTTP read returns 500 with one acquire, zero SQL,
active one, idle zero and waiting one. Releasing the latch completes reconciliation;
the next HTTP read returns 200 and the pool has one idle connection and no waiter.
This controlled mechanism matches the diagnostic shape, without claiming to
reconstruct the historical production holder.

Before the fix, the disabled-scheduler native case failed because an interval was
still registered. After the fix, both native cases pass without skipped tests;
the disabled case performs an authenticated current-plan read successfully.
Separate unit tests advance fifteen minutes while disabled and observe no sweep,
retain enabled paging/shutdown behavior and verify strict configuration, runtime
wiring and manifest reporting. Disposable databases are removed by the existing
test fixture and wrapper cleanup. No production lock or business mutation was
used to reproduce the failure.

Follow-up acceptance still requires a fresh complete live comparison, exact-image
placement verification and cleanup. Pool capacity under enabled background work
remains a separate PERF-13 gate. The [node-postgres pool contract](https://node-postgres.com/apis/pool)
documents acquisition timeouts and release; the implementation uses the locked
local pg 8.23.0 and Prisma adapter 7.10.1 sources as well.
