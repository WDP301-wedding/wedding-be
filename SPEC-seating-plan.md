# Specification: Seating Plan

- Status: **Approved specification — module plan and implementation acceptance pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `seating-plan` (`SPEC-07`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
- Initial owner role: C (member name to be assigned)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: SEA-003 through SEA-008
- Depends on: `venue-catalog`, `booking-lifecycle`, `guest-rsvp`
- Consumers: `invitation-studio`, `staff-operations`, `analytics-dashboard`

## 1. Purpose and hard boundary

This module selects a capacity-compatible fixed catalog layout and applies guest-group
labels/colors to its stable tables. It owns seating-plan revision/status and no geometry.
It never assigns a household, person, or seat; creates/moves/resizes tables; changes a
layout range; or changes guest-group definitions.

## 2. State and immutable reference contract

A plan stores `seatingPlanId`, exact `layoutTemplateVersionId`, stable
`layoutTableId` labels, expected-attendance snapshot, and monotonic revision number.
States are `DRAFT`, `CONFIRMED`, and `REQUIRES_REVIEW`.

```text
DRAFT -> CONFIRMED
| |
| +-> REQUIRES_REVIEW -> CONFIRMED
+--------+------------------------------> replacement DRAFT
```

A selected layout is eligible only when booking planning headcount is in its immutable
range. An out-of-range headcount or retired layout changes a confirmed plan to
`REQUIRES_REVIEW`; labels/groups remain visible. Reconfirmation needs a compatible
layout or an audited Manager exception. Layout change may remap labels but never deletes
guest-group definitions.

## 3. Produced contracts

```ts
interface SeatingPlanReader {
  requireCurrentPlan(bookingId: string): Promise<{
    seatingPlanId: string;
    revisionId: string;
    status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW';
    layoutTemplateVersionId: string;
    expectedAttendees: number;
    labels: readonly { layoutTableId: string; guestGroupId: string; colorSnapshot: string }[];
  }>;
  resolveRevision(revisionId: string): Promise<{
    bookingId: string;
    layoutTemplateVersionId: string;
    labels: readonly { layoutTableId: string; guestGroupId: string; colorSnapshot: string }[];
  }>;
}
```

Outputs are immutable snapshots. The reader never converts a current catalog geometry
lookup into a historical revision. Staff operations consumes only required group-label
guidance, not raw geometry.

## 4. Consumed contracts and printable registry

| Provider          | Contract                                     | Use                                                      |
| ----------------- | -------------------------------------------- | -------------------------------------------------------- |
| venue-catalog     | exact layout-version resolution              | Filter/rank and safely render restaurant-owned geometry. |
| booking-lifecycle | confirmed event context and headcount events | Gate access and check current planned count.             |
| guest-rsvp        | `GuestPlanningReader`                        | Resolve active group IDs/names/colors.                   |
| invitation-studio | `PrintableSeatingContentRegistry`            | Register/invalidate immutable render snapshot.           |

On confirm, resolve the exact layout, build the safe render snapshot, digest it, then
call `registerConfirmed` idempotently by seating revision. A higher revision wins;
changed digest is conflict. Invalidation wins for the same revision number; a
reconfirmation always creates a higher revision. On invalidation call `markRequiresReview`. This preserves
the acyclic dependency: invitation never makes a live seating call during print approval.

The module emits `seating.plan-confirmed` and `seating.plan-requires-review` v1.

## 5. Authorization, HTTP, and acceptance

Full Couple accounts select/label their booking's plan; Managers can perform a documented
exception with a reason; Staff see only assigned operational group guidance. Restricted,
public, and guest-link actors cannot access a plan. Specified routes are
`/bookings/{bookingId}/seating-plans` and explicit select/label/confirm/exception
actions. Writes use expected revision and `Idempotency-Key`. No generated API operation
permits table geometry or individual placement mutation.

Tests prove SEA-003–008: range selection, no geometry mutation, no person/seat
assignment, stale headcount event rejection, exception audit, printable registration
ordering, and preservation of an approved printable revision after later seating edits.

## 6. Confirmation and revision rules

A label is `{layoutTableId, guestGroupId}`; clients never submit authoritative group
name/color or geometry. The server resolves active group display values, snapshots them
in a new immutable plan revision, and checks the table belongs to the exact selected
layout/hall. Each table has zero or one group label; one group may label multiple tables.
Unlabelled tables are allowed; no aggregate per-group seat claim is inferred.

New selection requires an active current published layout for the booking hall.
Already selected historical versions retain immutable geometry. Confirming/reconfirming
an existing version additionally requires `VenueSelectionEligibilityReader` to prove
the template/hall has not retired; supersession alone is not retirement. This is a
accepted additive venue-owned port, separately scheduled without altering VC tasks.
A confirmed read/print boundary revalidates retirement; a five-minute reconciliation
sweep handles dormant plans. Guest headcount updates use bookingRevision high-water
marks, not timestamps, and the confirmation command rechecks current headcount.

Default range comparison is inclusive `minGuests <= planningHeadcount <= maxGuests`.
Manager exception requires reason 10–500, exact layout/plan/headcount revisions, and
an immutable exception record. It may override the template minimum/maximum only within
active hall maximum and physical total seat capacity; it cannot override a retired hall/
layout or mutate geometry. A later headcount change invalidates the old exception and
requires an explicit new one. A plan may be saved as draft with total zero; confirmation
requires positive planning count.

Every select/label edit produces a new immutable DRAFT revision while preserving the
prior confirmed historical revision. Reconfirming creates a greater revision number;
it never re-registers an invalidated revision as eligible. Layout change automatically
preserves labels only for stable table IDs also present in the new version; all other
remaps are explicit mappings and may drop labels without deleting guest groups.

## 7. Registry atomicity and guidance provider

Confirmation/invalidation and invitation registry eligibility changes share the
booking-bound application unit-of-work. Lock order follows the team guide. A failed
registry update rolls back that state transition and confirmation cannot claim success.
Registry invalidation is terminal at equal revision number. Delayed older registration
is a no-op acknowledgement; same ID/different digest is conflict. Existing printable
revisions remain unchanged after invalidation.

Retirement/headcount checks occur before every confirmation and print approval boundary
through the owner port; background delivery is not the sole check. A print approval and
headcount/retirement revalidation are serialized so either valid snapshot approval wins
first or the invalidation blocks a later approval. Venue lifecycle eligibility reads
hold the owner shared lock until commit; retirement uses its exclusive lock, as defined
in baseline Section 21.10. Booking serialization alone is not a venue-retirement lock.

Additive `SeatingGuidanceReader` returns group-labelled table labels and plan status for
a booking only, with no person/household/seat mapping:

```typescript
interface SeatingGuidanceReader {
  getGuidance(
    bookingId: string,
    context: ContractContext,
  ): Promise<
    Readonly<{
      seatingPlanRevisionId: string | null;
      status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW' | 'ABSENT';
      groups: readonly Readonly<{
        guestGroupId: string;
        groupName: string;
        color: string;
        tableLabels: readonly string[];
      }>[];
    }>
  >;
}
```

No plan is a successful `ABSENT` response with an empty group list, so Staff can still
check in arrivals. Unconfirmed/requires-review guidance is clearly labelled provisional;
Staff must not present it as a reserved table.

## 8. HTTP schemas, errors, and independent slices

| Method/path                                             | Strict input                                                                          | Result                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET /bookings/{id}/seating-layout-options               | Optional cursor                                                                       | Current compatible/ranked catalog versions and warnings from current planning count. |
| POST /bookings/{id}/seating-plans                       | layoutTemplateVersionId, expectedBookingRevision                                      | DRAFT revision with immutable safe geometry preview.                                 |
| POST /bookings/{id}/seating-plans/{planId}/revisions    | expectedRevision, labels[{layoutTableId, guestGroupId}], optional layoutVersion/remap | New DRAFT; no geometry fields allowed.                                               |
| POST /bookings/{id}/seating-plans/{planId}/confirmation | expectedRevision, expectedBookingRevision                                             | New CONFIRMED revision + registered digest, or conflict.                             |
| POST /management/seating-plans/{planId}/exceptions      | expectedRevision, expectedBookingRevision, reason                                     | Manager-only exact headcount exception and confirmed new revision.                   |
| GET /bookings/{id}/seating-plans/{planId}               | no body                                                                               | Immutable selected revision plus current validity and warnings.                      |

Errors are `SEATING_REVISION_STALE`, `HEADCOUNT_OUTSIDE_LAYOUT_RANGE`,
`LAYOUT_RETIRED`, `TABLE_NOT_IN_LAYOUT`, `GUEST_GROUP_UNAVAILABLE`,
`EXCEPTION_EXCEEDS_PHYSICAL_CAPACITY` (409); strict geometry/person assignment fields
are 422; unowned booking is concealed 404.

| Slice                               | Can run alongside                      | Real dependency                                                         |
| ----------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| Range/group/remap/domain rules      | Guest and Notifications implementation | Frozen provider fixtures.                                               |
| Plan persistence/guidance           | Staff domain/UI fixtures               | Serialized migration lane.                                              |
| Confirm/registry/shared transaction | Invitation registry implementation     | Real venue eligibility, guest/booking, registry/UoW before integration. |
| Web/App group-label UI              | Own HTTP work using local fixture      | Committed generated API for adapters; responsive read-only geometry.    |

Proposed waves: compatibility/remapping; plan persistence/revisions;
confirmation/exception/registry/guidance; HTTP/OpenAPI; client slices; acceptance.
SEA-003/006 tests include boundary equality, zero count, retirement versus supersession,
exception revalidation, concurrent headcount/confirm and invalidation/print approval.
SEA-004/005/007/008 tests cover stable group IDs, no person/geometry writes, remap
visibility and accessible keyboard alternatives to label drag.

Registration includes `validityProof` with exact min/max, physical seat capacity,
booking revision/headcount and optional approved Manager exception. Print rechecks
this proof against current booking/venue facts even before invalidation messages arrive.
See baseline Section 21.10.
