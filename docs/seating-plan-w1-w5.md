# SPEC-07 backend hand-off

Provider: `seating-plan@1.0.0`. Confirmed scope: `WEDDING-CONTRACT-3@3.0.0`,
`docs/backend-scope-2026-10-10.md`. This extension preserves SPEC-01–05 history.

## Planning and fixed layouts

Capacity uses Booking's independently entered `planningHeadcount`. Zero named
Guests, partial lists and disabled check-in do not change this number and do not
block Group labels or compatible confirmation. No person/seat or companion count
is stored. No geometry, group display values or client capacity claims are accepted.

`GET /api/v1/bookings/{bookingId}/seating-layout-options` returns current published
versions for the Booking hall, ranked by compatibility, physical capacity and stable
version ID. Inclusive range: `minGuests <= planningHeadcount <= maxGuests`.
Incompatible options include warnings and can be saved as drafts. Confirmation needs
a positive count within hall maximum and physical table capacity. Supersession retains
historical geometry; retirement prevents confirmation and new selection.

## Private API

All seven operations require a current bearer session. Manager and owning FULL Couple
may select, label, confirm and read a confirmed Booking. Manager alone may approve
exceptions. Staff, RESTRICTED, unrelated Couple, public and Guest credentials receive
no plan access. Foreign identities are concealed as 404. Responses use no-store.
Unknown body/query keys are 422. Every POST requires printable ASCII
`Idempotency-Key` (1–128 characters); reuse the same key/payload for retries.

| Operation                                                        | Strict body / result                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| POST `/bookings/{bookingId}/seating-plans`                       | `layoutTemplateVersionId`, `expectedBookingRevision`; new DRAFT, 201                                      |
| POST `/bookings/{bookingId}/seating-plans/{planId}/revisions`    | `expectedRevision`, optional `labels`, optional `layoutTemplateVersionId` / `remap`; successor DRAFT, 201 |
| POST `/bookings/{bookingId}/seating-plans/{planId}/confirmation` | `expectedRevision`, `expectedBookingRevision`; successor CONFIRMED and registered printable snapshot, 201 |
| POST `/management/seating-plans/{planId}/exceptions`             | Same revision fields plus NFC reason 10–500 characters; Manager confirmation, 201                         |
| GET `/bookings/{bookingId}/seating-plans/{planId}`               | Retained selected snapshot plus revalidated status/current count/revision, 200                            |
| GET `/bookings/{bookingId}/seating-plans/current`                | Same revalidated snapshot without planId, or `data:null` before selection, 200                            |
| GET `/bookings/{bookingId}/seating-layout-options`               | No query fields; current planning/Booking revision and ranked options, 200                                |

Paths above are relative to `/api/v1`. Labels are
`{layoutTableId, guestGroupId}`; one Group can label several tables, each table at
most one Group. Groups must belong to the Booking and be active when edited or
confirmed. Server snapshots Group name/color and exact Venue table geometry.
Unlabelled tables are supported.

Example revision with an optional list still empty:

```json
{
  "expectedRevision": 1,
  "labels": [
    {
      "layoutTableId": "10000000-0000-4000-8000-000000000001",
      "guestGroupId": "10000000-0000-4000-8000-000000000002"
    }
  ]
}
```

Changing layouts preserves labels on stable IDs automatically. Explicit
`remap: [{fromTableId, toTableId}]` maps a labelled old table to a new one; null
explicitly drops a label. Unknown sources, targets and collisions conflict.
`droppedTableIds` exposes unpreserved labels. Group definitions remain unchanged.

Every edit creates a new DRAFT with no inherited confirmation/exception. The
previous eligibility is invalidated with `SEATING_PLAN_REPLACED`; already captured
printable history remains available. Confirm/reconfirm always creates a higher
revision. A Manager exception overrides range only, within active hall/physical
capacity. It records approval ID, actor, exact Booking revision/count, reason and
UTC timestamp. A later Booking revision/count invalidates that exception.

