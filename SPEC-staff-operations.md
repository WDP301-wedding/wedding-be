# Specification: Staff Operations

- Status: **Approved specification — module plan and implementation acceptance pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `staff-operations` (`SPEC-08`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
- Initial owner role: C (member name to be assigned)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: CHK-001 through CHK-008
- Depends on: `identity-access`, `booking-lifecycle`, `guest-rsvp`, `seating-plan`
- Consumers: `analytics-dashboard`

## 1. Purpose and boundaries

This module owns event assignments and an append-only actual-attendance ledger. It lets
assigned Staff search an invitation household by name, optionally disambiguate safely by
phone, record several arrivals, and record auditable corrections. It does not own
household/RSVP truth, expected counts, guest groups, seating selection, or payment.

## 2. Attendance and assignment contract

An assignment binds a Staff account to a booking/event scope and current status. An
arrival has `arrivalId`, household, positive count, event time, actor, and immutable
request identity. A correction has `attendanceCorrectionId`, referenced prior evidence,
signed delta/reason, actor, and time. Neither arrival nor correction is hard-deleted.

Actual count is the sum of effective arrivals and corrections. It may exceed expected
count: success returns `hasOverExpectedWarning: true`, never a blocking error.

```ts
interface AttendanceReader {
  getHouseholdAttendance(invitationHouseholdId: string): Promise<{
    expectedAttendees: number;
    actualAttendees: number;
    hasOverExpectedWarning: boolean;
  }>;
  getBookingAttendance(bookingId: string): Promise<{
    actualAttendees: number;
    byGuestGroup: readonly { guestGroupId: string; actualAttendees: number }[];
  }>;
}
```

## 3. Dependencies and events

| Provider          | Contract                        | Use                                                         |
| ----------------- | ------------------------------- | ----------------------------------------------------------- |
| identity-access   | current role/actor              | Require current Staff or Manager role, never a client role. |
| booking-lifecycle | confirmed event context         | Validate assignment/event scope.                            |
| guest-rsvp        | `requireHouseholdForOperations` | Minimum household/group/expected/note data only.            |
| seating-plan      | current plan reader             | Group guidance only; never infer personal table/seat.       |

It emits `attendance.arrival-recorded` and `attendance.correction-recorded` v1.
Events include baseline minimum IDs/counts/times only; no phone or operational note.

## 4. Authorization, HTTP, and concurrency

Staff needs both current role and current assignment; Manager override is explicit and
audited. Assignment lifecycle is Manager-controlled. Public, Couple, restricted prospect,
and generic/personalized QR paths cannot search or record attendance.

Specified routes are `/management/events/{bookingId}/assignments`,
`/staff/events/{bookingId}/households/search`, household attendance reads, arrivals,
and correction commands. Search limits result fields, uses controlled name matching, and
reveals phone only when policy allows disambiguation. Mutations require an idempotency
key. Duplicate arrival intent replays once; concurrent different arrivals both count.
Errors include `EVENT_ASSIGNMENT_REQUIRED`, `ARRIVAL_COUNT_INVALID`,
`ATTENDANCE_CORRECTION_CONFLICT`, and non-blocking `OVER_EXPECTED_ATTENDANCE`.

## 5. Acceptance

Prove CHK-001–008 with direct backend denial tests, duplicate-name handling, multi-arrival
sum, warning-not-block behavior, correction history, assignment revocation race, and
privacy-minimized search. Integrate real guest/seating providers and prove reporting
cannot derive personal seat occupancy.

## 6. Staff provisioning, assignment, and operational window

Staff operations exposes the Manager provisioning workflow while identity owns
`StaffAccountProvisioner` and password setup. Provisioning never accepts a role field
or stores password/verifier/token. Existing normalized email identity is reused; a
separate Couple role/access must survive Staff disable. Disabling Staff operational access
revokes Staff authority and applicable sessions through the identity port and revokes
active event assignments through this module's audited commands.

An assignment is `ACTIVE | REVOKED`, unique by booking/account with revision and history.
Current actor role and assignment are rechecked inside every write. Manager override
requires reason 10–500. Event window defaults to start − two hours through event end +
12 hours; regular arrivals outside it return `CHECK_IN_WINDOW_CLOSED`. Manager may
record an explicit reasoned late arrival/correction, including after completion.

Attendance uses immutable positive arrival counts (1–100) and correction deltas
(−100 through +100, nonzero) linked to a specific arrival. Effective count for any arrival
and total household cannot fall below zero. Each correction has expectedLedgerRevision,
reason 10–500, acting account and event time. Staff may correct only their own arrivals
while assigned and within the window; Manager may correct all with explicit audit.

A household's attendance group is snapshotted from the first valid arrival; subsequent
arrivals/corrections retain it. If current guest group changes, return a
`GUEST_GROUP_CHANGED` guidance warning while preserving historical grouping. Do not
silently move previous attendance to a new group. The ledger revision is monotonically
increasing and allocated atomically with arrival/correction/reporting change.

## 7. Operational HTTP request/response contract

| Method/path                                                     | Input                                                            | Result                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| POST /management/staff-accounts                                 | email; durable command key                                       | accountId/setupRequired via identity; Manager only.                                     |
| POST /management/staff-accounts/{id}/operational-access         | enabled, reason                                                  | Identity-owned role/session change plus assignment reconciliation.                      |
| GET/POST /management/events/{bookingId}/assignments             | List or staffAccountId                                           | Current assignment/revision; active Staff identity required.                            |
| POST /management/events/{bookingId}/assignments/{id}/revocation | expectedRevision, reason                                         | REVOKED with retained history.                                                          |
| GET /staff/events/{bookingId}/households/search                 | name?/phone?, cursor?, limit 1–50                                | Guest operations search joined with actualAttendees/warning and seating group guidance. |
| POST /staff/events/{bookingId}/households/{id}/arrivals         | attendeeCount, eventTime?, Manager override reason when required | arrivalId/ledgerRevision/cumulative actual count/warnings; 201 even when over expected. |
| POST /staff/events/{bookingId}/households/{id}/corrections      | arrivalId, delta, expectedLedgerRevision, reason                 | New correctionId/ledgerRevision/effective count; never overwrite arrival.               |
| GET /staff/events/{bookingId}/households/{id}/attendance        | cursor when history requested                                    | Minimum summary and authorized ledger history.                                          |

Name/phone query fields are redacted from access logs and metrics. Backend joins guest
search and attendance using returned household IDs, not direct guest repository access.
PhoneLast4 is the only contact output on this search surface. Guest names/notes are private
operational output, never events/analytics labels. Missing seating returns provisional/
ABSENT guidance and does not block arrival.

When actual count exceeds expected count, response is successful with
`warnings: [{code: 'OVER_EXPECTED_ATTENDANCE', expectedAttendees, actualAttendees}]`.
This code is never placed in the HTTP error envelope. Stale correction is
`ATTENDANCE_CORRECTION_CONFLICT` (409), assignment denial 403/concealed 404 as scoped,
invalid/negative-effective counts 422. Revocation racing an arrival has a serialized
winner; an already committed arrival remains evidence.

## 8. Reporting, concurrency, and independent implementation

`AttendanceReportingReader` publishes absolute household actual totals and snapshotted
group ID at a source fence (baseline Section 21). Corrections update one authoritative
ledger; analytics never sums event deltas without an idempotent source checkpoint.

| Slice                               | Can overlap                                               | Requires real provider                                                |
| ----------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Assignment/arrival/correction rules | Seating and Notifications domain work                     | Frozen current-role/window/household/guidance DTOs.                   |
| PostgreSQL ledger/repository        | Other modules in separate file lanes                      | Serialized migration order and concurrent append/correction tests.    |
| Staff search and Web components     | Guest search/Seating implementation with conforming fakes | Real search scope + identity/assignment + guidance before acceptance. |
| Provisioning disable/revocation     | Identity-owned adapter slice                              | Real identity role/session behavior, no fake-only security closure.   |

Proposed waves: provisioning/assignments; attendance ledger;
search/guidance/reporting; HTTP/OpenAPI; Staff Web; acceptance.

| Requirements    | Focused proof                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| CHK-001/002     | Duplicate names, name/phone ranking, exact booking scope, expected/actual/group/color/safe note.            |
| CHK-003–006     | Two arrivals counted once each, same-key replay, over-expected 201, correction race/nonnegative history.    |
| CHK-007/008     | Group guidance with absent/stale seating, no personal table reservation, QR carries no operation authority. |
| Security/source | Role/assignment revocation race; Couple role survives Staff disable; real read-port/report rebuild.         |
