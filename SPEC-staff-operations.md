# Specification: Staff Operations

> Current authority: [confirmed backend scope](./docs/backend-scope-2026-10-10.md),
> [baseline Section 23](./CONTRACT-BASELINE.md#23-group-and-optional-guest-list--2026-10-10)
> and [backend backlog](./tasks/backend-revision-todo.md). Historical approvals do
> not establish implementation or live readiness.

- Module ID: `staff-operations` (`SPEC-08`).
- Business amendment confirmed: 2026-10-10; implementation pending.
- Baseline: `WEDDING-CONTRACT-3@3.0.0`; previous 1.x/2.0 scope retained as history.
- Original specification approved 2026-10-06 (baseline Section 21.9).
- Requirements: CHK-001 through CHK-008.
- Depends on Identity, Booking, Guest and optional Seating guidance.
- Consumer: Analytics. Execution/acceptance is backend-only.

## 1. Purpose and Boundaries

Own Staff provisioning/assignments, per-booking name-based check-in configuration
and append-only check-in/undo history. Check-in is optional and records one listed
Guest identity once, not a Household identity. That Guest may bring companions;
planned/actual companion recording remains unconfirmed. The journal and payload
below describe named Guest state only, not a final all-person arrival contract.
Resolve companion-dependent fields/counts before implementing them. Guest owns
Group/name/list facts and independent planning totals; Staff does not edit them.
No attendance fact changes contract, deposit, invoice or planning quantities.

## 2. Per-Booking Mode

checkInMode is NONE by default or BY_GUEST_NAME. Owning FULL Couple/Manager may
explicitly change it with expected configuration revision and an idempotency key;
Staff cannot enable it. Enabling requires confirmed event access and at least one
active named Guest. A partial list is allowed, never labelled complete by inference.

Guest insertion/import never changes the mode. NONE requires no named-search or
check-in workflow; Staff assignments for other duties and normal event completion
remain possible. Disabled operation is CHECK_IN_DISABLED, not fabricated arrivals.

Mode writes, Guest eligibility and check-in records serialize through booking-bound
UoW/provider locks. After the first committed check-in record the mode is locked;
undo cannot permit switching to NONE to hide history. An archived Guest does not
erase its prior records or automatically disable the mode. New check-in requires an
active Guest; correction of retained history remains authorized/audited.

## 3. Check-In State and Corrections

A record contains checkInRecordId, bookingId, guestId, action CHECK_IN or UNDO,
event time, actor, durable request identity and monotonic ledger revision.
UNDO refers to the currently effective CHECK_IN and requires expectedLedgerRevision
and reason 10–500. Neither action is hard-deleted or overwritten.

Each Guest has effective count 0 or 1, enforced under transaction/concurrency guards.
Same-key identical replay returns the original result. Different-key/concurrent
duplicate CHECK_IN is GUEST_ALREADY_CHECKED_IN and cannot increment a count;
duplicate/stale UNDO is CHECK_IN_CORRECTION_CONFLICT. A new audited CHECK_IN after
UNDO is allowed but still produces at most one effective check-in for that Guest.
Clients cannot choose roles or bypass duplicate protection. Companion count inputs,
validation and correction semantics remain open; do not treat this proposal as an
approved prohibition of companions or an implemented all-person counting API.

First check-in snapshots stable Group identity/display history. Group edits/Guest
archival do not rewrite historical grouping; current guidance can warn
GUEST_GROUP_CHANGED without moving recorded attendance. Corrections remain
effective on historical groups. No group implies a personal table/seat reservation.

## 4. Readers and Events

```ts
interface AttendanceReader {
  getGuestCheckIn(guestId: string): Promise<{
    guestId: string;
    checkedIn: boolean;
    ledgerRevision: number;
  }>;
  getBookingAttendance(bookingId: string): Promise<{
    checkInMode: 'NONE' | 'BY_GUEST_NAME';
    measurementStatus: 'NOT_RECORDED' | 'LISTED_GUESTS_ONLY';
    checkedInGuestCount: number | null;
    byGuestGroup: readonly {
      guestGroupId: string;
      checkedInGuestCount: number;
    }[];
  }>;
}
```

NONE returns NOT_RECORDED, null and no measured group rows, not 0 actual attendance.
Enabled returns LISTED_GUESTS_ONLY and the distinct effective count (known zero
before any check-in), including retained check-ins for subsequently archived Guests.
It does not claim total wedding attendance or that the supplied list is complete.

GuestPlanningReader.requireGuestForOperations and GuestOperationsSearchReader
supply minimum Guest/Group data; Identity owns role/session facts, Booking event
scope and Seating group guidance. Staff queries use owner ports, not repositories.

New v1 event names are attendance.guest-checked-in and attendance.guest-check-in-undone
with bookingId, guestId, checkInRecordId, ledgerRevision and recordedAt. UNDO also
references the original record. No PII, guest response or party quantity is emitted.
Do not reuse old household arrival/correction v1 schemas with different meanings.

## 5. Authorization, Provisioning and Window

Staff needs current role, assignment, BY_GUEST_NAME mode and active Guest.
Manager override is explicit, audited and cannot bypass mode/Guest identity.
Public, guest-link, Couple and generic/personalized QR cannot search/record check-in.
Owning Couple may read the safe summary/configuration but cannot write attendance.

StaffAccountProvisioner remains Identity-owned; no role field or password/token
is accepted by Staff provisioning. Reuse an existing normalized-email identity,
preserve independent Couple access, and reconcile role/session disable with
assignment revocation. Assignment ACTIVE/REVOKED is unique by booking/account with
revision/history. Recheck role/assignment/mode/Guest inside writes.

Window remains start - two hours through event end + 12 hours. Regular writes
outside it return CHECK_IN_WINDOW_CLOSED; reasoned Manager late check-in/undo
may override only the window. Staff undo only their own effective record within
assignment/window; Manager may undo any with audit. No check-in is a prerequisite
for Booking completion, printing, payment or final-invoice creation.

## 6. Proposed HTTP

| Method/path                                                     | Input / authority                                           | Result                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| POST /management/staff-accounts                                 | email, durable key; Manager                                 | Identity account/setup result               |
| POST /management/staff-accounts/{id}/operational-access         | enabled, reason; Manager                                    | Role/session/assignment reconciliation      |
| GET/POST /management/events/{bookingId}/assignments             | list or staffAccountId; Manager                             | Current assignment/revision                 |
| POST /management/events/{bookingId}/assignments/{id}/revocation | expectedRevision, reason; Manager                           | Retained revocation                         |
| GET/PATCH /bookings/{bookingId}/check-in-settings               | mode, expectedRevision on write; owning FULL Couple/Manager | NONE/BY_GUEST_NAME, config revision/history |
| GET /staff/events/{bookingId}/guests/search                     | name?/phone?, cursor, limit 1–50; enabled assigned facade   | Safe Guest state/group guidance             |
| POST /staff/events/{bookingId}/guests/{guestId}/check-ins       | eventTime?, Manager override reason when required           | One effective check-in and ledger revision  |
| POST /staff/events/{bookingId}/guests/{guestId}/check-in-undos  | checkInRecordId, expectedLedgerRevision, reason             | Appended undo/revision                      |
| GET /staff/events/{bookingId}/guests/{guestId}/check-ins        | cursor; authorized history read                             | Minimum summary/history                     |

All paths are proposals until runtime/Zod/OpenAPI exist. Writes need idempotency/
expected revisions as declared; strict input must follow the final confirmed companion
contract rather than infer it from Household removal. Cross-event
resources are concealed. Search uses privacy-minimized name matching, phoneLast4
only and never auto-selects the first duplicate name. Name/phone queries are
redacted from logs/metrics; notes never enter analytics/events.

Missing Seating is successful ABSENT/provisional guidance and does not block
enabled check-in. Errors include EVENT_ASSIGNMENT_REQUIRED, CHECK_IN_DISABLED,
NAMED_GUEST_LIST_REQUIRED, CHECK_IN_MODE_LOCKED, CHECK_IN_CONFIGURATION_STALE,
GUEST_ALREADY_CHECKED_IN, CHECK_IN_CORRECTION_CONFLICT and GUEST_NOT_FOUND.

## 7. Reporting and Acceptance

AttendanceReportingReader publishes mode/status and absolute distinct effective
Guest counts with owner sequence/fence; Group IDs retain historical snapshots.
Analytics never sums replayed event deltas or treats disabled data as a measured zero.

Prove CHK-001–008: NONE/no-list journey; insertion does not enable; enable requires
names; partial names do not measure whole-event attendance; duplicate-name lookup;
concurrent same/different-key check-in yields one; two different Guests count two;
UNDO/recheck-in/revocation/mode/archive races, lock after first record and no hard
history deletion. Seating absence never blocks; QR cannot grant operations authority.

STF-W1 covers provisioning/assignments and configuration; STF-W2 the one-person
journal; STF-W3 Guest/Seating/reporting ports; STF-W4 strict HTTP/runtime/OpenAPI;
STF-W5 real-provider/migration/concurrency evidence and frontend hand-off.
Use the [active backlog](./tasks/backend-revision-todo.md); do not reopen historical
Household acceptance or claim proposed endpoints are already deployed.
