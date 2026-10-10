# Specification: Guest Management

- Module ID: `guest-management` (`SPEC-06`).
- Scope confirmed: 2026-10-10; backend implementation pending.
- Baseline: `WEDDING-CONTRACT-2@2.0.0`.
- Requirements: GST-001 through GST-009; QRC-005.
- Replaces the former guest response specification under the confirmed product amendment.
- Depends on: Booking access/headcount ports and Invitation publication reader.
- Consumers: Seating, Staff, Notifications and Analytics.
- Execution: backend only; client presentation belongs to the frontend team.

## 1. Purpose

Own invitation households/parties, stable groups, import, personalized read-only
links, delivery intents and expected headcount. One household represents one person,
couple, family or party; companion names are not required. Retain name-based Staff
check-in and group-level seating through their respective owner ports.

Guests cannot respond with an attendance decision or count, alter plans or check in.
There are no guest response states/history, deadline settings, response routes,
response reminders or response events. Viewing/sharing an invitation has no effect
on headcount, actual arrivals, billing or access.

## 2. Models and Validation

Group: stable guestGroupId, bookingId, normalized unique name (1–80), uppercase
`#RRGGBB`, revision and ACTIVE/ARCHIVED status. Initialize Parents, Groom Side,
Bride Side and Friends idempotently on first confirmed guest workspace access.
Localized labels are frontend presentation; the backend returns stable identities.
Referenced groups may be renamed/archived, never destructively removed.

Household: invitationHouseholdId, bookingId, representativeName (1–120), active
group ID, expectedAttendees (positive integer 1–100), optional E.164 phone,
operationalNote (0–500), revision and active/archive state. Preserve duplicate
names as separate records. No individual seat assignment or companion identity.

Names use trim/NFKC/case-fold for group uniqueness; retain authored display case.
All resources use UUIDs, UTC timestamps, expected revisions and audit evidence.
Max 10,000 active households; aggregate expected headcount cannot exceed 10,000.

## 3. Planned Headcount

Sum expectedAttendees of active households only. Empty list has zero and an
initialized immutable plan revision. Creating/updating count, archive/restore or
atomic import produces a booking-wide sourceGuestPlanRevisionId and increasing
sourceSequence. Group display edits do not change attendance, but advance reporting
sequence. Actual arrivals remain Staff-owned and never change planned contribution.

Guest plan activation, BookingPlanningHeadcountSynchronizer, reporting sequence,
audit and outbox commit together under booking serialization. Provider failure
rolls back the plan; a recovery intent is not success. A lower sequence is a stale
acknowledgement, identical replay succeeds, changed same-sequence facts conflict.

## 4. Provider Contracts

```ts
interface GuestAttendancePlanReader {
  getPlan(bookingId: string): Promise<{
    sourceGuestPlanRevisionId: string;
    sourceSequence: number;
    expectedAttendees: number;
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
    sourceGuestPlanRevisionId: string;
    expectedAttendees: number;
  }>;
}
```

GuestOperationsSearchReader supports assigned Staff through its authorization
facade, booking-scoped active households, cursor paging 1–50 and phoneLast4 only.
Normalize name/diacritics for lookup; minimum two characters; name or normalized
phone required. Rank exact name, prefix, substring, then stable ID. Never auto-select
or check in the first duplicate-name result. Exact internal operations reads remain
minimum data and require the authorized Staff/Manager facade.

GuestReportingReader supplies expected counts/groups and monotonic source sequence,
not guest response statistics. GuestAutomationReader has no response deadline read.
PersonalizedInvitationDeliveryPort accepts explicit intended email, publication and
short-lived credential references; Notifications owns actual send/reconciliation.

## 5. Invitation Link Security

Require a real published invitation. Tokens have >=32 random bytes, hash-only
storage, booking/household scope, revision and expiry at event end + 24 hours.
Reissue revokes the old token atomically. Invalid/revoked/expired links return generic
INVITATION_LINK_UNAVAILABLE without household data. Use a URL fragment, exchange
into a short-lived scoped capability and exclude raw credentials from durable logs,
audit/outbox/reporting. API does not require any guest account.

