# SPEC-08 Staff Operations — backend hand-off

Date: 2026-10-12 (Asia/Saigon). Provider version: `staff-operations@1.0.0`.
Authority: [confirmed scope](backend-scope-2026-10-10.md),
[SPEC-08](../SPEC-staff-operations.md). Acceptance results and exact OpenAPI digest
are recorded in [evidence](../tasks/evidence/staff-operations-w1-w5-2026-10-12.md).

This release implements the named Guest contract. A Guest may bring other people.
Companion quantities, their correction rules and whole-event attendance measurement
remain unconfirmed and are not represented by these endpoints. Strict schemas
describe the named identity operations, not a prohibition of accompanying people.
The owner explicitly confirmed this named-only scope and separate companion follow-up
on 2026-10-12 during implementation.

## Runtime and ownership

The production bootstrap mounts the Staff router through the existing combined
Invitation/Seating runtime. `createStaffSeatingServices` shares its Prisma booking
boundary with Guest, Booking, Identity and Seating adapters. Staff authenticates the
operational call before supplying the opaque scope to Seating. An arbitrary scope
without Staff admission cannot obtain guidance. Database lifecycle remains owned by
that runtime; Staff adds no independent connection or background scheduler.

Identity owns normalized-email account reuse, the STAFF role and session revocation.
Disabling operational access atomically revokes all active Staff assignments and
current sessions, but preserves independent COUPLE roles and consultation access.
Couple users sign in again afterward. Enabling STAFF does not reactivate assignments.
Manager identities cannot be targets of Staff operational role changes.

Provisioning accepts email only, creates no password or bearer token, and returns
`credentialSetupRequired`. Existing Identity password-OTP request/confirm endpoints
perform setup. This command does not send setup mail. Live mailbox delivery remains
the separate Identity provider gate; credentials and local tests are not proof of it.

Booking supplies settled confirmed event access and the immutable approved shift
snapshot. The Staff-specific reader also allows COMPLETED events so reasoned late
Manager corrections do not become impossible after completion. Cancelled/unsettled
events are denied. Guest supplies active identity/count/search/Group facts through
owner ports; Staff cannot edit the list or planning total. Seating supplies current
Group guidance and succeeds with ABSENT when no plan exists.

## Authorization

| Action                         | Manager                                   | Owning FULL Couple | Assigned current Staff                            | Public/link/QR |
| ------------------------------ | ----------------------------------------- | ------------------ | ------------------------------------------------- | -------------- |
| Provision/enable/disable Staff | Yes                                       | No                 | No                                                | No             |
| List/assign/revoke event staff | Yes                                       | No                 | No                                                | No             |
| Read settings and safe summary | Yes                                       | Yes                | No                                                | No             |
| Configure check-in mode        | Yes                                       | Yes                | No                                                | No             |
| Search/read named history      | Yes                                       | No                 | Enabled mode, assigned, within window             | No             |
| CHECK_IN                       | Explicit override reason                  | No                 | Active named Guest, enabled mode, within window   | No             |
| UNDO                           | Any effective record with override reason | No                 | Own effective record, enabled mode, within window | No             |

Mode defaults to NONE. Assignment can exist for other duties in NONE mode. Only an
explicit Couple/Manager configuration command enables BY_GUEST_NAME, with at least
one active Guest. Guest creation/import never enables it. After the first journal
record mode is permanently locked, even when every record has been undone.

Window: event start minus two hours through event end plus twelve hours, inclusive,
using Asia/Saigon (+07:00) dates from Booking. Server recording time controls window
admission. Manager writes always require `overrideReason` (10–500 characters); it
can override only the window, never mode, event settlement or Guest identity.
Optional `eventTime` cannot be in the future. Staff cannot supply override authority.
Manager reads can inspect retained history after the operational window.

## Mounted API