`expectedAttendees` and `bookingRevision` describe the stored immutable snapshot;
`currentPlanningHeadcount` and `currentBookingRevision` on GET describe current
owner facts. `snapshotDigest` hashes the stored snapshot, not transient validity.

## Errors and transactions

409: `SEATING_REVISION_STALE`, `SEATING_PLAN_EXISTS`,
`HEADCOUNT_OUTSIDE_LAYOUT_RANGE`, `LAYOUT_RETIRED`, `TABLE_NOT_IN_LAYOUT`,
`GUEST_GROUP_UNAVAILABLE`, `EXCEPTION_EXCEEDS_PHYSICAL_CAPACITY` and the existing
idempotency-conflict contract. Missing keys are 400; invalid keys/payloads are 422;
invalid/revoked sessions are 401; concealed ownership/role failures are 404.

Booking advisory serialization encloses owner access, exact planning/eligibility
reads, Seating head/history, audit/outbox, command receipt and Invitation registry
mutation. Venue eligibility retains shared hall/template lifecycle locks until
commit; Venue retirement takes the matching exclusive locks. Failed registration
or invalidation rolls back the entire command. Existing print capture independently
rechecks headcount/exception/retirement under these same locks.

GET and confirmation revalidate current facts. A non-overlapping five-minute
reconciliation sweep visits all plans in bounded 100-row pages. Failed bookings are
reported and retried next sweep. Internal `reconcile(bookingId, bookingRevision)`
uses a persisted high-water mark and authoritative owner data; stale/replayed events
cannot restore eligibility. Durable v1 outbox intents are
`seating.plan-confirmed` and `seating.plan-requires-review`; Notifications delivery
remains SPEC-09.

## Persistence and downstream providers

Forward migration `20261012020000_seating_plan` adds Seating head, immutable revisions,
command receipts and outbox, with retained Booking/layout/predecessor/Group/table
references and monotonic head checks. Existing Bookings/Guests/print files receive no
automatic plan or count change. Recovery uses a new compensating migration; do not
rewrite applied migrations or delete history.

`SeatingPlanReader.requireCurrentPlan` revalidates; `resolveRevision` returns exact
history. `SeatingGuidanceReader` returns Group names/colors/table labels and provisional
status only, without geometry or person mapping. With no plan it returns ABSENT/empty.
Guidance fails closed until the Staff owner supplies its assignment/window/session
facade. A Staff guidance read cannot perform a Seating or registry write. Actual
Staff mode/assignment integration remains SPEC-08; it is optional for Seating/print.

Registry confirmation includes exact validity proof, immutable render array and
canonical SHA-256 digest. Equal-revision invalidation is terminal; reconfirmation
uses a higher revision. Invitation print never calls a live Seating reader.

## RV-19 printable files

The existing private printable file endpoint now renders accepted Seating snapshots
as vectors with exact table shape, position, dimensions and rotation, table labels,
Group color and a textual Group legend. Vietnamese fonts and a generic QR are embedded.
Two A5 sides, 3 mm bleed, existing raster/size limits remain. A layout/legend too
small or too long to print legibly returns `PRINT_CONTENT_OVERFLOW` (422).
Malformed or missing Seating snapshots are 422; no geometry is invented or rearranged.

Files without Seating preserve renderer `invitation-a5-v1`; Seating uses
`invitation-a5-v2-seating`. `X-Renderer-Version` identifies the actual file renderer.
Current headcount, layout retirement and newer drafts cannot rewrite retained printed
history. Reading/rendering does not create a charge. Legacy approved print orders
retain their once-only charge; contracted fulfillment uses its existing commercial
entitlement. No new financial or companion/check-in behavior is introduced.

Acceptance and exact hashes: [evidence](../tasks/evidence/seating-plan-rv19-2026-10-12.md).
Deployment, live providers and full product release are separate gates; frontend
teams own their UI implementations.