Capability grants only the current published invitation plus minimal authorized
recipient greeting. No contacts, operational notes, group list, media library,
billing, other household, planning mutation or actual attendance mutation.
Limit exchanges to 10 per 15 minutes per resolved IP plus token fingerprint;
do not permanently lock a household. Generic public QR grants no household scope.
Views end at expiry; no response deadline exists.

## 6. Authorization and Proposed HTTP

Manager and own FULL Couple manage groups/households on their confirmed booking.
Restricted prospects, public users, guest capabilities and unassigned Staff are
denied. Staff obtains minimum operational information only through assigned facade.
Conceal cross-booking resource identity. All writes use Idempotency-Key and
expectedRevision; audit manager overrides and archival without deleting history.

| Method/path                                                           | Behavior                                           |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| GET/POST /bookings/{id}/guest-groups                                  | List/create stable groups                          |
| PATCH /bookings/{id}/guest-groups/{groupId}                           | Rename/color/archive, preserve identity            |
| GET/POST /bookings/{id}/households                                    | Private list/create                                |
| PATCH /bookings/{id}/households/{householdId}                         | Update/explicit archive or restore                 |
| POST /bookings/{id}/households/import-previews                        | Normalize/validate rows and return digest          |
| POST /bookings/{id}/households/imports                                | Commit exact validated digest atomically           |
| POST /bookings/{id}/households/{householdId}/personalized-invitations | Issue/reissue authorized view-only link            |
| POST /guest/invitation-sessions                                       | Strict token exchange, credential-redacted logging |
| GET /guest/invitation                                                 | Minimal invitation read via capability             |

Routes are specification proposals until runtime and Zod/OpenAPI exist. Do not add
any guest attendance-response or deadline-policy endpoint. Errors include
GUEST_GROUP_NAME_CONFLICT, GUEST_GROUP_IN_USE, GUEST_PLAN_REVISION_STALE,
HEADCOUNT_SOURCE_CONFLICT, HOUSEHOLD_NOT_FOUND and INVITATION_LINK_UNAVAILABLE.

## 7. Import and Delivery

JSON rows or parsed CSV: <=1,000 rows, <=5 MiB, stable externalRowKey. Preview
validates every row, normalized safe error indexes and proposed aggregate count.
Commit consumes its exact digest; reject changed payload or duplicate row key with
different data unless an explicit update preview was approved. Reject unknown CSV
headers/formula cells. Invalid row or aggregate overflow means zero partial writes.

Manual authorized sharing is independently usable. Automated delivery requires the
real Notifications adapter and encrypted transient credential handling. Unknown
provider outcome preserves one intent; no blind second send. Do not mark automatic
delivery accepted based on manual link proof.

## 8. Backend Waves and Acceptance

1. GM-W1: groups/households, validation, import and serialized persistence.
2. GM-W2: view-only link issue/exchange/read/reissue and privacy/rate/expiry proof.
3. GM-W3: ordered planning sync, operational search, reporting and delivery ports.
4. GM-W4: strict HTTP, runtime composition, OpenAPI and DTO examples.
5. GM-W5: real-provider integration, migrations/races, evidence and frontend hand-off.

Prove GST-001–009/QRC-005: import atomicity; normalized defaults; history under
archive; no guest writes; ordered sync 11 then 10; same-sequence conflict; empty/overflow
plans; cross-booking denials; read capability isolation; public/private QR separation;
real headcount -> seating invalidation -> printable snapshot behavior. Test existing
check-in consumers still read active expected counts while preserving arrival history.

Run focused Vitest, required disposable PostgreSQL migrations/concurrency, contract
tests, lint/typecheck/build/coverage and API generation/check. Publish exact API digest
and provider versions. No client implementation, screenshots or Android runtime
verification is required for backend acceptance. See tasks/backend-revision-todo.md.
