# Specification: Booking Lifecycle

- Status: **Approved specification — module plan and implementation acceptance pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `booking-lifecycle` (`SPEC-03`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
- Initial owner role: A (member name to be assigned)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: ACC-001; TML-001 through TML-008
- Depends on: `identity-access`, `venue-catalog`
- Consumers: `payments-billing`, `invitation-studio`, `guest-rsvp`, `seating-plan`, `staff-operations`, `notifications-automation`, `analytics-dashboard`

## 1. Purpose and non-goals

This module is authoritative for consultations, event-slot availability and holds,
bookings, copied timeline proposals, approvals, deposit eligibility, planning
headcount, cancellation, and completion. It requests restricted workspace access only
after a consultation exists through the identity-owned provider contract.

It does not own passwords, invitation tokens, payment attempts or settlement, catalog
geometry/prices, guest households, seating labels, print fulfilment, or notifications.
It persists exact catalog-version IDs and immutable owned snapshots; it never looks up a
current catalog record to reinterpret a committed proposal or booking.

## 2. Authoritative model and invariants

| Aggregate    | Authoritative facts                                                                     | History rule                                         |
| ------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Consultation | manager, intended contact, restricted-workspace link, proposal context                  | Invitation revocation never deletes it.              |
| Slot hold    | hall, local event date, shift, holder, expiry                                           | One active hold per slot; expiry is terminal.        |
| Booking      | consultation, hall/shift/date snapshots, phase, effective timeline, headcount, revision | Saves exact selected catalog versions.               |
| Timeline     | booking-owned ordered items, approvals, predecessor                                     | Every substantive save has a new immutable revision. |

`eventDate` is an ISO local date in `Asia/Ho_Chi_Minh`; timestamps are UTC. Shift codes
are `LUNCH` and `DINNER`. Phases are `DRAFT`, `AWAITING_DEPOSIT`, `CONFIRMED`,
`CANCELLED`, and `COMPLETED`.

```text
DRAFT -> AWAITING_DEPOSIT -> CONFIRMED -> COMPLETED
| | |
+-------------+-----------------+-> CANCELLED
```

Only a current mutually approved timeline revision permits `AWAITING_DEPOSIT`. After
settlement, the previous effective revision remains valid until an approved replacement
becomes effective. A client redirect or callback body alone never changes booking state.

## 3. Produced backend contracts

```ts
interface BookingLifecycleReader {
  requireBookingAccess(input: {
    bookingId: string;
    accountId: string;
    minimum: 'RESTRICTED' | 'FULL';
  }): Promise<{
    consultationId: string;
    bookingId: string;
    phase: 'DRAFT' | 'AWAITING_DEPOSIT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  }>;
  requireDepositEligibility(input: { bookingId: string; timelineRevisionId: string }): Promise<{
    eligible: boolean;
    reasonCode:
      | 'ELIGIBLE'
      | 'TIMELINE_NOT_MUTUALLY_APPROVED'
      | 'REVISION_SUPERSEDED'
      | 'SLOT_NOT_AVAILABLE'
      | 'BOOKING_NOT_PAYABLE';
    consultationId: string;
    coupleAccountId: string;
    bookingRevision: number;
    depositAmountVnd: number;
  }>;
  requireConfirmedEventContext(bookingId: string): Promise<{
    consultationId: string;
    bookingId: string;
    hallId: string;
    shiftCode: 'LUNCH' | 'DINNER';
    eventDate: string;
    effectiveTimelineRevisionId: string;
    planningHeadcount: number;
  }>;
}

interface BookingDepositRecorder {
  recordSuccessfulDeposit(input: {
    bookingId: string;
    timelineRevisionId: string;
    paymentId: string;
    amountVnd: number;
    settledAt: Date;
  }): Promise<{ phase: 'CONFIRMED'; replayed: boolean }>;
}

interface BookingPlanningHeadcountUpdater {
  updateFromGuestPlan(input: {
    bookingId: string;
    sourceRsvpRevisionId: string;
    expectedAttendees: number;
  }): Promise<{ bookingRevision: number; changed: boolean }>;
}
```

`requireDepositEligibility` is a fresh-state check, not a token; payments must repeat
it immediately before money effects. Deposit recording is idempotent by `paymentId`.
Changing the booking, revision, or amount for an existing payment returns
`409 PAYMENT_EVIDENCE_CONFLICT`. RSVP updates are idempotent by source revision and an
older revision cannot restore stale planning data. The ordered update path uses
`BookingPlanningHeadcountSynchronizer` from accepted amendment 1.1.0; UUIDs themselves
are never compared. The original updater remains for serialized legacy callers only.

## 4. Consumed contracts and emitted events

| Provider         | Contract/event                                                                                 | Permitted use                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| identity-access  | `WorkspaceInvitationIssuer`, `ConsultationAccessReader`, `AccountRetentionEligibilityRecorder` | Issue/revoke access, authorize a consultation, record retention evidence. |
| venue-catalog    | `VenueCatalogReader`                                                                           | Resolve active selections and exact historical versions.                  |
| payments-billing | `billing.payment-succeeded` v1                                                                 | Reconciliation input only; persisted payment evidence remains required.   |

This module emits the baseline `booking.timeline-review-requested`,
`booking.timeline-approved`, `booking.timeline-superseded`, `booking.deposit-eligible`,
`booking.expected-headcount-changed`, `booking.cancelled`, and `booking.completed` v1
events. An outbox saves each fact atomically with its state change. Payloads contain
only the baseline IDs/timestamps/revisions and no contact, token, or live catalog data.

## 5. Authorization and HTTP hand-off

Managers create consultations, availability, holds, bookings, cancellations, and
completion. Restricted prospects read and collaborate only on their consultation
proposal/timeline; full Couple accounts work only on their booking. Staff/public users
have no such mutation. Both Manager and Couple approvals bind to the exact revision.
Editing or superseding does not carry an approval forward.

Specified resources are `/management/consultations`, `/management/availability`,
`/bookings`, and `/bookings/{bookingId}/timeline-revisions`, with explicit action paths
for hold, approval, withdrawal, cancellation, and completion. All external writes use
strict Zod, expected revision, and `Idempotency-Key`. Stable errors include
`STALE_BOOKING_REVISION`, `INVALID_BOOKING_TRANSITION`, `TIMELINE_REVISION_SUPERSEDED`,
and concealed `BOOKING_NOT_FOUND` where existence must not be revealed.

Management Web owns consultation/availability/proposal administration. Web and Android
own their generated-contract views; the restricted workspace exists on Web only.
Android starts after `FULL` access and confirmed deposit. Neither client recalculates eligibility.

## 6. Concurrency, audit, and acceptance

- Database constraints serialize active-slot allocation; concurrent requests yield one
  winner and no partial booking.
- Approval compares exact revision; edit/approval races either preserve a valid old
  approval with a successor or return a stale conflict.
- Settlement compares eligibility/revision while persisting `paymentId`; callbacks may
  duplicate, reorder, or arrive after a client timeout safely.
- Audit creation, hold/release, edits, approvals, withdrawals, deposit recording,
  headcount changes, cancellation, completion, and protected denials with redacted data.

Acceptance proves ACC-001 and TML-001–008, immutable catalog snapshots, restricted/full
denials, slot/approval/deposit races, duplicate events, OpenAPI drift, and real identity
and venue integration. SPEC-02 V4 is accepted; implementation still requires this
module's bounded plan approval and applicable contract-artifact/provider gates.

## 7. Fixed decisions and provider hand-off

These implementation defaults are locked by project-owner SPEC approval on 2026-10-06.
Hold expiry may release a slot only when no unresolved deposit reservation pins it;
an UNKNOWN provider outcome does not become a free slot merely because time elapsed.

| Concern          | Contract                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slot identity    | Unique hall ID + eventDate + shiftCode; expired holds without unresolved deposit reservations release by database time inside allocation transaction.      |
| Hold             | 15 minutes; only one active hold per slot and one unresolved deposit reservation per booking.                                                              |
| Proposal         | Exact menu version, positive table count 1–500, planning count 0–10,000, hall/shift/menu/policy snapshots.                                                 |
| Commercial total | baseChargeVnd = tableCount × snapshotted menu per-table price; no tax/discount/add-on line in this initial slice. Checked safe-integer arithmetic.         |
| Deposit          | 30% of baseChargeVnd, rounded upward to whole VND; fixed in the commercial/policy revision, never a browser amount.                                        |
| Timeline         | 0–100 items while drafting; approval requires at least one; title 1–120, description 0–2,000; local HH:mm within snapshotted shift.                        |
| Revision         | Per-booking/timeline monotonically increasing safe integer plus immutable UUID; a canonical no-op save returns the same revision.                          |
| Cancellation     | Manager command before event starts with reason 1–500; Couple submits a request for Manager decision. Historical money remains for billing reconciliation. |
| Completion       | Confirmed event's snapshotted end + 12 hours; only Manager or allowlisted completion worker.                                                               |

Additive ports owned here are `BookingTimelineSnapshotReader`,
`BookingPlanningHeadcountSynchronizer`, `BookingDepositIntentCoordinator`,
`BookingAutomationPort`, `BookingCommercialSnapshotReader`, `BookingPlanningSnapshotReader`, and
`BookingReportingReader`, as defined in baseline Section 21. There is no downstream
payment/guest repository read. Payments passes persisted settlement evidence; guest
passes ordered aggregate plan evidence.

The source commercial revision is created when the latest proposal is accepted for
deposit. During a reserved/unresolved deposit attempt, price/slot/timeline edits and
withdrawals that would invalidate it fail with `DEPOSIT_INTENT_ACTIVE`. Real-provider
contract tests serialize eligibility/reservation versus edit, expiry, and settlement.
Exact settled-payment replay is checked before rejecting current phase `CONFIRMED`.

## 8. External command schemas and transitions

All listed schemas are strict; omitted optional properties preserve their prior value.
Output timestamps are ISO UTC strings; integers and UUIDs follow baseline conventions.

| Method/path                                                     | Request data                                                                                     | Result / authority                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| POST /management/consultations                                  | intendedEmail, displayName (1–120), optional note (0–2,000)                                      | 201 consultationId/revision; Manager only; invitation requested by separate command.                                                 |
| POST /management/consultations/{id}/workspace-invitations       | expectedRevision                                                                                 | 202 consultationId/invitation status; identity owns token/email. Failure leaves consultation and retry intent intact.                |
| GET /management/availability                                    | hallId, eventDate, shiftCode                                                                     | Slot availability/expiry only; Manager. Public current-slot availability may be read through a separately authorized proposal query. |
| POST /bookings                                                  | consultationId, hallId, eventDate, shiftCode, menuPackageVersionId, tableCount, expectedRevision | 201 bookingId/revision/safe snapshots; Manager.                                                                                      |
| POST /bookings/{id}/slot-holds                                  | expectedRevision                                                                                 | holdId/expiresAt/revision; Manager only.                                                                                             |
| GET /bookings/{id}/proposal                                     | no body                                                                                          | Safe proposal/timeline/access capabilities; Manager or own restricted/full grant.                                                    |
| POST /bookings/{id}/timeline-revisions                          | expectedRevision, predecessorRevisionId, items[{itemId?, order, startTime, title, description?}] | New exact timeline revision; Manager or own consultation collaborator.                                                               |
| POST /bookings/{id}/timeline-revisions/{revisionId}/approvals   | expectedRevision                                                                                 | Approval party is derived from actor; no submitted party/role; exact current revision only.                                          |
| POST /bookings/{id}/timeline-revisions/{revisionId}/withdrawals | expectedRevision, reason                                                                         | Pre-deposit own-party approval withdrawal; never withdraw effective post-deposit history.                                            |
| POST /bookings/{id}/change-requests                             | expectedRevision, replacement items, reason                                                      | Proposed post-deposit revision; previous effective content remains.                                                                  |
| POST /bookings/{id}/cancellation-requests                       | expectedRevision, reason                                                                         | Couple request only; does not cancel booking or refund.                                                                              |
| POST /management/bookings/{id}/cancellation                     | expectedRevision, reason                                                                         | Manager cancellation and audit; refuses active unresolved deposit reservation.                                                       |
| POST /management/bookings/{id}/completion                       | expectedRevision                                                                                 | Manager invokes same guarded completion domain command as automation.                                                                |

Moving to a successor before deposit resets both approval flags for that successor and
removes deposit eligibility even if an older revision was mutually approved. Booking
returns to proposal work until current mutual approval is restored. Post-deposit change
approval is separate: both parties must approve the same replacement, then an atomic
effective-pointer switch emits supersession. An approved revision is never edited.

## 9. Failures, events, and concurrency proof

| Failure                                               | Status | Observable result                                                                      |
| ----------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| SLOT_NOT_AVAILABLE / SLOT_HOLD_EXPIRED                | 409    | No allocation/revival; safe availability refresh.                                      |
| STALE_BOOKING_REVISION / TIMELINE_REVISION_SUPERSEDED | 409    | Current revision IDs only to an authorized caller.                                     |
| DEPOSIT_INTENT_ACTIVE                                 | 409    | Request cannot invalidate active/unknown payment intent.                               |
| HEADCOUNT_SOURCE_CONFLICT                             | 409    | Same sequence with different immutable evidence rejected.                              |
| TIMELINE_NOT_MUTUALLY_APPROVED / BOOKING_NOT_PAYABLE  | 409    | Eligibility reason, no payment effect.                                                 |
| BOOKING_NOT_FOUND                                     | 404    | Conceal unowned consultation/booking.                                                  |
| PROVIDER_UNAVAILABLE                                  | 503    | Command rolls back or records a retryable invitation intent; no partial access claims. |

Produced/consumed event names and minimum payloads are Section 4 and baseline Section 7.
Outbox insertion, state revision, audit, and reporting source sequence commit together.
Invitation-issuance reconciliation is keyed by consultation/request intent, not retry time.
A failed email does not create a duplicate consultation/account.

## 10. Parallel implementation matrix and proposed waves

| Slice                                         | Can implement against fakes                 | Real dependency / shared lane                                        |
| --------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| Slot/timeline/commercial rules and unit tests | Yes after contract/plan approval            | SPEC-02 V4 remains the start gate; persistence migration serialized. |
| Consultation/access/venue adapters            | Provider contracts already exist            | Real identity/venue before provider checkpoint.                      |
| Headcount/deposit/timeline/automation ports   | Own domain and conforming evidence fixtures | Shared booking serialization and outbox lane before PROVIDER_READY.  |
| Manager/Couple Web components                 | Local read-model fixtures                   | Network integration waits committed OpenAPI digest.                  |
| Booking acceptance                            | No                                          | Real identity/venue, PostgreSQL slot/edit/settlement races.          |

Proposed waves (maximum eight): consultation/proposal; slot persistence/holds;
timeline revision/approvals; deposit reservation/provider boundary; changes/cancellation/
completion; HTTP/OpenAPI; independent client adapters/screens; acceptance. Each wave
is sliced into at most five human-authored files per task and is planned after SPEC approval.

| Requirement      | Required focused evidence                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| ACC-001          | Consultation survives issue failure; retry creates one restricted invitation via real identity.  |
| TML-001/002      | Template-copy/empty draft, order/time/text bounds, CRUD and reorder.                             |
| TML-003/004      | No-op save, immutable predecessor, exact two-party approvals, stale edit race.                   |
| TML-005/006      | Current revision only; reserve/withdraw/edit race; server deposit amount.                        |
| TML-007/008      | Effective content retained, mutually approved replacement, immutable audit history.              |
| Shared contracts | Headcount sequence 10 then 9; duplicate settlement; due completion replays; report-page rebuild. |
