# Initial booking proposals with multiple menus

Owner request: 2026-10-18. Additive backend extension to SPEC-03; historical
acceptance, commercial contracts and frontend repositories remain unchanged.

## Contract and authorization

Manager creates an initial proposal using `POST /api/v1/bookings`. Couple and
Staff cannot create bookings. The consultation must belong to the Manager;
existing expected-revision and idempotency rules still apply. Owning Couple with
RESTRICTED or FULL consultation access and the responsible Manager can read
`GET /api/v1/bookings/{bookingId}/proposal`.

New clients send `menus` instead of the legacy top-level menu/table fields:

```json
{
  "consultationId": "10000000-0000-4000-8000-000000000001",
  "hallId": "10000000-0000-4000-8000-000000000002",
  "eventDate": "2027-01-20",
  "shiftCode": "DINNER",
  "menus": [
    { "menuPackageVersionId": "10000000-0000-4000-8000-000000000003", "tableCount": 20 },
    { "menuPackageVersionId": "10000000-0000-4000-8000-000000000004", "tableCount": 40 }
  ],
  "planningHeadcount": 550,
  "expectedRevision": 1
}
```

IDs are illustrative: use actual published catalog version/consultation/hall IDs.
The event date must satisfy the existing Vietnam-local booking-date policy.
Select 1–50 distinct menu packages, with integer quantities 1–500 per line and
at most 500 tables in total. Duplicate versions (case-insensitive UUIDs), two
versions of one package, mixed legacy/new input, unknown fields, client prices,
fractional/zero quantities and unsafe integer totals are rejected with 422.
Existing catalog exact-version resolution rules are preserved; commercial draft
submission still independently checks current active selection eligibility.

Legacy `{menuPackageVersionId, tableCount}` input remains accepted as one line.
Reads now include `proposal.menus`, each containing `versionId`, `packageId`,
`versionNumber`, `name`, `description`, `priceVndPerTable`, `tableCount` and
`lineTotalVnd`. The existing `proposal.menu` is a compatibility preview of the
first selected menu only; it must not be multiplied by aggregate `tableCount`
to calculate a multi-menu price. New clients render the full `menus` array.

```text
tableCount = sum(menus[].tableCount)
baseChargeVnd = sum(menus[].priceVndPerTable * menus[].tableCount)
depositAmountVnd = ceil(baseChargeVnd * 30 / 100)
```

All values use checked integer VND arithmetic, including the aggregate sum.
`planningHeadcount` remains explicitly supplied and independent of table count
and guest lists. These are initial proposal estimates. The approved full
commercial contract (including print/services) remains authoritative for deposit;
proposal creation grants no approvals and does not convert legacy bookings.
Post-deposit changes continue to require an approved appendix.

Errors retain existing semantics: 401 missing session, 403 non-Manager creation,
404 missing/foreign consultation or unauthorized proposal read, 409 stale revision
or an in-progress duplicate, and 422 strict validation/domain bounds failures or
`IDEMPOTENCY_KEY_REUSED` for a changed payload under the same key.
Domain 422 codes include `BOOKING_MENU_SELECTION_INVALID`,
`BOOKING_TABLE_COUNT_INVALID` and `BOOKING_COMMERCIAL_VALUE_INVALID`.
Use one `Idempotency-Key` per intent and reuse it with the identical body on retries.

## Persistence and rollout

Forward migration `20261018090000_booking_proposal_menus` adds nullable JSONB
`BookingProposalSnapshot.menus`. It stores immutable exact-version menu facts,
quantities and line totals alongside existing aggregate totals. JSON snapshots
follow the existing commercial-document approach. The existing immutable
proposal trigger protects this column; audit metadata records all selected
version IDs. The existing first-menu scalar fields remain for compatibility.
The forward migration replaces the single-menu multiplication constraint with
per-line and aggregate checks for new snapshots; NULL historical snapshots retain
their original single-menu multiplication rule. A SQL validator checks integer
quantities/prices, distinct menu IDs, safe totals and agreement with aggregate facts.

Historical rows stay NULL and unchanged. Reads synthesize one line from their
retained scalar facts and retained base total, without current-catalog queries
or repricing. Apply this migration before deploying the new Prisma client/runtime.
No credentials or external provider calls are required for this extension;
offline/native verification does not establish deployed provider readiness.

Local verification and remaining broad acceptance gates are recorded in
[the extension evidence](../tasks/evidence/booking-multi-menu-proposals-2026-10-18.md).
Feature tests, migration/upgrade and changed-file coverage passed; complete
repository coverage still needs a successful stable run before acceptance closure.