All paths below are relative to `/api/v1`, use bearer authentication and return
`{ "data": ... }`. Private responses use `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`. Every mutation requires a 1–128 printable-ASCII
`Idempotency-Key`. Unknown query/body keys are rejected. POST returns 201; PATCH/GET
return 200. There are no public Staff routes and no attendance-write invitation route.

| Method    | Path                                                                   | Input                                                                 |
| --------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| POST      | `/management/staff-accounts`                                           | `{email}`                                                             |
| POST      | `/management/staff-accounts/{accountId}/operational-access`            | `{enabled, reason}`                                                   |
| GET       | `/management/events/{bookingId}/assignments`                           | Complete bounded list, at most 100 retained assignments               |
| POST      | `/management/events/{bookingId}/assignments`                           | `{staffAccountId, expectedRevision}`; 0 initially                     |
| POST      | `/management/events/{bookingId}/assignments/{assignmentId}/revocation` | `{expectedRevision, reason}`                                          |
| GET/PATCH | `/bookings/{bookingId}/check-in-settings`                              | PATCH: `{checkInMode, expectedRevision}`                              |
| GET       | `/bookings/{bookingId}/attendance-summary`                             | No query/body                                                         |
| GET       | `/staff/events/{bookingId}/guests/search`                              | `query` (2–120), optional opaque `cursor`, `limit` (1–50, default 25) |
| POST      | `/staff/events/{bookingId}/guests/{guestId}/check-ins`                 | `{eventTime?, overrideReason?}`; Staff normally sends `{}`            |
| POST      | `/staff/events/{bookingId}/guests/{guestId}/check-in-undos`            | `{checkInRecordId, expectedLedgerRevision, reason, overrideReason?}`  |
| GET       | `/staff/events/{bookingId}/guests/{guestId}/check-ins`                 | `afterRevision` (default 0), `limit` (1–50, default 25)               |

Example enablement:

```json
{ "checkInMode": "BY_GUEST_NAME", "expectedRevision": 1 }
```

Example Staff correction:

```json
{
  "checkInRecordId": "10000000-0000-4000-8000-000000000001",
  "expectedLedgerRevision": 3,
  "reason": "Sửa thao tác check-in nhầm người"
}
```

`expectedLedgerRevision` is the effective CHECK_IN record revision for that Guest,
not the settings revision or another Guest's most recent booking-wide revision.
Record responses contain action, monotonic booking ledger revision, server timestamp,
actor ID, retained Group snapshot and optional reason. UNDO returns a new record ID
and `originalCheckInRecordId`; no record is overwritten.

Search returns distinct Guest IDs (including duplicate names), name, phoneLast4,
current Group, effective state and table labels. It exposes neither full phone nor
operational notes. Name/phone queries do not appear in request logs or metric labels.
Never automatically select the first duplicate name. Opaque search cursors become
stale on list changes. `GUEST_GROUP_CHANGED` warns when current grouping/display
differs from the retained check-in grouping. Group guidance is not a personal seat
reservation and can be ABSENT, DRAFT, CONFIRMED or REQUIRES_REVIEW.

## Errors and retries

The canonical error envelope is `{error:{code,message,requestId,details?}}`.

| Status | Codes / meaning                                                                                                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | IDEMPOTENCY_KEY_REQUIRED                                                                                                                                                                                                                        |
| 401    | Invalid, expired, revoked session/credential                                                                                                                                                                                                    |
| 403    | EVENT_ASSIGNMENT_REQUIRED, CHECK_IN_DISABLED, CHECK_IN_WINDOW_CLOSED, MANAGER_OVERRIDE_REQUIRED, CHECK_IN_CORRECTION_FORBIDDEN                                                                                                                  |
| 404    | Unowned/foreign resource or GUEST_NOT_FOUND; Couple cannot write attendance                                                                                                                                                                     |
| 409    | IDEMPOTENCY_KEY_REUSED, STAFF_ASSIGNMENT_STALE, STAFF_ASSIGNMENT_QUOTA_EXCEEDED, NAMED_GUEST_LIST_REQUIRED, CHECK_IN_CONFIGURATION_STALE, CHECK_IN_MODE_LOCKED, GUEST_ALREADY_CHECKED_IN, CHECK_IN_CORRECTION_CONFLICT, GUEST_LIST_CURSOR_STALE |
| 422    | Invalid idempotency key, invalid/unknown fields, future eventTime                                                                                                                                                                               |

