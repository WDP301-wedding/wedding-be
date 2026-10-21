# PostgreSQL query access paths — 2026-10-21

Scope: backend PostgreSQL review and additive notification inbox indexes, using
`supabase-postgres-best-practices`. The starting checkout is
`563c7bb38ba2433d3571043c26e76528479e4ddf` with pre-existing uncommitted performance
work. Existing source changes, migration history, business rules and provider
acceptance records are preserved.

## Read-only Supabase inspection

The connected `wedding` project matches the local Supabase project reference.
The hosted database reports PostgreSQL 17.6; the disposable local test server is
PostgreSQL 18.6. Catalog inspection confirms that the two new access paths are
absent on the hosted database. No hosted DDL, business-data writes, retention
deletes or external-provider operations were performed.

The performance advisor reports 52 unindexed foreign keys and 43 unused indexes
in `public`. Other notices belong to retained rehearsal schemas: the project-wide
totals are 169 and 302 respectively. These are investigation candidates, not
instructions to create or remove indexes. Some compound foreign keys already have
usable leading-column indexes; rarely executed retention and immutable-history
paths also need workload and deletion-policy review. See the advisor's
[foreign-key guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
and [unused-index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

Approximate live-row statistics at inspection: Guest 30, NotificationInbox 6,
NotificationIntent 232, NotificationRecipient 13. A sequential scan on these small
tables is reasonable. No current hosted HTTP-latency improvement is established
by the larger synthetic test below. Existing aggregate pool budgeting, acquisition
timeouts, SQL pagination, authorization rechecks and write serialization remain
in place.

## Changes and cost

`20261021040000_notification_inbox_query_indexes` adds two B-tree indexes:

- `NotificationInbox_unread_account_booking_idx`: `(accountId, bookingId)` where
  `readAt IS NULL`. The count filters by account, unread state and Booking-owned
  visibility. Read rows need no entries in this index. Marking a notification read
  removes its index entry; unread inserts incur another index write.
- `NotificationInbox_createdAt_id_idx`: `(createdAt, id)` for the retention query's
  global age filter, stable ordering and `LIMIT 100`. The existing account-first
  inbox index cannot supply this global order. This full index costs one entry
  per inbox row and adds maintenance on insert/delete.

No index, table, constraint, history or authorization predicate is removed. No
application behavior or API contract changes. Prisma's checked-in schema declares
both indexes; SQL was generated with `prisma migrate diff` between the original
and updated schema, then wrapped in an atomic transaction with a 5-second lock
timeout and a 60-second statement timeout.

This follows Supabase's [query optimization guidance](https://supabase.com/docs/guides/database/query-optimization):
match the index to the query, inspect actual plans, and account for write costs.

## Verification

The new integration test creates a separate disposable database using the existing
`CatalogTestDatabase` helper and applies the immutable migration chain. It inserts
30,000 synthetic intents/inbox entries, with 300 unread entries and mixed global /
booking-scoped visibility, then runs `ANALYZE`.

The unread plan is captured from the actual inbox reader statement, including its
Booking audience CTE. The retention query preserves the existing cutoff, ordering
and 100-row batch. Normal tests assert index access paths, unchanged results,
account isolation, mark-read behavior and the oldest batch. They do not enforce
machine-dependent wall-clock thresholds.

Measured on the same local server, fixture shape and queries, with seven samples
after one warm-up per query:

| Query                                    | Before median | After median | Before / after shared-hit blocks |
| ---------------------------------------- | ------------: | -----------: | -------------------------------: |
| Actual unread reader, including audience |      8.194 ms |     0.612 ms |                        404 / 305 |
| Oldest 100-row retention batch           |     29.446 ms |     0.104 ms |                          400 / 4 |

The baseline unread query scans 30,000 inbox rows; the partial index restricts it
to the 300 unread rows. Retention changes from a sequential scan plus top-N sort
to an ordered index scan. Background host load varied, so deterministic access
paths and buffer work are the regression evidence; timings are local samples,
not hosted HTTP budgets. The original no-index run also reproduced both missing
access paths. One later repeat hit setup/cleanup hook timeouts under concurrent
checks; its samples are excluded rather than treated as successful evidence.

The [evidence record](../tasks/evidence/postgres-best-practices-2026-10-21.json)
separates hosted inspection, synthetic measurements and correctness checks.

To reproduce on an authorized disposable PostgreSQL administrator connection:

```powershell
# TEST_MIGRATION_DATABASE_URL must be a disposable local test target.
$env:POSTGRES_INDEX_EVIDENCE = 'true'
$env:POSTGRES_INDEX_EVIDENCE_PATH = 'inbox-explain.jsonl'
npx vitest run tests/integration/notification-inbox-indexes.test.ts --maxWorkers=1 --silent=false
```

Evidence mode emits seven EXPLAIN ANALYZE samples after one warm-up. Setting the
mode to `baseline` drops only these two indexes in the helper's newly created
database and deliberately fails both index assertions, reproducing the old plans.
It never alters the shared runtime database. The helper drops its test database
after each run.

Repository checks: typecheck, build, OpenAPI generation/check, 1,465 unit tests
and 71 contract tests pass. Authored-source lint passes with generated/audit
directories excluded from the invocation; the initial unrestricted lint exhausted
the Node heap while scanning existing artifacts. The latest test file also passes
focused lint. No lint configuration, assertion, test or coverage threshold was
weakened in the repository.

The full 296-file suite was attempted and stopped after a runtime test timeout;
it is not a passing gate. A six-file integration follow-up completed 34/35 tests
with two failing file results from 10-second database/schema cleanup hooks. The
new index tests, notification read/guest delivery checks and fresh/forward-correction
migration rehearsal pass. The two files with cleanup failures pass all 10 tests
when rechecked with one worker and a local-only `--hookTimeout=60000` invocation;
this does not change
the checked-in tests or establish passing default full-suite CI. See the evidence
record for the results. Whole-repository CI remains required before release.

The dedicated test PostgreSQL server is stopped. Its data directory remains at
`output/postgres-best-practices-20261021/pgdata`: automatic approval rejected the
recursive removal with `blocked by policy`. Raw logs and query plans remain in
the same task output directory.

OpenAPI remains unchanged, SHA-256:
`19da7dafc991d316f7f048a58c6446deabb2e724edb3a49d55e4709ce14d04e2`.

## Release and recovery

This is a local candidate, not a deployed optimization or provider-readiness
decision. Review and exact-head CI precede an owner-authorized release. Use the
existing Prisma migration workflow and migration credentials; do not apply the
same DDL separately through Supabase migration tooling.

The normal index builds temporarily block inbox writes. At rollout, verify table
size and long-running transactions and select a suitable maintenance window. The
bounded migration fails atomically if it cannot obtain locks/build in time. If
the table has grown enough to require concurrent builds, prepare and rehearse that
release approach before deploying this candidate.

After deployment, verify migration status and index validity, run `ANALYZE` as
appropriate, inspect real workload plans and compare inbox/retention latency.
An application rollback remains compatible with the additive indexes. If removal
is warranted, use a new forward migration; never rewrite an applied migration.
Existing RV/provider and production NO_GO decisions remain unchanged.
