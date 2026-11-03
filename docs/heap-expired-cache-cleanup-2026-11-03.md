# Expired signed URL cache cleanup

Prepared against live source `b73a9c1` on 3 November 2026. This change is local;
it has not been deployed and does not establish recovery of the live 502 incident.

## Scope

Catalog signed URLs were bounded to 2,000 entries, but entries that were no longer
reusable could remain in memory indefinitely without another write to the cache.
The runtime now prunes them every 30 seconds. Pruning uses the existing 30-second
expiry safety window and preserves reusable entries.

The cache is cleared and its timer stopped on runtime shutdown. A signing request
already in progress can finish, but cannot repopulate a disposed cache. The timer
is unreferenced so it cannot keep a process alive.

Only cached URL references are removed. No database rows, stored objects, active
requests, credentials or idempotency records are deleted. Existing issued URL
grants and authorization checks are unchanged. There is no new HTTP endpoint,
schema migration, dependency, provider call or change to money rules.

## Measurement

Separate Node 24.15.0 processes exercised 2,000 synthetic signed URLs through the
compiled catalog media service. Database and Storage boundaries were controlled
in-process fixtures; no live provider or database was used. Explicit GC at each
measurement point compared retained heap, rather than proposing forced GC for
normal runtime operation.

| State                                     | Original heap (MiB) | Updated heap (MiB) |
| ----------------------------------------- | ------------------: | -----------------: |
| Empty cache                               |              17.407 |             17.407 |
| 2,000 cached URLs                         |              18.111 |             18.112 |
| Expired entries after cleanup opportunity |              18.116 |             17.456 |
| Entries pruned                            |                   0 |              2,000 |

The updated service released 687,712 bytes between the populated and pruned
measurements, about 0.66 MiB. Operator artifacts are named
`cache-reclaim-original.json`, `cache-reclaim-patched.json` and
`cleanup-focused-tests.json`, retained outside Git.

This measured saving is small compared with the live process failing near
253 MiB. It does not establish that the catalog cache caused those crashes or
that this change resolves them. Duplicated Prisma initialization and the remaining
live allocation trigger are separate work.

## Verification and release limits

- Regression tests first reproduced missing pruning, shutdown cleanup and
  disposal protection; all 23 focused catalog media/runtime tests now pass.
- Production build, TypeScript checking, full ESLint and OpenAPI
  generation/check pass. OpenAPI artifacts are unchanged.
- Focused coverage of the two implementation files passes the existing per-file
  80% line/branch thresholds: aggregate 96.33% lines and 84.90% branches. This
  scoped measurement is not full-project coverage acceptance.
- Contract suite: 95 passed, 5 failed. The failures concern existing Venue,
  Invitation, Seating, Staff and CI contract expectations, outside the four
  modified source/test files. The full contract suite on unchanged `b73a9c1`
  also returned 95 passed and the same 5 failed test names.
- The broad suite encountered failures in configuration, contract, lifecycle,
  booking and other existing tests. It was stopped after failures were observed.
  An independent unchanged `b73a9c1` run of configuration, Venue contract and
  Booking experience tests reproduced 10 failures (137 tests passed).
- PostgreSQL integration, full-project coverage and deployment are not established by the
  focused tests or the fixture heap measurement. Existing full-suite failures
  remain visible; no tests, assertions or coverage thresholds were weakened.

Do not publish this as a complete OOM fix. A release still requires passing
repository gates and direct verification of the deployed behavior.

Self-review checked cache expiry boundaries, in-flight signing, timer cleanup,
shutdown ordering, authorization and the absence of database/storage writes.
No actionable issue remains in this scoped diff. Release acceptance remains
pending for the reasons above.