Identical same-key replay returns the original result after current authorization
is rechecked. Changed same-key payload conflicts. New-key duplicate CHECK_IN does
not increment attendance. Different Guests may each contribute one. Concurrent
UNDO appends one effective correction; stale or already-undone input conflicts.
Revoked Staff cannot recover command results using an old key. Archived Guests
cannot receive a new CHECK_IN, including replay, but their retained records can be
corrected by an authorized actor. Journal, audit, command receipt, outbox and
report snapshot commit together; failed mandatory writes roll back all effects.

## Attendance/reporting providers

`AttendanceReaders.getGuestCheckIn(guestId)` returns effective state, latest Guest
ledger revision and effective check-in record ID. `getBookingAttendance(bookingId)`
returns the strict `attendanceSchema` contract:

- NONE: NOT_RECORDED, `checkedInGuestCount: null`, no measured Group rows.
- BY_GUEST_NAME: LISTED_GUESTS_ONLY, known zero before recording; distinct effective
  listed Guest count, including subsequently archived Guests.
- Counts by Group retain the first recorded stable Group identity/display snapshot.
  UNDO/recheck-in never moves historical attendance to a Guest's new Group.

Guest independently supplies `planningHeadcount` and `listedGuestCount`. Consumers
must keep all three values separate and must not infer a whole-event attendance
rate, completeness or a billing quantity from the partial list.

`readPage(bookingId, {afterSequence, throughSequence?, limit}, context)` allows only
SYSTEM with null actor and purpose `reporting:staff-operations` or `reporting:rebuild`.
It publishes immutable absolute mode/count snapshots with a stable sequence fence,
changedAt, recordId and nextAfterSequence. No activity means a zero fence/empty page;
the current owner reader still supplies NONE/null. Analytics replaces projections
by source sequence; it must not add retry-delivered deltas.

Outbox event names (version 1 contract) are `attendance.guest-checked-in` and
`attendance.guest-check-in-undone`. Payloads contain bookingId, guestId, record ID,
ledgerRevision, recordedAt; UNDO adds originalCheckInRecordId. They contain no name,
phone, note, correction text or companion quantities. Dispatcher/delivery is SPEC-09;
these rows do not prove a consumer ran.

## Migration and operation

Apply additive migration `20261012030000_staff_operations` after Guest/Seating
migrations. Regenerate Prisma before typecheck/build. Existing bookings/names/payment
facts are preserved and acquire no inferred assignments or attendance. Database
foreign keys retain Guest/Group/account identities; immutable triggers prohibit
changes/deletes of journal, receipts, history, outbox and report snapshots. The
journal guard enforces mode, monotonic sequence and one effective named identity.

Booking advisory serialization coordinates Guest archive/move, mode, check-in and
assignment revision commands. Identity row locks additionally coordinate current
role/session revocation and operational disable. Rollback means reverting code while
keeping the additive tables/history; never delete journal evidence or rewrite an
applied migration. Future repair requires an additive migration/audited correction.

Frontend chooses its screens and consumes the generated OpenAPI contract. No
frontend changes, builds or screenshots are acceptance evidence for this hand-off.
Production deployment, live mail and external provider readiness remain separate
RV/REL gates. No paid generation or real-money payment is needed for Staff acceptance.

For local acceptance, `scripts/staff-operations.verify.mjs` validates the demo
administrator and creates a fresh foundation database before actual migration deploy.
Both runtime/migration URLs and the child-suite administrator are bound to local
targets. It runs the repository Vitest entry point and cleans up that exact foundation
database. Use one worker on an 8 GB Windows host and run lint/build separately.
