# PERF-12 schema retention review — 2026-10-16

The read-only review retains all **145 public tables** (144 Prisma models and
`_prisma_migrations`). It approves **zero deletions**. Table count and low row
estimates do not explain HTTP latency, and reclaiming rehearsal storage has no
demonstrated API speed benefit.

[Every-table owner/retention matrix](backend-schema-retention-matrix-2026-10-16.md)
and [machine-readable dependencies](../tasks/evidence/perf12-schema-retention-inventory-2026-10-16.json)
record the selected Railway database snapshot, database role ownership, application
module ownership, Prisma/raw-reference file paths, migration references, worker/
retention references, FK counts and JSON columns. The source snapshot predates
these documentation commits; applied migrations are unchanged.

## What was checked

`scripts/schema-retention-audit.mjs` uses an explicit operator-selected database,
`REPEATABLE READ READ ONLY`, bounded connection acquisition and PostgreSQL statement
timeouts. It reads catalog metadata and optionally computes selected synthetic
fixture digests in memory. Row bodies, credentials, SQL bodies and tokens are not
written. The original snapshot stays in `output/perf11-13-20261016/`; its SHA-256
is in the committed inventory.

The review checked all 145 public relations against Prisma and tracked runtime,
worker, script and immutable migration sources. The database snapshot includes
525 FKs across public/rehearsal scope and 46 public JSON/JSONB columns. Catalog
relationships cover dependencies that a textual source search misses. JSON
payload IDs, immutable contract/invitation/reporting snapshots and runtime-built
SQL can retain references without FKs; absence of a direct file reference is
therefore never interpreted as permission to remove a table.

Database activity is a point-in-time observation. It cannot prove that a stopped
worker, another deployment, scheduled job, provider callback, external reporting
consumer or operator script has retired a schema. No external-consumer or
schema-specific backup/restore attestation exists in this change.

## Rehearsal disposition

| Schema                                             | Tables | Responsible custodian                                             | Decision and missing proof                                                |
| -------------------------------------------------- | -----: | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ntf12_rehearsal_7469190783fb4b039f409b2f50843556` |    138 | Notifications backend owner + evidence custodian                  | Retain; no named cleanup owner, consumer retirement or restore proof      |
| `ntf12_rehearsal_a96eee86c8e041bc94ceec99c8018d75` |     87 | Notifications backend owner + evidence custodian                  | Retain; no named cleanup owner, consumer retirement or restore proof      |
| `ntf_rv16_edd0b9f9cfb4493195b69841b00a900f`        |    138 | Notifications backend owner + provider/release evidence custodian | Retain; referenced live provider/UNKNOWN evidence must remain recoverable |

No cross-schema FK or view dependency into these rehearsal schemas was observed.
Function-body/search-path references are inventoried separately, including local
trigger guards; no consumer-absence claim follows from this metadata.
The RV-16 schema is explicitly referenced by
[the provider manifest](../tasks/evidence/notifications-provider-manifest-2026-10-12.json)
and [the runtime evidence](../tasks/evidence/notifications-rv16-gmw5-2026-10-12.md).
That evidence retained an accepted delivery, expired-lease UNKNOWN, retry identities
and settlement invariants. These are retention obligations, not disposable empty
tables. The two earlier schemas have no exact name in the tracked-source scan;
their origin/retirement still needs custodian confirmation.

Provider-owned `auth`, `storage`, `realtime`, `vault`, their functions and related
schemas remain outside application cleanup. Applied migrations, audit, idempotency,
ledger, outbox, receipts, provider evidence and immutable history are protected
regardless of row count or scan statistics. Existing module-owned retention jobs
remain authoritative; this review introduces no new TTL.

## Conditional procedure for a separately approved cleanup

This is a review procedure, not an executable deletion plan. No DDL is supplied.

1. Name the application owner and evidence custodian for each exact schema/object.
   Record a separate owner decision identifying the environment and permissible
   objects. A wildcard schema prefix or database role name is insufficient.
2. Enumerate all current deployments, worker processes, schedules, provider
   callbacks, external consumers and operator tooling. Retire their references and
   recheck FKs, views, triggers, functions/search paths, grants and JSON/snapshot
   references with the owners. A quiet activity snapshot is insufficient.
3. Export the exact schema with data and required objects using provider-compatible
   `pg_dump`; record checksum, encrypted artifact location, access control and
   retention custodian. Rehearse restoration into a new isolated database, including
   row counts, migration checksums, immutable/provider evidence and dependent reads.
   Keep the original until the restore/recoverability evidence is reviewed.
4. Submit a reviewed, forward-only migration for application objects, or an
   environment-specific procedure for an authorized rehearsal schema. Enumerate
   objects and use dependency-restricting operations. Never rewrite applied
   migrations or use `DROP ... CASCADE`. A failed dependency check stops cleanup.
5. Recheck the target and backup immediately before any separately authorized
   execution. Capture before/after invariants, readiness and rollback/restore
   evidence. Retain the provider/evidence manifest and update its recoverable
   location; do not erase the history that established acceptance.

PERF-12's review is complete with no eligible deletion. Actual cleanup remains a
separate decision; no schema, table, migration or business row was removed.
