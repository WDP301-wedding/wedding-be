# SPEC-05 review corrections — 2026-10-10

Starting branch: `origin/huy/spec-05-06` at `450564c`.
Integration baseline: accepted `origin/main` at `0e914b3`.
Fix branch: `codex/fix-spec05-review`. SPEC-06 remains outside this change.

## Corrected behavior

- Removed the branch-only duplicate Booking/Timeline/Deposit owner migration and
  schema. Invitation adapters read the canonical SPEC-03 records, including
  normalized timeline items and `BookingDepositSettlement`. Both runtimes and
  their OpenAPI paths remain mounted. Invitation and Booking writers use the
  same per-booking advisory key; media acceptance also holds the Booking row.
- Every replacement proposal advances the order revision. Approval requires the
  latest proposal identity, even if a caller supplies the latest order revision.
  Rejection leaves the accepted charge and credit history unchanged.
- Each print audit insertion freezes the reporting value in the same transaction
  as the command. Reporting reads that snapshot rather than live order pointers.
- A transaction-owned global reporting counter serializes publication of fences
  across bookings. Rollback rolls back the increment; later transitions cannot
  commit past an unfinished lower sequence.

The reporting migration backfills commercial identities from audit history and
approval timestamps from immutable outbox events, falling back to audit time for
legacy rows without an event. Legacy `updatedAt` uses audit time because the old
schema did not retain an immutable order-update timestamp. New rows retain the
actual order `updatedAt`. Existing audit immutability remains enforced.

## Verification

- All 1,255 distinct tests pass across the complete suite and focused reruns;
  no database tests were skipped. PostgreSQL 18 was a disposable local cluster.
- Three native regressions cover superseded replacement, historical fence
  stability, and cross-booking commit ordering using real production commands.
- Upgrade tests preserve existing core/media/Booking data, reconstruct old and
  replacement commercial identities, preserve outbox approval time, resume the
  reporting counter, and reject snapshot mutation.
- All 22 migrations deployed successfully on an empty database. Existing-data
  upgrade tests apply the same ordered migration files.
- Typecheck, lint, format check, build and OpenAPI artifact validation pass.

The integration merge also fixes serving explicitly allowlisted Swagger assets
from a managed `.codex` worktree, and makes OTP test creation timestamps use the
fixture clock so expiry constraints remain valid as calendar time advances.
Canonical owner constraints replace assertions against the removed fake tables.
