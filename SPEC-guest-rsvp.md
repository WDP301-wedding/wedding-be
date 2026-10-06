# Specification: Guest RSVP

- Status: **Approved specification — module plan and implementation acceptance pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `guest-rsvp` (`SPEC-06`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
- Initial owner role: B (member name to be assigned)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: GST-001 through GST-008; QRC-005
- Depends on: `booking-lifecycle`, `invitation-studio`
- Consumers: `seating-plan`, `staff-operations`, `notifications-automation`, `analytics-dashboard`

## 1. Purpose and boundaries

This module owns invitation households/parties, default and custom guest groups,
personalized invitation links, RSVP revisions, and expected-attendance totals. One
record represents one household or party, not an individual attendee; companion names
are deliberately not required. Personalized credentials are separate from the generic
public invitation and grant only their documented RSVP scope.

It does not assign a household/person to a table or seat, decide booking state, own
public generic content, send notification delivery, or record actual arrivals.

## 2. Authoritative data, lifecycle, and privacy

A group has a stable `guestGroupId`, normalized unique name within a booking, color,
and `ACTIVE | ARCHIVED` status. Each new booking gets `Parents`, `Groom Side`,
`Bride Side`, and `Friends` with localized labels. Group IDs—not names or colors—are
referenced by household, seating, staff guidance, and analytics. A referenced group is
archived/renamed without changing historical identity.

A household stores representative name, optional disambiguating phone, group ID,
positive expected count, optional operational note, and immutable RSVP revision history.
A household/personally linked guest sees only link-authorized data; public generic
invitation outputs never include households, phone, notes, groups, or links.

## 3. Produced backend contract

```ts
interface GuestPlanningReader {
  listGuestGroups(bookingId: string): Promise<
    readonly {
      guestGroupId: string;
      name: string;
      color: string;
      status: 'ACTIVE' | 'ARCHIVED';
    }[]
  >;
  requireHouseholdForOperations(invitationHouseholdId: string): Promise<{
    bookingId: string;
    invitationHouseholdId: string;
    guestGroupId: string;
    representativeName: string;
    disambiguatingPhone: string | null;
    expectedAttendees: number;
    operationalNote: string | null;
  }>;
  getExpectedAttendance(bookingId: string): Promise<{
    sourceRsvpRevisionId: string;
    expectedAttendees: number;
  }>;
}
```

Operational reads require caller assignment/authorization and return the minimum listed
fields. Every changed RSVP creates an immutable `rsvpRevisionId`; the latest aggregate
total is reported through accepted `BookingPlanningHeadcountSynchronizer`, never by
writing booking records. The original updater is retained only for serialized legacy use.

## 4. Dependencies and event contract

| Provider          | Contract                                                                | Use                                                                               |
| ----------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| booking-lifecycle | confirmed booking/access reader, `BookingPlanningHeadcountSynchronizer` | Enforce full/deposit gate and report the ordered aggregate expected total.        |
| invitation-studio | `InvitationPublicationReader`                                           | Link a personalized delivery to a published generic invitation without owning it. |
| identity-access   | actor resolution                                                        | Authorize Couple/Manager actions only; personalized guest links are separate.     |

This module emits `guest.rsvp-updated` and `guest.expected-attendance-changed` v1
with baseline payloads. The household revision and event outbox are atomic. Consumers
deduplicate by event ID and compare sourceSequence, not UUID order, so an older event
cannot restore a previous total. Legacy events trigger an authoritative aggregate read.

## 5. Authorization, HTTP, and failure contract

Managers and full Couple accounts manage only their confirmed booking's groups and
households. A personalized link can read/respond only for its household and cannot
discover another household. Restricted prospects, Staff (except provider-mediated
operations read), generic QR holders, and public users cannot manage guest data.

Specified resources are `/bookings/{bookingId}/guest-groups`,
`/bookings/{bookingId}/households`, personalized invitation/RSVP routes, and Manager
import/export actions. Imports validate every row before commit and report row-safe
errors without exposing unrelated data. Mutations use expected revision and
`Idempotency-Key`; errors include `GUEST_GROUP_NAME_CONFLICT`,
`GUEST_GROUP_IN_USE`, `RSVP_REVISION_STALE`, and concealed
`HOUSEHOLD_NOT_FOUND`.

## 6. Acceptance

Test default-group creation, normalized uniqueness, archival, positive counts, import
atomicity, link isolation, PII redaction, duplicated/out-of-order RSVP events, expected
total update, and the headcount-to-seating invalidation flow with the real booking
provider. Prove QRC-005: generic QR and personalized invitation tokens are technically
distinct and non-interchangeable.

## 7. Attendance formula, revision ordering, and lifecycle decisions

A household keeps a positive `expectedAttendees` count (1–100) used by staff as the
invited party expectation. RSVP status is `PENDING | ACCEPTED | DECLINED`; accepted
response records a positive `respondingAttendees` count (1–100). Companion names are
not collected. Planned contribution is expected count for PENDING, responding count for
ACCEPTED, zero for DECLINED or archived household. Booking planningHeadcount is the sum
of these contributions, not the sum of invitations regardless of RSVP.

Every contribution-changing create/import/update/archive/RSVP creates one immutable
booking-wide attendance-plan revision and increases `sourceSequence`; atomic import
creates one aggregate revision for the batch. Group rename/color-only edit need not
increase headcount sequence but increments its own/reporting sequence. An empty guest
list has total zero and an initialized immutable aggregate revision; reports never
invent a household for it.

Default groups are created idempotently when guest workspace is first initialized after
confirmation, not by mutating guest tables from Booking. Group name 1–80, normalized
NFKC/trim/case-fold for uniqueness; color is uppercase `#RRGGBB`. Archived group IDs
remain resolvable; they cannot be selected for new households/labels. Household name
1–120, phone optional normalized E.164, note 0–500. Group deletion is archival only;
renaming does not rewrite historical snapshots.

Additive owner ports are `GuestAttendancePlanReader`,
`GuestOperationsSearchReader`, `GuestAutomationReader`, and
`GuestReportingReader`. Publish exact DTOs plus fake/real conformance tests before
Staff/Seating/Analytics consumes them. Staff facade authorizes assignment first;
guest search enforces matching booking scope, active household visibility, 1–50 page
size, and only returned phoneLast4. Internal exact operations reader remains minimum data.

## 8. Personalized-link and RSVP security contract

Link tokens contain at least 32 random bytes, are stored hashed, and bind one booking/
household plus token revision/expiry. Initial expiry is event end + 24 hours; reissue
revokes the old token atomically. A revoked/expired token returns generic
`INVITATION_LINK_UNAVAILABLE` without household details. Token is delivered in URL
fragment, exchanged for scoped in-memory capability, and removed from browser history.
No token enters logs, event outbox, public QR, or analytics.

One scoped capability authorizes only that household's minimal invitation view and RSVP.
It cannot read phone, note, groups list, billing, media library, or another household.
Mutation accepts status and attendee count plus current household revision, never booking
ID/group ownership as authority. Rate limit: 10 link exchanges or RSVP writes per
15 minutes per resolved IP plus token fingerprint; no permanent household lockout.

RSVP deadline defaults to event start − seven days and is snapshotted with
`deadlineRevision`. Manager may set an explicit audited deadline before opening link
delivery. After deadline, guest writes return `RSVP_DEADLINE_PASSED`; Manager/Couple
can correct their own household plan with audit, producing a new source sequence.
Guest views remain readable until link expiry. Early-created bookings whose event is
less than seven days away require an explicit Manager deadline before links are issued.

## 9. HTTP, import, delivery, and search hand-off

| Method/path                                                           | Input                                                                           | Output/authority                                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET/POST /bookings/{id}/guest-groups                                  | List or name/color                                                              | Stable group DTO/revision; own FULL or Manager.                                                           |
| PATCH /bookings/{id}/guest-groups/{groupId}                           | expectedRevision, name?/color?/archive command                                  | Preserve stable ID and reference history.                                                                 |
| GET/POST /bookings/{id}/households                                    | Cursor/filter or representativeName/groupId/expectedAttendees/phone?/note?      | Own FULL/Manager DTO; PII stays private.                                                                  |
| PATCH /bookings/{id}/households/{householdId}                         | expectedRevision, approved partial fields                                       | New household revision/aggregate attendance plan when contribution changes.                               |
| POST /bookings/{id}/households/imports                                | Up to 1,000 validated JSON rows or parsed CSV equivalent, stable externalRowKey | Atomic preview/commit; same row key never inserts duplicate.                                              |
| POST /bookings/{id}/households/{householdId}/personalized-invitations | expectedRevision, delivery mode                                                 | Stable invitation identity and explicit authorized share link; token excluded from durable response logs. |
| POST /guest/invitation-sessions                                       | fragment token in strict body                                                   | Scoped in-memory capability; redacted route logging.                                                      |
| GET /guest/invitation                                                 | capability                                                                      | Approved public presentation plus minimal own RSVP status/count.                                          |
| POST /guest/rsvp                                                      | expectedRevision, status, respondingAttendees for ACCEPTED                      | New immutable RSVP plus planning contribution; no generic QR authority.                                   |

Import preview returns normalized row indexes/errors and proposed count; commit must use
the exact digest of that preview so edited data cannot bypass validation. Max 10,000
active households/booking; body/file limit 5 MiB; CSV header allowlist, spreadsheet
formula cells rejected, no partial writes. A duplicate row key with changed data requires
an explicit update preview, not blind overwrite.

Personalized sending owns delivery intent; actual provider delivery is delegated through
an invitation-delivery adapter supplied by Notifications with short-lived credential
handling as described in that SPEC. Until that adapter is ready, manual authorized
share links work and automated-delivery acceptance remains incomplete.

Search matching normalizes Unicode/case/diacritics for names and normalized full phone
for lookup. Rank exact name, prefix, substring, then household ID; name minimum two
characters, at least one of name/phone. Duplicate names remain separate ID-based rows;
never auto-check-in the first result. Search returns group display/phoneLast4/expected/
safe note; Staff joins actual attendance via its own ledger reader.

## 10. Durable headcount integration and parallel slices

At real integration, guest changes, RSVP/plan revisions, booking `synchronize`, reporting
sequence, audit, and outbox commit atomically in the shared booking unit-of-work.
A provider failure rolls back activation of the new guest plan. A staged recovery intent
may return `503 HEADCOUNT_SYNC_PENDING`, but is not a successful completed mutation;
replay activates guest and booking changes together. Retrying sequence 10 after 11 returns stale
acknowledgement; same-sequence altered count conflicts. `getExpectedAttendance`
remains the baseline port; ordered consumers use `GuestAttendancePlanReader.getPlan`.
RSVP decline changes planning contribution without mutating the original positive
household expectation or any actual arrivals. Archive cannot erase attendance history.

| Slice                                       | May overlap                      | Real dependency                                                           |
| ------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------- |
| Groups/households/import and RSVP domain    | Invitation studio implementation | Reviewed publication and headcount contracts/fakes.                       |
| Personalized-link security/scoped UI        | Invitation public screens        | Real publication reader for published content, backend access tests.      |
| Headcount synchronization/operations search | Booking/Staff isolated work      | Real ordered booking port and Staff assignment facade before integration. |
| Delivery adapter                            | Notifications channel work       | Real recipient/link intent handling before automated-delivery acceptance. |

Proposed waves: groups/households/import; personalized credentials/RSVP;
ordered headcount/search/reporting ports; HTTP/OpenAPI; Couple/Guest clients; acceptance.

| Requirements     | Proof                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| GST-001–003      | One party/record, positive expectation, companions unnamed; decline contributes zero.                 |
| GST-004–007      | Idempotent defaults, normalization, stable IDs/color, archival/history/remap integrity.               |
| GST-008; QRC-005 | Token scope/revoke/expiry, independent generic/personalized links and authorized delivery.            |
| Shared contracts | Empty total, import atomicity, sequence 11 then 10, same sequence conflict, search booking isolation. |

The aggregate planning total is bounded 0–10,000; a mutation/import exceeding that
bound is rejected before commit. Optional recipientEmail is normalized/validated and
used only for explicitly requested personalized email delivery. It is not public output.
