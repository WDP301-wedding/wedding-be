# Specification: Guest Management

- Module ID: `guest-management` (`SPEC-06`).
- Scope confirmed: 2026-10-10; Group + optional Guest amendment confirmed by owner.
- Baseline: `WEDDING-CONTRACT-3@3.0.0`, [Section 23](./CONTRACT-BASELINE.md#23-group-and-optional-guest-list--2026-10-10).
- Requirements: GST-001 through GST-009; QRC-005.
- GM-W1–GM-W4 implemented (2026-10-12); mounted contracts and validation are recorded in [the backend hand-off](./docs/guest-management-w1-w4.md). GM-W5/downstream and production readiness remain separate.
- Depends on Booking access/ordered headcount; Invitation publication only for optional personalized links.
- Consumers: Seating, Staff, Notifications and Analytics. Client presentation is frontend-owned.

## 1. Purpose

Own stable Groups, optional named Guests/import, explicit planning-total revisions
and optional personalized read-only invitations. Group is a category/area label,
not a person or invitation party; one Guest represents one named person. There is
no Household identity model or representative party name. A named Guest may bring
companions. Planned/actual companion quantity storage was proposed but not confirmed;
settle that narrow requirement before implementing dependent schemas, import or
check-in counts. Do not infer that removing Household prohibits accompanying people.

A couple can supply no names, a partial list or a full list. Groups and seating work
independently of Guest records. No Guest list is required for contract/deposit,
media, generic invitation/QR, printing, event completion or billing. Adding/importing
a name never enables check-in. Staff owns the separate per-booking opt-in mode and
check-in history; Guest owns only the named-list facts needed by Staff.

Guests only view invitations. There are no response states/history, response writes,
deadlines, reminders or analytics. Views never change planning/check-in/billing.

## 2. Models and Validation

Group: guestGroupId, bookingId, normalized unique name (1–80), uppercase
`#RRGGBB`, revision and ACTIVE/ARCHIVED status. Initialize Parents, Groom Side,
Bride Side and Friends idempotently on first confirmed group workspace access,
even when no Guest exists. Labels are localized by clients. Referenced groups
retain rename/archive history and cannot be destructively removed.

Guest: guestId, bookingId, name (1–120), active guestGroupId, optional E.164 phone,
operationalNote (0–500), revision and ACTIVE/ARCHIVED status. Contacts are optional,
not required for creation/check-in/seating. Duplicate names are separate identities;
never deduplicate people by name/phone. No per-Guest expectedAttendees is approved;
companion fields remain unresolved, not categorically forbidden.

Group uniqueness uses trim/NFKC/case-fold; retain authored display case. UUIDs,
UTC timestamps, expected revisions and audit apply throughout. Preserve retained
invitation/check-in references under archive; no hard deletion of referenced Guests.
Max 10,000 active named Guests. Planning total is an independent integer 0–10,000,
subject to Booking/Venue capacity and Seating confirmation rules.

## 3. Independent Planned Headcount

Couple/Manager explicitly enter the wedding planning total; it is not Guest count,
a per-Guest expectation, group membership count or inferred table capacity.
First initialization copies the existing Booking planning context under serialization;
no names means no automatic zero. A missing/stale source cannot initialize a guessed
value. Explicit zero is a planning value, not a statement about actual attendance.

Only an explicit total change creates/activates a new immutable booking-wide
sourceGuestPlanRevisionId and increasing sourceSequence for headcount synchronization.
Initialization pins its exact source; idempotent replay cannot replace a later value.
Guest CRUD/import/archive and group display edits advance their own reporting facts
without changing the planning total or invalidating seating for a count change.

Guest-plan activation, BookingPlanningHeadcountSynchronizer, audit and outbox
commit together under booking serialization. Provider failure rolls back; a recovery
intent is not success. Lower sequence acknowledges stale input; identical replay
succeeds, changed same-sequence facts conflict. Named-list edits never rewrite
contract quantities/prices, printed snapshots or Staff history.

## 4. Provider Contracts

```ts
interface GuestAttendancePlanReader {
  getPlan(bookingId: string): Promise<{
    sourceGuestPlanRevisionId: string;
    sourceSequence: number;
    expectedAttendees: number; // Explicit wedding planning total, not list size.
  }>;
}

interface GuestPlanningReader {
  listGuestGroups(bookingId: string): Promise<
    readonly {
      guestGroupId: string;
      name: string;
      color: string;
      status: 'ACTIVE' | 'ARCHIVED';
    }[]
  >;
  requireGuestForOperations(guestId: string): Promise<{
    bookingId: string;
    guestId: string;
    guestGroupId: string;
    name: string;
    disambiguatingPhone: string | null;
    operationalNote: string | null;
  }>;
  getGuestListSummary(bookingId: string): Promise<{
    listedGuestCount: number;
    sourceSequence: number;
  }>;
}
```

The ordered headcount DTO retains existing Booking wire field names, but its source
is the explicit plan total. Do not call the legacy household reader or report named
Guests as its expected-attendee quantities. Publish actual provider schemas/versions
and conformance before consumers integrate.

GuestOperationsSearchReader supports active booking-scoped Guests through assigned
Staff/Manager authorization facade. Cursor limit 1–50, minimum two name characters,
name/normalized phone required; rank exact, prefix, substring, stable ID. Return
phoneLast4 only, never auto-select duplicate names. Staff rechecks its enabled mode,
role, assignment and event window before operation; Guest cannot grant Staff access.

GuestReportingReader separates explicit planning total, listedGuestCount and group
membership with owner sequence/fence. It contains no per-person expected quantity,
response statistics or Staff check-in truth. Optional invitation delivery takes an
explicit intended email/publication and short-lived credential reference, never an
email inferred from a name/phone. Notifications owns send/reconciliation.

## 5. Invitation Link Security

Generic public sharing/QR requires no Guest record. A personalized link optionally
binds a real published invitation to one active Guest; no names means no personalized
issuance, not failure of the generic invitation or wedding.

Tokens use >=32 random bytes, hash-only storage, booking/guest scope, revision and
expiry at event end + 24 hours. Reissue/archive revoke old authority atomically.
Invalid/revoked/expired links return generic INVITATION_LINK_UNAVAILABLE without
Guest data. Use a fragment and short-lived capability; raw credentials never enter
durable replay, logs, audit/outbox or reporting. No guest account is required.

Capability exposes current approved invitation and minimal recipient greeting only.
No contacts, notes, group list, other Guest, private media, billing, planning or
check-in writes. Exchange limit is 10 per 15 minutes per resolved IP plus token
fingerprint; no permanent Guest lockout. Generic QR carries no personalized scope.

## 6. Authorization and Mounted HTTP

Manager and owning FULL Couple manage Groups, optional Guests and planning totals
on confirmed bookings. Restricted/public/guest-link actors are denied; assigned
Staff see minimum operational data only through their mode-aware facade.
Cross-booking IDs are concealed. Writes require declared idempotency/revision
checks, atomic audit and preserved historical references.

| Method/path                                                   | Behavior                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------ |
| GET/POST /bookings/{id}/guest-groups                          | List/create groups, including a names-free workspace         |
| PATCH /bookings/{id}/guest-groups/{groupId}                   | Rename/color/archive with retained identity                  |
| GET/POST /bookings/{id}/guests                                | Optional private list/create one named person                |
| PATCH /bookings/{id}/guests/{guestId}                         | Edit/explicit archive or restore                             |
| POST /bookings/{id}/guests/import-previews                    | Validate rows, list delta and digest                         |
| POST /bookings/{id}/guests/imports                            | Commit exact validated digest atomically; planning unchanged |
| GET/PATCH /bookings/{id}/guest-plan                           | Read/explicitly revise independent planning total            |
| POST /bookings/{id}/guests/{guestId}/personalized-invitations | Optional authorized view-only issue/reissue                  |
| POST /guest/invitation-sessions                               | Credential-redacted strict exchange                          |
| GET /guest/invitation                                         | Minimal capability read                                      |

These routes are mounted with strict Zod/runtime/OpenAPI contracts. No household aliases or response
endpoints are added. Errors include GUEST_GROUP_NAME_CONFLICT, GUEST_GROUP_IN_USE,
GUEST_PLAN_REVISION_STALE, HEADCOUNT_SOURCE_CONFLICT, GUEST_NOT_FOUND and
INVITATION_LINK_UNAVAILABLE. Check-in settings/ledger belong to SPEC-08.

## 7. Import and Delivery

JSON/parsed CSV: <=1,000 rows, <=5 MiB, stable externalRowKey. Preview validates
all rows, groups, safe error indexes and exact list delta; count/quota checks concern
the named list, never an inferred wedding attendance total. Commit requires its
digest and rejects changed row-key reuse unless an explicit update preview was
selected. Unknown headers/formula cells or any invalid row cause zero partial writes.
Same externalRowKey supports retry; identical names with distinct row keys are not
merged. Import does not enable check-in or change planning.

Manual sharing works independently. Automated delivery needs explicit recipient,
real Notifications adapter and encrypted transient credential handling. Missing
contact leaves delivery unavailable for that Guest only. Unknown send outcome
retains one intent; manual link proof cannot establish automatic delivery acceptance.

## 8. Backend Waves and Acceptance

1. GM-W1: Groups, optional Guests/import, independent planning revisions/persistence.
2. GM-W2: optional personalized read-only links; generic sharing without Guest data.
3. GM-W3: explicit ordered planning sync, Guest search/list/group reporting and delivery ports.
4. GM-W4: strict HTTP/runtime/OpenAPI and examples for names-free/partial-list workflows.
5. GM-W5: real providers, migrations/races, evidence and frontend hand-off.

Prove GST-001–009/QRC-005: groups with no names; manual total 300 with zero/20 Guests;
initialization preserves Booking count; Guest archive/import do not alter 300; only
explicit 300 -> 250 planning edit triggers ordered sync/Seating revalidation.
Test sequence 11 then 10, conflicts/rollback, quotas, duplicate names, import atomicity,
cross-booking/privacy, generic/public/private link separation and retained print history.
Integrate real Staff mode/Guest readers without implying a full wedding attendance count.

Run focused Vitest, disposable PostgreSQL migration/concurrency, contract,
lint/typecheck/build/coverage and API generation/check. Publish exact provider/API
versions; no client implementation or browser/native gate is required.
Executable tasks: [backend backlog](./tasks/backend-revision-todo.md).
