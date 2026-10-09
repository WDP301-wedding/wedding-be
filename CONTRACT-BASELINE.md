# Contract Baseline: Wedding Management Program

## 1. Document Status

- Status: **Locked and accepted**
- Baseline identifier: `WEDDING-CONTRACT-1`
- Baseline version: `1.1.0`
- Previous accepted version: `1.0.0` (historical approval retained)
- Prepared: 2026-10-06
- Approved and locked: 2026-10-06
- Amendment approval: project owner approved SPEC-03 through SPEC-11 and Section 21
  on 2026-10-06; module implementation plans and acceptance remain separate gates.
- Capability index: [`CAPABILITY-MAP.md`](./CAPABILITY-MAP.md)
- Product requirements: [`PRODUCT-REQUIREMENTS.md`](./PRODUCT-REQUIREMENTS.md)
- Platform contract: [`SPEC-core-platform.md`](./SPEC-core-platform.md)
- Governance rationale:
  [`ADR-002`](./docs/decisions/0002-freeze-program-contracts-before-parallel-specification.md)

This document is the accepted cross-module contract freeze for `SPEC-03` through
`SPEC-11`. Version `1.1.0` includes the accepted implementation hand-offs in Section 21;
Sections 2–20 retain the inherited 1.0.0 contract and historical approval evidence;
the accepted Section 21 governs the active version and additive hand-off changes.
A module plan starts only after that module's SPEC is approved;
plans for already approved SPECs may then overlap.
Provider-first review and approval order remain mandatory where one module defines
another module's meaning.

## 2. Objective

Give independently assigned module owners one stable program contract so they can
write compatible specifications and implementation plans without redefining shared
business concepts.

The baseline locks:

- authoritative module ownership;
- stable identifiers and reference direction;
- cross-module provider ports and integration events;
- state and snapshot semantics visible to other modules;
- authorization, money, privacy, audit, retry, and concurrency invariants;
- compatibility and change-control rules.

It deliberately does not lock screen layouts, internal class structure, every REST
path, deferred numeric limits, or implementation-wave sizing. Those remain in the
owning module specification provided they do not change this baseline.

## 3. Assumptions and Normative Hierarchy

### 3.1 Locked assumptions

1. The twelve module IDs and their product responsibilities remain unchanged.
2. `wedding-be` remains the only database and business-rule authority.
3. Existing approved contracts for `core-platform`, `identity-access`, and
   `venue-catalog` are inherited without breaking changes; implementation completion
   remains governed by each module's own acceptance checkpoint.
4. All later modules live in the same backend deployment and PostgreSQL database but
   communicate through owner-defined application contracts rather than cross-module
   repository access.
5. A frozen contract can be implemented later. Until its provider exists, consumers
   may use contract-conforming fakes in isolated tests but cannot claim integrated
   completion.
6. Baseline approval authorizes parallel specification and planning. It does not
   authorize unsafe parallel migrations, use of unfinished providers in production,
   or bypassing module acceptance gates.

### 3.2 Source hierarchy

When documents conflict, use this order and amend the lower document before work
continues:

1. approved `PRODUCT-REQUIREMENTS.md` and accepted cross-module ADRs;
2. this approved contract baseline;
3. `CAPABILITY-MAP.md` dependency direction;
4. approved provider module specification;
5. approved consumer module specification;
6. generated OpenAPI from implemented Zod schemas;
7. implementation details and client presentation.

The generated OpenAPI artifact is authoritative for an implemented external HTTP
surface. This baseline is authoritative for cross-module semantics that may exist
before every endpoint is implemented.

### 3.3 Applicability and the `SPEC-02` boundary

This governance change starts at `SPEC-03` (`booking-lifecycle`). It is not
retroactive:

- `core-platform` and `identity-access` remain completed approved providers;
- `SPEC-02` and the current `venue-catalog` implementation continue under their
  existing VC-01 through VC-23 tasks, V1 through V4 checkpoints, fast-track amendment,
  acceptance evidence, and final owner approval;
- this baseline does not add work to, reopen, replan, or weaken any `venue-catalog`
  checkpoint;
- baseline review and later-SPEC drafting may run while the remaining SPEC-02 work is
  finishing because the approved venue provider contract is inherited unchanged;
- `SPEC-03` may be drafted against that inherited contract, but it cannot receive
  implementation authorization until SPEC-02 reaches V4 and any discovered contract
  mismatch has been reconciled explicitly.

If finishing SPEC-02 reveals a breaking difference from its approved provider
contract, venue work pauses at its existing stop condition and this locked baseline is
amended through Section 14.3 before either side is approved. Ordinary implementation detail or additive
fields do not reopen the baseline.

## 4. Program-Wide Contract Conventions

- Resource IDs are UUIDs and never encode type, tenant, email, phone, or business
  meaning.
- Timestamps are UTC instants. Restaurant-local dates, shifts, deadlines, and display
  use `Asia/Ho_Chi_Minh` explicitly.
- Money is integer VND in application and API contracts and `Decimal(18,0)` in
  PostgreSQL. Floating-point money and client-computed authoritative totals are
  prohibited.
- Enums use `UPPER_SNAKE_CASE`; JSON and query fields use `camelCase`.
- External writes use strict schemas. Unknown fields are rejected unless a specific
  contract explicitly permits them.
- All HTTP errors use the existing
  `{ error: { code, message, details?, requestId } }` envelope.
- Cross-module calls return immutable snapshots or results. Consumers never mutate a
  provider-owned object or import a provider repository.
- Historical references use exact immutable version IDs or consumer-owned snapshots;
  they never silently resolve to a newer current version.
- Every state-changing command carries trusted actor/request context or explicit
  system causation. Caller-submitted roles, account IDs, totals, states, and ownership
  claims are not authority.
- State-changing commands document retry safety. Money, booking creation, print
  approval, arrival recording, refund recording, and notification dispatch require a
  durable idempotency strategy.
- Hard delete is prohibited for records that support authorization, payment,
  approval, attendance, printing, or audit history.

## 5. Ownership and Stable Reference Registry

Each concept has exactly one owner. A consumer may store the stable ID and an
immutable snapshot allowed by the owner; it does not copy the owner's state machine.

| Owner                      | Owned identifiers and authoritative facts                                                                                                                                                                | Permitted reference holders                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `identity-access`          | `accountId`, `sessionId`, `consultationAccessId`; account status, roles, session validity, `RESTRICTED`/`FULL` access                                                                                    | Every authenticated module                                            |
| `venue-catalog`            | `hallId`, `menuPackageId`, exact catalog version IDs, `timelineTemplateVersionId`, `layoutTemplateVersionId`, stable `layoutTableId`; catalog lifecycle and immutable versions                           | Booking, seating, analytics                                           |
| `booking-lifecycle`        | `consultationId`, `slotHoldId`, `bookingId`, `timelineId`, `timelineRevisionId`; event slot, booking phase, effective timeline, deposit eligibility, planning headcount                                  | Payments, invitation, guest, seating, staff, notifications, analytics |
| `payments-billing`         | `paymentId`, `paymentAttemptId`, `receivableChargeId`, `invoiceId`, `refundId`; monetary settlement and receivable status                                                                                | Booking, invitation, notifications, analytics                         |
| `invitation-studio`        | `mediaAssetId`, `invitationDesignId`, `invitationDesignRevisionId`, `publicInvitationId`, `printOrderId`, `printOrderLineId`, `printableRevisionId`; public invitation publication and print fulfillment | Guest, payments, notifications, analytics                             |
| `guest-rsvp`               | `guestGroupId`, `invitationHouseholdId`, `personalizedInvitationId`, `rsvpRevisionId`; household identity, group definition, RSVP and expected attendance                                                | Booking, seating, staff, notifications, analytics                     |
| `seating-plan`             | `seatingPlanId`, `seatingPlanRevisionId`; selected immutable layout version and table-level group labels                                                                                                 | Invitation, staff, analytics                                          |
| `staff-operations`         | `eventAssignmentId`, `arrivalId`, `attendanceCorrectionId`; assignment authority and actual attendance ledger                                                                                            | Analytics                                                             |
| `notifications-automation` | `notificationIntentId`, `deliveryAttemptId`; delivery preference, schedule, retry, and terminal delivery outcome                                                                                         | Operational views only                                                |
| `analytics-dashboard`      | Projection/checkpoint IDs only; derived read models and refresh state                                                                                                                                    | Management Web                                                        |
| `release-demo`             | Seed scenario and evidence IDs only                                                                                                                                                                      | Release verification                                                  |

`core-platform` owns infrastructure IDs such as `auditLogId` and
`idempotencyRecordId`; domain modules do not expose them as business identifiers.

The final column permits a module to retain an opaque ID or immutable snapshot; it
does not by itself reverse dependency direction. When an upstream provider accepts a
downstream-owned reference through an upstream-owned command port—for example booking
recording a `paymentId` or invitation studio registering a seating render snapshot—the
upstream module does not import or query the downstream repository.

## 6. Frozen Provider Contracts

The signatures below are semantic contracts. An owning SPEC may refine TypeScript
names or split one interface for cohesion, but it must preserve the inputs, outputs,
ownership, and failure meaning. All IDs are UUID strings and all returned values are
readonly.

### 6.1 Identity and access

The implemented identity interfaces remain authoritative:

- `AuthenticatedActorResolver` creates the actor from current database state.
- `ConsultationAccessReader.requireAccess` proves `RESTRICTED` or `FULL` access.
- `WorkspaceInvitationIssuer` issues, reissues, and revokes one consultation
  invitation without owning the consultation.
- `CoupleAccessPromoter.promote` moves the same account/consultation access to `FULL`
  using `sourcePaymentId`; replay is idempotent.
- `AccountRetentionEligibilityRecorder` accepts owner-supplied terminal-business
  evidence without letting consumers erase identity data directly.

No later module may add a generic role setter, accept access level from a client, or
create a replacement Couple account after deposit.

### 6.2 Venue catalog

The implemented `VenueCatalogReader` remains authoritative:

- active hall and shift snapshots for new booking decisions;
- current menu/timeline/layout versions for new selection;
- exact historical version resolution for already stored references.

Only `venue-catalog` owns mutable catalog records, version publication, lifecycle,
layout geometry, capacity ranges, and stable table identities. Consumer modules may
snapshot these facts but cannot patch them.

### 6.3 Booking lifecycle

`booking-lifecycle` must expose these provider capabilities:

```typescript
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

`requireDepositEligibility` is a current-state check, not a reusable authorization
token. `payments-billing` must call it again immediately before creating or settling a
deposit attempt. `recordSuccessfulDeposit` accepts only persisted payment evidence and
is idempotent by `paymentId`.

Timeline rules visible across modules are frozen:

- every substantive edit creates a new immutable `timelineRevisionId`;
- Manager and Couple approvals bind to the same exact revision;
- a successor carries no approval forward;
- before deposit, only the newest mutually approved current revision is eligible;
- after deposit, the effective revision remains valid until an approved replacement
  becomes effective.

### 6.4 Payments and billing

`payments-billing` must expose:

```typescript
interface BillingReader {
  requireDepositSettlement(bookingId: string): Promise<{
    paymentId: string;
    amountVnd: number;
    settledAt: Date;
  }>;

  getBookingReceivables(bookingId: string): Promise<{
    acceptedChargesVnd: number;
    paidVnd: number;
    refundedVnd: number;
    outstandingVnd: number;
  }>;
}

interface BookingChargeRegistrar {
  registerAcceptedCharge(input: {
    bookingId: string;
    sourceType: 'PRINT_ORDER';
    sourceRevisionId: string;
    amountVnd: number;
    acceptedAt: Date;
  }): Promise<{ receivableChargeId: string; replayed: boolean }>;
}
```

Money ownership is frozen:

- `payments-billing` alone owns payment attempts, provider callbacks, manual payment
  records, invoices, receivables, refunds, reconciliation, and monetary totals;
- deposit amount comes from the current booking eligibility result and is never
  supplied authoritatively by a client;
- a successful deposit is immutable settlement evidence even if later cancellation or
  refund changes net receivables;
- refunds are separate records and never rewrite the original payment;
- VNPay callback processing and every money command are idempotent and safe under
  duplicated, reordered, or delayed delivery;
- print charges enter receivables only through one immutable accepted commercial
  revision.

### 6.5 Invitation studio, media, public invitation, and print

`invitation-studio` must expose:

```typescript
interface InvitationPublicationReader {
  requirePublishedPublicInvitation(bookingId: string): Promise<{
    publicInvitationId: string;
    publicSlug: string;
    publishedRevisionId: string;
  }>;

  resolvePrintableRevision(printableRevisionId: string): Promise<{
    bookingId: string;
    designRevisionId: string;
    timelineRevisionId: string;
    seatingPlanRevisionId: string | null;
    publicInvitationId: string;
    contentDigest: string;
  }>;
}

interface PrintableSeatingContentRegistry {
  registerConfirmed(input: {
    bookingId: string;
    seatingPlanRevisionId: string;
    seatingPlanRevisionNumber: number;
    layoutTemplateVersionId: string;
    contentDigest: string;
    renderSnapshot: readonly {
      layoutTableId: string;
      tableLabel: string;
      shape: 'ROUND' | 'RECTANGLE';
      x: number;
      y: number;
      width: number;
      height: number;
      rotationDegrees: number;
      guestGroupId: string | null;
      guestGroupName: string | null;
      color: string | null;
    }[];
  }): Promise<{ registered: true; replayed: boolean }>;

  markRequiresReview(input: {
    bookingId: string;
    seatingPlanRevisionId: string;
    seatingPlanRevisionNumber: number;
    reasonCode: 'HEADCOUNT_OUTSIDE_LAYOUT_RANGE' | 'LAYOUT_RETIRED';
  }): Promise<{ invalidated: true; replayed: boolean }>;
}
```

Media access requires `FULL` consultation access and a confirmed deposit. Private
media object keys never cross into public invitation output.

The print-order state vocabulary is frozen as:

```text
REQUESTED -> QUOTED -> APPROVED -> IN_PRODUCTION -> READY_FOR_HANDOVER -> HANDED_OVER
     |          |          |
     +----------+----------+----------------------------------------------> CANCELLED
```

The owning SPEC defines authorized actors and cancellation deadlines. It may not skip
quotation, Couple approval, or immutable printable/commercial revision capture.

Approval of a quotation must atomically bind each line to an immutable
`printableRevisionId` and one immutable commercial revision. The order becomes
`APPROVED` only after `BookingChargeRegistrar` accepts the exact commercial revision,
or after durable reconciliation state proves that the charge registration will be
completed without creating a duplicate.

`invitation-studio` does not query seating repositories or depend on a live seating
read during approval. `seating-plan`, which is already downstream of invitation
capabilities, registers its confirmed immutable render snapshot through the
invitation-owned `PrintableSeatingContentRegistry`. It also invalidates eligibility
when that plan requires review. Print approval uses the highest eligible registered
revision, never merely the last message received.

A print design that includes seating content cannot be approved without an eligible
registered seating snapshot. A design that does not contain a seating section records
`seatingPlanRevisionId: null` explicitly. This keeps dependency direction acyclic
while satisfying printable snapshot requirements.

The generic public invitation identifier is opaque and unguessable but never proves
guest identity, RSVP authority, group membership, or check-in authority.

### 6.6 Guest RSVP

`guest-rsvp` must expose:

```typescript
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

One household represents one invitation party. Companion names are not required.
Guest-group IDs are stable and are never replaced by names or colors in references.
Archival preserves historical meaning. Personalized invitation credentials are
separate from the generic public invitation ID and grant only their documented RSVP
capability.

When the expected-attendance total changes, `guest-rsvp` calls the booking-owned
`BookingPlanningHeadcountUpdater`; it does not mutate booking tables directly.

### 6.7 Seating plan

`seating-plan` must expose:

```typescript
interface SeatingPlanReader {
  requireCurrentPlan(bookingId: string): Promise<{
    seatingPlanId: string;
    revisionId: string;
    status: 'DRAFT' | 'CONFIRMED' | 'REQUIRES_REVIEW';
    layoutTemplateVersionId: string;
    expectedAttendees: number;
    labels: readonly {
      layoutTableId: string;
      guestGroupId: string;
      colorSnapshot: string;
    }[];
  }>;

  resolveRevision(revisionId: string): Promise<{
    bookingId: string;
    layoutTemplateVersionId: string;
    labels: readonly {
      layoutTableId: string;
      guestGroupId: string;
      colorSnapshot: string;
    }[];
  }>;
}
```

The plan stores exact layout-version and stable table IDs. It stores table-level group
labels only—never household, person, seat, or movable geometry assignments. A
headcount outside the selected layout range changes a confirmed plan to
`REQUIRES_REVIEW`; it does not delete the plan or its group definitions. Only a
compatible replacement or an audited Manager exception can reconfirm it.

On confirmation, seating resolves the exact layout version, builds an immutable safe
render snapshot, and calls the invitation-owned `PrintableSeatingContentRegistry`.
Registration is idempotent by `seatingPlanRevisionId`; reusing that ID with a different
digest is a conflict. An out-of-range headcount or retired layout calls
`markRequiresReview`. Revision numbers prevent delayed calls from making an older
snapshot eligible again. Later seating revisions never mutate a previously approved
printable revision.

### 6.8 Staff operations and attendance

`staff-operations` owns event assignments and an append-only attendance ledger:

```typescript
interface AttendanceReader {
  getHouseholdAttendance(invitationHouseholdId: string): Promise<{
    expectedAttendees: number;
    actualAttendees: number;
    hasOverExpectedWarning: boolean;
  }>;

  getBookingAttendance(bookingId: string): Promise<{
    actualAttendees: number;
    byGuestGroup: readonly {
      guestGroupId: string;
      actualAttendees: number;
    }[];
  }>;
}
```

Each arrival is a positive append record with household, event time, acting Staff,
and count. Corrections are append records that reference prior evidence; they do not
overwrite or delete it. Actual attendance is the sum of effective arrivals and
corrections. Exceeding expected attendance returns a warning and succeeds.

Staff authorization requires both the current `STAFF` or `MANAGER` role and a current
event assignment or explicit Manager override. Guest search returns only the minimum
operational fields documented in the guest provider contract.

### 6.9 Notifications and automation

`notifications-automation` consumes durable integration events and owns delivery,
schedule, preference, retry, and dead-letter state. It never becomes the source of
booking, payment, print, RSVP, or attendance truth.

Delivery deduplication key is `(eventId, channel, recipientId, templateVersion)`.
Retries reuse the same notification intent. A provider timeout is an unknown outcome
requiring reconciliation; it is not permission to create a second intent.

Notification payloads contain references and purpose-specific render data only. They
must not contain raw credentials, private image attachments, full guest lists, payment
secrets, or unnecessary contact data.

### 6.10 Analytics and release

`analytics-dashboard` is read-only over provider-approved projections or queries. It
does not write domain state, infer per-seat occupancy, count draft print quotations as
receivables, or replace provider definitions with dashboard-specific calculations.

`release-demo` owns no business state. It composes approved public contracts, seed
scenarios, deployment configuration, rollback evidence, monitoring, and the demo
script.

## 7. Integration Event Contract

### 7.1 Envelope

Every durable cross-module event uses this logical envelope:

```typescript
interface IntegrationEvent<TPayload> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  producerModule: string;
  aggregateType: string;
  aggregateId: string;
  correlationId: string;
  causationId: string | null;
  payload: TPayload;
}
```

- `eventId` is globally unique and stable across delivery retries.
- `eventType + eventVersion` identifies the payload schema.
- Events describe completed facts in past tense; they are not commands.
- Producers persist the business change and durable event record in one database
  transaction or provide equivalent recoverable evidence.
- Consumers are idempotent by `(consumer, eventId)` and tolerate duplicates.
- Ordering is guaranteed only per aggregate. Consumers compare owner-provided revision
  or sequence fields and tolerate delayed older events.
- Event payloads use stable IDs and minimum snapshots. They exclude tokens, signed
  URLs, phone numbers, raw operational notes, and private media.

### 7.2 Frozen event registry

The listed name and minimum payload are stable. Provider SPECs may add optional fields
or new event types without changing existing meaning.

| Event type                                 | Producer            | Minimum payload                                                                                |
| ------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------- |
| `identity.consultation-access-promoted` v1 | `identity-access`   | `accountId`, `consultationId`, `sourcePaymentId`, `promotedAt`                                 |
| `booking.timeline-review-requested` v1     | `booking-lifecycle` | `bookingId`, `timelineRevisionId`, `requestedBy`, `requestedAt`                                |
| `booking.timeline-approved` v1             | `booking-lifecycle` | `bookingId`, `timelineRevisionId`, `party`, `approvedAt`                                       |
| `booking.timeline-superseded` v1           | `booking-lifecycle` | `bookingId`, `timelineRevisionId`, `successorRevisionId`, `supersededAt`                       |
| `booking.deposit-eligible` v1              | `booking-lifecycle` | `bookingId`, `timelineRevisionId`, `bookingRevision`, `eligibleAt`                             |
| `booking.expected-headcount-changed` v1    | `booking-lifecycle` | `bookingId`, `planningHeadcount`, `bookingRevision`, `changedAt`                               |
| `booking.cancelled` v1                     | `booking-lifecycle` | `bookingId`, `cancelledAt`, `reasonCode`                                                       |
| `booking.completed` v1                     | `booking-lifecycle` | `bookingId`, `completedAt`                                                                     |
| `billing.payment-succeeded` v1             | `payments-billing`  | `bookingId`, `paymentId`, `purpose`, `amountVnd`, `settledAt`                                  |
| `billing.receivable-charge-accepted` v1    | `payments-billing`  | `bookingId`, `receivableChargeId`, `sourceType`, `sourceRevisionId`, `amountVnd`, `acceptedAt` |
| `billing.refund-recorded` v1               | `payments-billing`  | `bookingId`, `refundId`, `sourcePaymentId`, `amountVnd`, `recordedAt`                          |
| `invitation.publication-changed` v1        | `invitation-studio` | `bookingId`, `publicInvitationId`, `publishedRevisionId`, `changedAt`                          |
| `invitation.print-quotation-issued` v1     | `invitation-studio` | `bookingId`, `printOrderId`, `commercialRevisionId`, `quotedAt`, `expiresAt`                   |
| `invitation.print-order-approved` v1       | `invitation-studio` | `bookingId`, `printOrderId`, `commercialRevisionId`, `receivableChargeId`, `approvedAt`        |
| `invitation.print-order-ready` v1          | `invitation-studio` | `bookingId`, `printOrderId`, `readyAt`                                                         |
| `guest.rsvp-updated` v1                    | `guest-rsvp`        | `bookingId`, `invitationHouseholdId`, `rsvpRevisionId`, `expectedAttendees`, `updatedAt`       |
| `guest.expected-attendance-changed` v1     | `guest-rsvp`        | `bookingId`, `sourceRsvpRevisionId`, `expectedAttendees`, `changedAt`                          |
| `seating.plan-confirmed` v1                | `seating-plan`      | `bookingId`, `seatingPlanRevisionId`, `layoutTemplateVersionId`, `confirmedAt`                 |
| `seating.plan-requires-review` v1          | `seating-plan`      | `bookingId`, `seatingPlanRevisionId`, `reasonCode`, `changedAt`                                |
| `attendance.arrival-recorded` v1           | `staff-operations`  | `bookingId`, `invitationHouseholdId`, `arrivalId`, `attendeeCount`, `recordedAt`               |
| `attendance.correction-recorded` v1        | `staff-operations`  | `bookingId`, `invitationHouseholdId`, `attendanceCorrectionId`, `delta`, `recordedAt`          |

Notification delivery events and analytics refresh events are operational and may be
defined by their modules; they must not be consumed as authoritative business facts.

## 8. Frozen Cross-Module Flows

### 8.1 Consultation and restricted workspace

1. `booking-lifecycle` creates the consultation and persists its owner-facing state.
2. It calls identity's `WorkspaceInvitationIssuer` with the opaque
   `consultationId` and intended email.
3. Identity acceptance creates/reuses the account and `RESTRICTED` access.
4. Booking authorizes proposal/timeline operations using current actor plus
   `ConsultationAccessReader`.

Identity never queries booking tables, and booking never stores invitation tokens or
password state.

### 8.2 Deposit and access promotion

1. Client requests a deposit intent using `bookingId` and exact
   `timelineRevisionId`; it does not send an authoritative amount.
2. Payments calls `requireDepositEligibility` immediately before the money operation.
3. Payments persists the attempt before contacting VNPay or recording a manual
   payment.
4. On proven settlement, payments idempotently calls `BookingDepositRecorder` and
   `CoupleAccessPromoter` using the same `paymentId`.
5. Durable reconciliation records incomplete downstream applications and retries
   them without creating another payment.

No client success page, redirect, or callback body alone can confirm a booking or
promote access.

### 8.3 Post-deposit capability gate

Media, invitation editing/delivery, guest management, seating, print ordering, and
Couple App workflows require both current `FULL` consultation access and a confirmed
booking/deposit fact from the owning provider. Clients may hide unavailable controls,
but every backend module repeats the provider-backed authorization check.

### 8.4 Print approval and receivables

1. Invitation studio owns quotation and printable/commercial revisions.
2. Couple approval identifies the exact current quotation revision.
3. Invitation studio freezes every printable line and calls
   `BookingChargeRegistrar` with the commercial revision and server-computed total.
4. The print order records the returned `receivableChargeId` before becoming
   `APPROVED`.
5. Later content or price changes create a new revision and renewed approval; they do
   not mutate the accepted charge or prior printable snapshot.

If seating content is included, invitation studio uses the immutable render snapshot
previously registered by `seating-plan`; it never calls back into seating during print
approval.

### 8.5 Guest headcount and seating validity

1. Guest RSVP owns households, groups, RSVP revisions, and expected-attendance sum.
2. It reports a new expected total through `BookingPlanningHeadcountUpdater`.
3. Booking records a new revision and publishes the headcount-change fact.
4. Seating compares the new planning headcount with the selected immutable layout
   range and changes an incompatible confirmed plan to `REQUIRES_REVIEW`.
5. Existing labels and group IDs remain visible until remapped or reconfirmed.

### 8.6 Attendance and reporting

1. Staff operations verifies assignment and reads the minimum household/group data
   from guest RSVP.
2. It appends arrivals and corrections; over-expected counts warn but succeed.
3. Analytics reads provider-approved attendance totals grouped by stable household and
   guest-group IDs.
4. No module derives exact table/seat occupancy from group labels or arrivals.

## 9. Snapshot and Historical Integrity Rules

- Booking stores exact catalog version IDs and owned commercial/display snapshots for
  hall, shift, menu, policy, and proposal facts that must survive later catalog edits.
- A booking timeline copies template items and thereafter owns every immutable
  timeline revision.
- Seating stores one exact `layoutTemplateVersionId` and stable `layoutTableId`
  references. It resolves that exact catalog version when creating a confirmed render
  snapshot; it never uses mutable current geometry by lookup at print time.
- A printable revision freezes design content, effective timeline content, selected
  seating content, generic public invitation reference, and the accepted commercial
  revision used for the print line.
- Analytics uses historical provider snapshots/revisions when current names, prices,
  or geometry would change the meaning of past data.
- A provider may retire an aggregate from new selection but must preserve exact
  historical resolution while any consumer reference exists.

## 10. Authorization and Data-Minimization Matrix

| Surface                               | Public/guest                 | Restricted prospect               | Full Couple                    | Staff                             | Manager                          |
| ------------------------------------- | ---------------------------- | --------------------------------- | ------------------------------ | --------------------------------- | -------------------------------- |
| Public catalog and generic invitation | Approved public fields       | Same                              | Same                           | Same                              | Same                             |
| Consultation proposal/timeline        | No                           | Own consultation only             | Own booking                    | Assigned operational view only    | Authorized management            |
| Private wedding media                 | No                           | No                                | Own confirmed booking          | Only if explicitly required       | Authorized restaurant use        |
| Guest households/RSVP                 | Personalized-link scope only | No                                | Own confirmed booking          | Assigned minimum operational view | Authorized management            |
| Seating plan                          | No                           | No                                | Own confirmed booking          | Assigned guidance view            | Authorized management/exception  |
| Payment/billing                       | No                           | Deposit action only when eligible | Own booking                    | No                                | Authorized recording/refund view |
| Event check-in                        | No                           | No                                | Read-only summary if specified | Assigned event                    | Authorized override              |
| Analytics                             | No                           | No                                | No unless later approved       | No unless later approved          | Manager only                     |

Public and guest-link responses never include private media, phone numbers, full guest
lists, operational notes, payment details, internal IDs not needed by the action, or
audit metadata.

## 11. Concurrency, Idempotency, and Failure Semantics

- Timeline edit versus approval is resolved by exact revision and compare-and-swap;
  approval of a superseded revision fails.
- Deposit eligibility and settlement use current booking revision plus durable payment
  intent; stale eligibility cannot charge or confirm the booking.
- Slot holds use database-enforced exclusivity and explicit expiry. An expired hold
  cannot be revived by a retry.
- Payment/provider callbacks are verified, stored, and deduplicated before effects are
  applied. Unknown outcomes reconcile; they are not blindly retried.
- Print quotation approval uses exact commercial revision and server total. Concurrent
  requote versus approval yields one winner and no mixed snapshot.
- RSVP/headcount updates use revision ordering; delayed events cannot restore an older
  headcount.
- Arrival recording is append-only and idempotent by user intent. Concurrent arrivals
  both count exactly once.
- Notification delivery is at-least-once with durable deduplication; no contract
  assumes exactly-once transport.

Every conflict uses a stable machine code and preserves enough current revision/state
detail for an authorized client to refresh safely without leaking protected data.

## 12. External HTTP and Client Contract Rules

- Owner modules define Zod request/response schemas and register them in backend
  OpenAPI; consumers never hand-write parallel API types.
- A new external path is not frozen merely because it appears in a draft SPEC. It
  becomes implemented contract when its Zod schema, runtime route, tests, generated
  OpenAPI artifact, and digest land together.
- New fields are additive and optional for existing consumers. Removal, renaming,
  narrowing, changed nullability, changed enum meaning, or changed error semantics is
  breaking.
- Client repositories pin an immutable backend commit and OpenAPI digest before using
  a contract.
- Provider fakes used before implementation must be generated or reviewed against this
  baseline and replaced by integration evidence at the provider checkpoint.

## 13. Parallel Specification and Implementation Rules

Parallelism is an optimization inside the dependency graph, not a requirement. A team
may keep any group sequential when staffing, review capacity, migration overlap, or
risk makes that safer.

### 13.1 Four distinct gates

Do not treat “someone is writing the downstream SPEC” as “the downstream module is
ready to implement.” Each module crosses four separate gates:

1. **SPEC draft gate:** the owner may write questions, local behavior, acceptance
   criteria, and planned test cases against the approved baseline and frozen upstream
   contract.
2. **Contract approval gate:** upstream provider semantics are reviewed first; the
   consumer then confirms exact inputs, outputs, states, events, failures, and
   compatibility. A downstream SPEC cannot be finally approved while its provider
   contract is disputed.
3. **Plan/task gate:** only after that SPEC is approved may its owner write the module
   plan and executable task slices. Plans for separate approved SPECs may be prepared
   concurrently.
4. **Implementation/integration gate:** implementation may use fakes after contract
   and plan approval, but final integration and acceptance require the real provider,
   migrations, and contract tests.

Every SPEC declares `contractBaseline: WEDDING-CONTRACT-1@1.0.0` and lists the
provider interfaces/events it consumes and produces. Consumers submit change requests
to the provider owner rather than forking a state, event, ID, amount, ownership rule,
or error meaning.

### 13.2 Specification review groups and required order

All groups may collect questions early. Final contract review follows this DAG:

```text
SPEC-02 venue-catalog acceptance (unchanged)
                    |
                    v
SPEC-03 booking-lifecycle
                    |
                    v
SPEC-04 payments-billing
                    |
                    v
SPEC-05 invitation-studio
                    |
                    v
SPEC-06 guest-rsvp
     |                                 |
     +-> SPEC-07 seating-plan          +-> SPEC-09 notifications-automation
             |
             v
         SPEC-08 staff-operations
             |
             v
         SPEC-10 analytics-dashboard
             |                                 |
             +---------------+-----------------+
                             v
                  SPEC-11 release-demo
```

| Group                     | Modules                           | What may overlap                                                                                         | What remains sequential                                                                                                                   |
| ------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| A — Commercial core       | SPEC-03 booking, SPEC-04 payments | Both owners may draft together and jointly design/review deposit-boundary tests                          | Booking contract approval precedes payment contract approval; payment integration waits for booking eligibility/recording providers       |
| B — Invitation and guests | SPEC-05 invitation, SPEC-06 guest | Guest workflows and personalized-link test plans may be drafted against frozen invitation contracts      | Payment charge contract precedes print approval; invitation publication contract precedes guest SPEC approval                             |
| C — Event planning        | SPEC-07 seating, SPEC-08 staff    | Staff search/check-in UX and test planning may start against frozen guest/seating contracts              | Seating approval precedes staff approval; real staff integration waits for booking, guest, and seating providers                          |
| D — Automation            | SPEC-09 notifications             | Channel/provider work may start while seating/staff proceed because notifications do not own their state | Each notification handler waits for its producer event contract; full acceptance waits for every required producer through SPEC-06        |
| E — Reporting             | SPEC-10 analytics                 | Metric definitions and read-model prototypes may start early                                             | Final metric contract waits for payment, invitation, guest, seating, and staff definitions; actual attendance reporting waits for SPEC-08 |
| F — Release               | SPEC-11 release                   | Deployment scaffolding and non-domain checklist drafting may start early                                 | Final release plan, seed journey, rollback, and acceptance wait for SPEC-03 through SPEC-10                                               |

SPEC-09 and the SPEC-07 → SPEC-08 chain are the main safe parallel branches after
SPEC-06. SPEC-10 does not depend on notification delivery, so it may overlap SPEC-09
after SPEC-08 is frozen. SPEC-11 joins both branches and remains last.

### 13.3 Implementation dependency waves

Implementation is more constrained than specification:

1. **Finish SPEC-02 normally.** Venue catalog reaches V4 without baseline-driven
   replanning.
2. **Booking foundation first.** Persist consultation/booking/timeline state, publish
   `BookingLifecycleReader`, `BookingDepositRecorder`, and concurrency tests.
3. **Payments after booking provider stability.** Pure payment domain, VNPay adapter,
   and callback idempotency may overlap remaining booking client work; deposit
   integration and acceptance require the real booking provider.
4. **Invitation after access/payment boundaries.** Media/design work can overlap late
   payment work once confirmed-booking and charge-registration contracts pass; print
   approval waits for real billing integration.
5. **Guest after invitation publication stability.** Household/group persistence may
   begin with fakes, but personalized links and acceptance use the real public
   invitation contract.
6. **Branch after guest stability.** Seating implementation proceeds toward staff;
   notification infrastructure and already-available event handlers may proceed in
   parallel.
7. **Staff after seating.** Search/check-in requires real booking assignment context,
   household/group reads, and seating guidance.
8. **Analytics after each source is real.** Individual projections may be built as
   providers stabilize; complete analytics acceptance waits for payments, print,
   guest, seating, and staff attendance.
9. **Release last.** End-to-end seed, deployment, rollback, monitoring, and demo
   evidence use accepted real implementations.

Within a wave, work may proceed concurrently only when files/worktrees do not overlap.
All Prisma migrations remain serialized and rebased in one backend migration lane.
Unavailable providers may be represented by contract-conforming fakes, but money
settlement, access promotion, immutable snapshot creation, migration ordering, and
end-to-end acceptance never rely solely on mocks.

## 14. Compatibility and Change Control

### 14.1 Compatible changes

- Add an optional field with a documented default/absence meaning.
- Add a new query/read-model method without changing existing semantics.
- Add a new event type or a higher event version while retaining required old-version
  handling through the agreed migration window.
- Tighten an internal implementation without changing observable results.

### 14.2 Breaking changes

- Move ownership or reverse a dependency.
- Rename/remove an identifier, state, event, required field, or error code.
- Change money units, timestamp interpretation, cardinality, nullability, retry safety,
  authorization meaning, snapshot meaning, or terminal-state meaning.
- Reuse an existing event type/version for a different payload or fact.
- Change an immutable historical reference into a current/live lookup.

### 14.3 Required change procedure

1. Open a baseline change proposal naming affected providers and consumers.
2. Update this document first with a compatibility and migration analysis.
3. Obtain project-owner approval for any breaking or ownership change.
4. Increment baseline major for breaking changes, minor for additive contracts, or
   patch for clarification with no observable semantic change.
5. Update provider SPEC, consumer SPECs, contract tests, and OpenAPI where applicable.
6. Land provider implementation before consumers rely on the new version.

There is one active baseline version. Parallel teams do not maintain competing
contract branches as long-lived alternatives.

## 15. Project Structure and Contract Location

```text
wedding-be/
├── CONTRACT-BASELINE.md
├── SPEC-<module-id>.md
├── docs/decisions/
├── src/core/
│   └── integration-events/        # envelope/outbox mechanics when implemented
└── src/modules/<owner>/
    ├── application/
    │   ├── <module>.provider.ts   # provider-owned cross-module interfaces
    │   └── <module>.events.ts     # provider-owned event schemas
    └── ...
```

There is no fifth shared-types repository. Client contracts remain generated from
OpenAPI. Backend consumers import only public provider/application contracts, never a
provider's infrastructure repository or ORM model.

## 16. Testing Strategy

Every provider/consumer pair requires:

- provider contract tests for every method, result variant, stable error, and event
  schema;
- consumer tests using a conforming fake for success, denial, conflict, stale revision,
  duplicate, timeout/unknown outcome, and unavailable provider where applicable;
- one real integration test before consumer acceptance;
- mutation-sensitive authorization and invariant tests for deposit eligibility,
  access promotion, print charge registration, seating invalidation, and attendance;
- PostgreSQL concurrency tests for slot safety, approval/edit races, payment callback
  duplication, print quote/approval races, and simultaneous arrivals;
- OpenAPI drift checks in every affected client repository.

Cross-module acceptance must prove at least the ten scenarios in
`PRODUCT-REQUIREMENTS.md` Section 9 plus event duplicate and out-of-order handling.

## 17. Commands and Verification

Documentation freeze checks:

```powershell
npx prettier --check CONTRACT-BASELINE.md docs/decisions/0002-freeze-program-contracts-before-parallel-specification.md
git diff --check
```

Implemented provider checkpoints use the existing repository commands:

```powershell
npm run lint
npm run typecheck
npm run test:coverage
npm run test:integration -- --maxWorkers=1
npm run test:contract
npm run api:generate
npm run api:check
npm run build
```

Client consumers additionally run their own immutable `api:check`, tests, and build.

## 18. Boundaries

### Always

- Name one authoritative provider for every fact and state transition.
- Store exact revision/version IDs at approval and commercial boundaries.
- Recheck authorization and state in the backend at the point of mutation.
- Keep event and command handling idempotent under duplicate delivery.
- Preserve audit and historical evidence with bounded PII.
- Update this baseline before approving a conflicting module SPEC.

### Ask the project owner first

- Change module ownership or dependency direction.
- Change a frozen enum/state/event meaning or cross-module identifier.
- Add a new money collection step, automatic refund, or external processor.
- Weaken pre-deposit, private-media, guest-data, layout, print, or check-in boundaries.
- Permit a breaking contract change or destructive migration.

### Never

- Let a consumer query or mutate another module's repository directly.
- Treat client state, hidden controls, redirects, QR possession, or event delivery as
  authorization or payment proof.
- Duplicate identities, payment truth, guest groups, layout geometry, attendance, or
  receivable totals in a consumer module.
- Use a current live record where an approved immutable snapshot is required.
- Put secrets, raw tokens, signed URLs, private image data, full guest lists, or
  unnecessary PII into events, logs, audit metadata, or public responses.

## 19. Approval Record and Success Criteria

The project owner approved and locked `WEDDING-CONTRACT-1@1.0.0` on 2026-10-06. That
approval confirms all of the following:

- module ownership and dependency direction are correct;
- every stable identifier has exactly one owner;
- the `SPEC-03`/`SPEC-04` deposit and promotion flow is accepted;
- invitation print approval and billing charge registration have one immutable
  commercial boundary;
- guest headcount, seating invalidation, attendance, notification, and analytics
  flows do not introduce dependency cycles;
- the event envelope, minimum event registry, compatibility rules, and serialized
  migration lane are accepted;
- no blocking open question remains for controlled parallel specification.

The approval is effective for `SPEC-03` through `SPEC-11`. `SPEC-02` continues under
its previously approved plan and must still reach V4 before `SPEC-03` implementation
is authorized. `CAPABILITY-MAP.md`, `tasks/plan.md`, and `tasks/todo.md` record the
accepted coordination model. Any later semantic change follows Section 14.3 and
receives a new baseline version; it must not be edited into `1.0.0` silently.

## 20. Non-Blocking Details Deferred to Owning Specifications

- full internal booking, payment, RSVP, seating, notification, and analytics state
  machines beyond the cross-module states named here;
- endpoint path inventory that does not change provider semantics;
- workspace invitation, media, reminder, quotation, cancellation, search, and
  fulfillment numeric limits already assigned to owning SPECs;
- VNPay sandbox request/response fields and signature mechanics;
- final notification channels, templates, user preferences, and scheduling cadence;
- analytics query shape, refresh interval, and chart presentation;
- deployment hosts, Android artifact details, and release rollback timing.

## 21. Accepted Amendment 1.1.0: Implementation Hand-off Contracts

Status: **Accepted by the project owner on 2026-10-06**. Prepared in response to the
request to make SPEC-03 through SPEC-11 implementable by different team members.
Approval evidence: the owner replied, “vậy tôi duyệt draft trên”, after reviewing the
revised nine SPECs, the hand-off rules and the three-person ownership split.
Version 1.1.0 is now active; 1.0.0 remains inherited historical contract evidence.
This is specification/contract approval, not module-plan approval, provider readiness,
implementation acceptance or deployment authority.

This amendment adds ports and clarifies execution readiness. It preserves the existing
method signatures, identifiers, enums, ownership, event names, and error envelope.
Owners publish these declarations under their existing application boundary; the
declarations below are documentation, not already implemented services. Provider-first
review and each module's SPEC/plan approval still precede implementation. After those
gates, isolated implementation may overlap an unfinished upstream implementation using
a conforming fake. Production wiring and integrated acceptance require real providers.

### 21.1 Common command and reporting types

```typescript
type ContractContext = Readonly<{
  requestId: string;
  causationId: string;
  actorAccountId: string | null;
  authority: 'AUTHENTICATED' | 'SYSTEM';
  transactionScopeId?: string;
}>;

type SourceQuery = Readonly<{
  afterSequence: number;
  throughSequence?: number;
  cursor?: string;
  limit: number;
}>;

type SourceRow<T> = Readonly<{
  recordId: string;
  sequence: number;
  changedAt: string;
  value: T;
}>;

type SourcePage<T> = Readonly<{
  throughSequence: number;
  nextCursor: string | null;
  rows: readonly SourceRow<T>[];
}>;
```

Context is constructed by the backend after authentication or by an allowlisted worker.
It is never accepted as authority from an HTTP body. An authenticated context requires
a non-null active account; system context requires an allowlisted command purpose.
Consumers authorize their own actor/resource boundary before invoking a port. Provider
commands validate ownership, state, and supplied evidence again. Failures use the
existing error envelope at HTTP boundaries, with stable codes specified in owning SPECs.

For source pages, callers supply limit (standard page size 100, maximum 500). Sequence is a monotonically
increasing safe integer allocated transactionally by the owner for every committed
reportable change. The first page fixes `throughSequence`; all later pages use that
same fence. Providers return historical row values as of that fence, ordered by sequence
then record ID. Cursors bind query/fence and cannot skip records under concurrent writes.
Rows are absolute snapshots, not add/subtract instructions. A projection upserts by
record ID and rejects a lower sequence. An archived/cancelled resource remains as a row
with its terminal state; it is never silently omitted. Rebuild uses afterSequence zero,
then catches up after the fence. Each provider has its own sequence; numbers from
different owners are never compared.

### 21.2 Ordered headcount and approved timeline reads

The original `BookingPlanningHeadcountUpdater` remains unchanged and is usable only
in a serialized owner-controlled path. Concurrent guest-plan synchronization uses the
new port:

```typescript
interface BookingPlanningHeadcountSynchronizer {
  synchronize(
    input: Readonly<{
      bookingId: string;
      sourceRsvpRevisionId: string;
      sourceSequence: number;
      expectedAttendees: number;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      bookingRevision: number;
      appliedSourceSequence: number;
      outcome: 'APPLIED' | 'REPLAYED' | 'IGNORED_STALE';
    }>
  >;
}

interface GuestAttendancePlanReader {
  getPlan(
    bookingId: string,
    context: ContractContext,
  ): Promise<
    Readonly<{
      sourceRsvpRevisionId: string;
      sourceSequence: number;
      expectedAttendees: number;
      rsvpDeadlineAt: string;
    }>
  >;
}

interface BookingTimelineSnapshotReader {
  resolveApprovedRevision(
    input: Readonly<{
      bookingId: string;
      timelineRevisionId: string;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      bookingId: string;
      timelineRevisionId: string;
      revisionNumber: number;
      eventDate: string;
      hallName: string;
      shiftCode: 'LUNCH' | 'DINNER';
      shiftStartTime: string;
      shiftEndTime: string;
      items: readonly Readonly<{
        itemId: string;
        order: number;
        startTime: string;
        title: string;
        description: string | null;
      }>[];
      approvedByManagerAt: string;
      approvedByCoupleAt: string;
      isEffective: boolean;
    }>
  >;
}
```

Guest owns a per-booking attendance-plan sequence and immutable aggregate plan revision.
Every household create/update/archive and RSVP change that changes the planning total
creates a new aggregate revision; the field name `sourceRsvpRevisionId` retains
baseline compatibility. It is not the UUID of one arbitrary household's latest response.
Higher source sequence applies by CAS; same sequence/ID/count replays; same sequence with
different ID/count is `HEADCOUNT_SOURCE_CONFLICT`; lower sequence is a successful
`IGNORED_STALE` acknowledgement. Integrated guest-plan activation and booking
synchronization share the booking unit-of-work. The atomic outbox carries the same
source revision for replay/reconciliation, not a second independently activated plan.

`guest.expected-attendance-changed` v1 gains optional `sourceSequence` and new
publishers always include it. A legacy event without it causes an authoritative
`getPlan` read rather than comparison of UUIDs or timestamps. Booking's existing
headcount event retains `bookingRevision` for seating ordering.

Timeline reads resolve a stored exact revision, never current catalog content. Historical
approved revisions remain readable; print approval requires `isEffective: true`.
Changing the effective revision and capturing a printable snapshot use a serialized
booking/print boundary so the snapshot cannot mix two revisions.

### 21.3 Deposit reservation and automation command ports

```typescript
interface BookingDepositIntentCoordinator {
  reserve(
    input: Readonly<{
      bookingId: string;
      timelineRevisionId: string;
      paymentAttemptId: string;
      expectedBookingRevision: number;
      amountVnd: number;
      expiresAt: string;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      paymentAttemptId: string;
      bookingRevision: number;
      replayed: boolean;
    }>
  >;
  recordUnknown(
    input: Readonly<{
      bookingId: string;
      paymentAttemptId: string;
    }>,
    context: ContractContext,
  ): Promise<void>;
  releaseVerifiedFailure(
    input: Readonly<{
      bookingId: string;
      paymentAttemptId: string;
      providerEvidenceId: string;
    }>,
    context: ContractContext,
  ): Promise<void>;
}

interface BookingAutomationPort {
  listDue(
    input: Readonly<{
      kind: 'D3_REMINDER' | 'COMPLETION';
      dueBefore: string;
      cursor?: string;
      limit: number;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      nextCursor: string | null;
      items: readonly Readonly<{
        bookingId: string;
        bookingRevision: number;
        dueAt: string;
        coupleAccountId: string;
      }>[];
    }>
  >;
  completeDue(
    input: Readonly<{
      bookingId: string;
      expectedBookingRevision: number;
      commandId: string;
      now: string;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      outcome: 'COMPLETED' | 'REPLAYED' | 'NOT_DUE' | 'SKIPPED_TERMINAL';
    }>
  >;
}
```

Booking owns slot reservation and rechecks current timeline/amount/revision on reserve.
There is one unresolved deposit intent per booking, enforced in PostgreSQL. Edits,
approval withdrawal, slot release, and cancellation that invalidate that reservation
return `DEPOSIT_INTENT_ACTIVE` until proven failure or resolved settlement. Timeout
alone never releases an unknown intent. Payments owns the evidence and reconciliation;
booking does not query payment repositories. The same attempt ID replays only matching
intent data. Settlement uses the existing deposit recorder and the reserved attempt's
persisted evidence. A late verified success remains recorded by payments even if it
requires Manager reconciliation; it is never silently discarded or automatically charged
again. The exact same settled payment replays before current-state eligibility checks.

Completion is booking-owned: only a confirmed event past its snapshotted end instant
plus 12 hours is due. Notifications invokes `completeDue`; the command compares the
current booking revision, records audit/retention evidence, and emits `booking.completed`.
A cancelled/completed booking is an idempotent skip/replay. No payment/refund is implied.

### 21.4 Operational guest search and identity additions

```typescript
interface GuestOperationsSearchReader {
  search(
    input: Readonly<{
      bookingId: string;
      name?: string;
      phone?: string;
      cursor?: string;
      limit: number;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      nextCursor: string | null;
      households: readonly Readonly<{
        invitationHouseholdId: string;
        guestGroupId: string;
        representativeName: string;
        phoneLast4: string | null;
        expectedAttendees: number;
        operationalNote: string | null;
        groupName: string;
        groupColor: string;
      }>[];
    }>
  >;
}

interface StaffAccountProvisioner {
  provision(
    input: Readonly<{
      email: string;
      commandId: string;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      accountId: string;
      credentialSetupRequired: boolean;
      replayed: boolean;
    }>
  >;
  setOperationalAccess(
    input: Readonly<{
      accountId: string;
      enabled: boolean;
      commandId: string;
    }>,
    context: ContractContext,
  ): Promise<void>;
}

interface NotificationRecipientReader {
  resolve(
    input: Readonly<{
      accountId: string;
      purpose: 'BOOKING' | 'PAYMENT' | 'PRINT' | 'RSVP' | 'MEDIA';
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      accountId: string;
      active: boolean;
      email: string | null;
    }>
  >;
}
```

Guest search is called only by an authorized operational facade after Staff assignment
or explicit Manager override checks. Guest returns only records in that booking. Query
phone is a matching input, never an instruction to expose the full phone. Search has
limit 1–50, deterministic normalized matching, and privacy-safe telemetry.

Identity owns provisioning/revocation, password setup/reset, and account state. Staff
operations owns the Manager workflow and assignments. These additions require separate
identity-owned contract/adapter work; they do not reopen completed identity acceptance
or permit a generic role setter. Disabling operational access removes Staff authority
and revokes applicable sessions without disabling a separate Couple identity.

The existing `IdentityNotificationPort` remains the credential-delivery boundary.
Its explicit outbound command may contain the token at the last possible moment;
integration events, ordinary notification payloads, logs, and audit never do. Implementing
an asynchronous adapter must provide encrypted, short-lived credential handling or keep
credential delivery synchronous through that port. Recipient resolution is private
server-to-server only and requires an allowlisted purpose, not arbitrary account lookup.

### 21.5 Reporting provider ports

Each interface exposes `readPage(query: SourceQuery, context: ContractContext)` and
returns the indicated `SourcePage`. These reads are available only to an authorized
Manager projection/rebuild operation; consumers never join provider repositories.

| Interface / owner                        | Row value contract                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BookingReportingReader` / booking       | `{ bookingId, phase, eventDate, hallId, hallNameSnapshot, shiftCode, menuPackageId: string \| null, menuNameSnapshot: string \| null, tableCount: number, baseChargeVnd, confirmedAt: string \| null, cancelledAt: string \| null }`                |
| `BillingReportingReader` / payments      | `{ bookingId, acceptedChargesVnd, paidVnd, refundedVnd, outstandingVnd, creditVnd, ledger: readonly { ledgerEntryId, kind: 'CHARGE' \| 'PAYMENT' \| 'REFUND' \| 'CREDIT_ADJUSTMENT', amountVnd, occurredAt, sourceRevisionId: string \| null }[] }` |
| `InvitationReportingReader` / invitation | `{ bookingId, printOrderId, status, commercialRevisionId: string \| null, receivableChargeId: string \| null, acceptedAmountVnd, approvedAt: string \| null, updatedAt }`                                                                           |
| `GuestReportingReader` / guest           | `{ bookingId, invitationHouseholdId, guestGroupId, groupNameSnapshot, groupColorSnapshot, expectedAttendees, planningContribution, archived: boolean }`                                                                                             |
| `AttendanceReportingReader` / staff      | `{ bookingId, invitationHouseholdId, guestGroupId, actualAttendees, ledgerRevision: number }`                                                                                                                                                       |

All IDs and instants in the table are strings; amounts/counts are numbers; states use
the owning SPEC's enums. Each owner must publish a readonly TypeScript DTO and strict
runtime schema with these exact field names before consumer fake implementation.
Booking/base-charge and print-charge facts remain separate. Billing defines its ledger
and totals; analytics selects/aggregates those values rather than constructing new
payment truth. The ledger array is bounded to one booking; large ledgers are streamed
through an owner-defined paged extension before the bound is reached.

### 21.6 Printable invalidation, charge adjustment, and due content

Invalidation is terminal for a given seating revision. At equal revision number,
`markRequiresReview` wins over `registerConfirmed` regardless of delivery order.
An immutable reconfirmation requires a greater revision. A registration with an older
number is acknowledged without lowering the high-water mark. Same ID/different digest
conflicts. Seating's state change, eligibility change in the invitation-owned registry,
and print approval are serialized on the booking boundary in the shared database.
Owners expose an application unit-of-work adapter for this purpose; consumers do not
import repositories or Prisma transaction types. Durable retry records remain for
event delivery, but a failed required registry write rolls back confirmation/invalidation
rather than leaving a known-ineligible snapshot available for new print approval.

```typescript
interface BookingChargeAdjustmentRegistrar {
  registerCredit(
    input: Readonly<{
      bookingId: string;
      receivableChargeId: string;
      sourceAdjustmentId: string;
      amountVnd: number;
      reason: 'PRINT_CANCELLED' | 'PRINT_REPLACED';
      acceptedAt: string;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      adjustmentId: string;
      replayed: boolean;
    }>
  >;
}

interface InvitationAutomationReader {
  listMediaCutoffs(
    input: Readonly<{
      dueBefore: string;
      cursor?: string;
      limit: number;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      nextCursor: string | null;
      items: readonly Readonly<{
        bookingId: string;
        cutoffAt: string;
        policyRevision: number;
        coupleAccountId: string;
      }>[];
    }>
  >;
}

interface GuestAutomationReader {
  listRsvpDeadlines(
    input: Readonly<{
      dueBefore: string;
      cursor?: string;
      limit: number;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      nextCursor: string | null;
      items: readonly Readonly<{
        bookingId: string;
        deadlineAt: string;
        deadlineRevision: number;
        coupleAccountId: string;
      }>[];
    }>
  >;
}
```

A credit adjustment is a new immutable billing fact against one charge, not deletion of
that charge or automatic refund. Credit cannot exceed the uncredited source charge.
Print cancellation/replacement registers a deterministic adjustment before completion;
any paid excess becomes visible credit for Manager reconciliation/manual refund. A
replacement registers the new full commercial charge and credits the prior charge
once, rather than accumulating both full amounts. Existing charge/payment/refund event
meanings remain unchanged; new publishers emit optional additive adjustment facts only
after their event schema is reviewed.

### 21.7 Compatibility and implementation readiness

| Change                                                 | Classification                                             | Provider/consumer hand-off                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| New ordered headcount port and optional event sequence | Additive                                                   | Booking/guest review jointly; replace legacy concurrent use before integration.       |
| Timeline/search/reporting/automation/deposit ports     | Additive                                                   | Owner publishes declarations plus provider tests before consumer relies on them.      |
| Print credit adjustment port                           | Additive                                                   | Payments defines ledger result; invitation consumes without changing original charge. |
| Equal-revision invalidation precedence                 | Clarification of existing invalidation promise             | Invitation/seating tests cover both orders and shared transaction rollback.           |
| Restricted deposit permission                          | Correction to draft SPEC-04                                | Matches approved baseline authorization matrix.                                       |
| Overlapping implementation on fakes                    | Clarification within approved isolated implementation gate | SPEC and plan still approved; real integration/acceptance remains dependency-ordered. |

`docs/team-implementation.md` and every module SPEC's parallel-work matrix describe
file lanes, fake readiness, real-provider readiness, integration evidence, and acceptance.
No implementation task or prior approval is marked complete by this documentation.

### 21.8 Remaining additive owner DTOs

```typescript
interface BookingBoundaryUnitOfWork {
  run<T>(
    input: Readonly<{
      bookingId: string;
      context: ContractContext;
    }>,
    work: (scopedContext: ContractContext) => Promise<T>,
  ): Promise<T>;
}

interface BookingCommercialSnapshotReader {
  getAccepted(
    input: Readonly<{
      bookingId: string;
      timelineRevisionId: string;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      bookingId: string;
      commercialRevisionId: string;
      bookingRevision: number;
      baseChargeVnd: number;
      depositAmountVnd: number;
      menuPackageVersionId: string;
      tableCount: number;
      acceptedAt: string;
    }>
  >;
}

interface VenueSelectionEligibilityReader {
  getLayoutEligibility(
    layoutTemplateVersionId: string,
    context: ContractContext,
  ): Promise<
    Readonly<{
      layoutTemplateVersionId: string;
      hallId: string;
      templateActive: boolean;
      hallActive: boolean;
      currentForNewSelection: boolean;
      hallMaxGuests: number;
      totalSeatCapacity: number;
    }>
  >;
}

interface VenueReportingReader {
  readPage(
    query: SourceQuery,
    context: ContractContext,
  ): Promise<
    SourcePage<
      Readonly<{
        hallId: string;
        eventDate: string;
        shiftCode: 'LUNCH' | 'DINNER';
        hallNameSnapshot: string;
        available: boolean;
      }>
    >
  >;
}

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

interface PersonalizedInvitationDeliveryPort {
  send(
    input: Readonly<{
      invitationId: string;
      bookingId: string;
      intentId: string;
      recipientEmail: string;
      invitationToken: string;
      expiresAt: string;
    }>,
    context: ContractContext,
  ): Promise<
    Readonly<{
      notificationIntentId: string;
      outcome: 'QUEUED' | 'DELIVERED' | 'UNKNOWN';
      replayed: boolean;
    }>
  >;
}
```

Core owns the unit-of-work infrastructure; the interface denotes one database transaction
and a booking serialization lock. transactionScopeId is opaque, internal, unforgeable
outside that operation, and invalid after callback completion. Owner infrastructure
adapters enlist in the same scope; no consumer imports Prisma transaction types.
Unit-of-work tests prove an exception rolls back all enlisted owner writes. A provider
that cannot enlist is not ready for settlement/print integration.

Venue additions are owner-maintained separate prerequisite slices. Existing
VenueCatalogReader/current versus exact-version behavior stays unchanged. Eligibility
does not equate a superseded version with a retired aggregate. Historical slot reporting
uses owner-maintained effective-dated hall/shift activity; dates before captured history
are explicitly SOURCE_NOT_READY. Each active hall/date has at most LUNCH and DINNER,
with unavailable rows for retired/inactive windows. The venue owner publishes activity
history/denominator evidence without consumers querying catalog tables.

Personalized delivery is a guest-owned credential boundary implemented by Notifications,
not an integration event carrying a token. Guest may keep an optional normalized recipient
email for explicit delivery. Its authorized share link remains separate. Queue handling
follows SPEC-09 encrypted short-lived rules; idempotency binds intent ID and the exact
credential revision. No private token is exposed in ordinary notification status.

### 21.9 Amendment approval record

- Status: accepted; active contract revision `WEDDING-CONTRACT-1@1.1.0`.
- Reviewer/authority: project owner in the current project conversation, 2026-10-06.
- Approval evidence: “vậy tôi duyệt draft trên”, following the nine-SPEC review and
  the A: 03–04, B: 05–06, C: 07–08 team allocation discussion.
- Scope: SPEC-03 through SPEC-11, their documented numeric defaults, Section 21,
  ADR-003 and the team hand-off/ownership model. No runtime completion is claimed.
- Active declarations are updated together; Section 19 and ADR-002 retain the
  historical 1.0.0 approval. Module wave/task plans still need their own approval;
  published provider artifacts, conformance suites and real integrations remain pending.
- A required-field change to an existing implemented port is breaking and cannot be
  slipped into this additive amendment. The new ordered port exists for that reason.

### 21.10 Concrete reporting DTOs and print validity proof

```typescript
type BookingReportRow = Readonly<{
  bookingId: string;
  phase: 'DRAFT' | 'AWAITING_DEPOSIT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  eventDate: string;
  hallId: string;
  hallNameSnapshot: string;
  shiftCode: 'LUNCH' | 'DINNER';
  menuPackageId: string | null;
  menuNameSnapshot: string | null;
  tableCount: number;
  baseChargeVnd: number;
  confirmedAt: string | null;
  cancelledAt: string | null;
}>;
type BillingReportRow = Readonly<{
  bookingId: string;
  acceptedChargesVnd: number;
  paidVnd: number;
  refundedVnd: number;
  outstandingVnd: number;
  creditVnd: number;
  ledger: readonly Readonly<{
    ledgerEntryId: string;
    kind: 'CHARGE' | 'PAYMENT' | 'REFUND' | 'CREDIT_ADJUSTMENT';
    amountVnd: number;
    occurredAt: string;
    sourceRevisionId: string | null;
  }>[];
}>;
type InvitationReportRow = Readonly<{
  bookingId: string;
  printOrderId: string;
  status:
    | 'REQUESTED'
    | 'QUOTED'
    | 'APPROVED'
    | 'IN_PRODUCTION'
    | 'READY_FOR_HANDOVER'
    | 'HANDED_OVER'
    | 'CANCELLED';
  commercialRevisionId: string | null;
  receivableChargeId: string | null;
  acceptedAmountVnd: number;
  approvedAt: string | null;
  updatedAt: string;
}>;
type GuestReportRow = Readonly<{
  bookingId: string;
  invitationHouseholdId: string;
  guestGroupId: string;
  groupNameSnapshot: string;
  groupColorSnapshot: string;
  expectedAttendees: number;
  planningContribution: number;
  archived: boolean;
}>;
type AttendanceReportRow = Readonly<{
  bookingId: string;
  invitationHouseholdId: string;
  guestGroupId: string;
  actualAttendees: number;
  ledgerRevision: number;
}>;
interface BookingReportingReader {
  readPage(query: SourceQuery, context: ContractContext): Promise<SourcePage<BookingReportRow>>;
}
interface BillingReportingReader {
  readPage(query: SourceQuery, context: ContractContext): Promise<SourcePage<BillingReportRow>>;
}
interface InvitationReportingReader {
  readPage(query: SourceQuery, context: ContractContext): Promise<SourcePage<InvitationReportRow>>;
}
interface GuestReportingReader {
  readPage(query: SourceQuery, context: ContractContext): Promise<SourcePage<GuestReportRow>>;
}
interface AttendanceReportingReader {
  readPage(query: SourceQuery, context: ContractContext): Promise<SourcePage<AttendanceReportRow>>;
}
interface BookingPlanningSnapshotReader {
  getCurrent(
    bookingId: string,
    context: ContractContext,
  ): Promise<
    Readonly<{
      bookingId: string;
      bookingRevision: number;
      planningHeadcount: number;
    }>
  >;
}
type PrintableSeatingValidityProof = Readonly<{
  bookingRevision: number;
  expectedAttendees: number;
  minGuests: number;
  maxGuests: number;
  totalSeatCapacity: number;
  managerException: Readonly<{
    approvalId: string;
    approvedBookingRevision: number;
    approvedHeadcount: number;
  }> | null;
}>;
```

Amendment 1.1.0 `PrintableSeatingContentRegistry.registerConfirmed` adds optional
`validityProof?: PrintableSeatingValidityProof` to its input. All new integrated
seating publishers must include it; an old stored snapshot without proof is historical
render content only and cannot authorize a new print approval. Existing signature
callers remain source-compatible; no valid existing 1.0.0 production workflow is claimed
for these unfinished modules.

Before print approval, invitation obtains `BookingPlanningSnapshotReader.getCurrent`
and `VenueSelectionEligibilityReader.getLayoutEligibility` within the booking-bound
unit-of-work. It compares current headcount to stored min/max and the live active hall/
template check. A Manager exception requires both the approved headcount and booking
revision to match current values and cannot exceed physical/hall capacity. An out-of-range
count blocks even if the asynchronous invalidation event has not been delivered.
This is an additive upstream venue read dependency for invitation, not a reverse
invitation-to-seating query. The registry/print application service owns these checks;
it never queries seating tables or reinterprets geometry.

The same booking lock protects headcount synchronization, timeline activation, seating
validity, and print capture. Full guest-plan integration must activate guest plan and
booking headcount in the shared unit-of-work. When the real synchronizer is unavailable,
a durable recovery intent may stage a proposed change, but cannot activate the new plan
or claim successful completion; return `503 HEADCOUNT_SYNC_PENDING`. Replay activates
both owner changes atomically. Fake-only or pending-only paths cannot close integration.

Within this unit-of-work, the venue eligibility adapter holds a shared lock on the
hall/template lifecycle rows until commit. Retirement takes the corresponding exclusive
lock. Therefore retirement either precedes and blocks approval or follows a valid
captured snapshot; a read followed by an unlocked retirement race is not conformant.
Venue retirement never waits on booking locks while holding venue locks; dependent
invalidation is emitted through its outbox after the venue change.

### 21.11 SPEC-05 implementation clarification package — 2026-10-09

Status: **Implemented candidate; owner/consumer review pending**. This section records
the concrete W2–W4 implementation for review; it does not declare a new approved
baseline version, notification-dispatch readiness or consumer integration acceptance.

- The application registry accepts the frozen readonly renderSnapshot array/rows.
  `seatingRenderSchema` and `validityProofSchema` are available through the application
  contract. The producer validates/normalizes the bounded renderSnapshot then calls
  `computePrintableSeatingDigest`: lowercase SHA-256 of Core canonical JSON,
  preserving table-array order. Revision/proof identity is additionally checked on
  replay. Same ID with changed geometry/proof/digest is409; no existing valid live
  producer workflow is claimed. Seating must review this recipe before hand-off.
- Publication changed v1 retains the frozen required payload. The separate removal
  fact `invitation.unpublished` v1 carries required bookingId/publicInvitationId/
  publishedRevisionId/changedAt, including the last removed immutable revision.
  Both envelopes are strict in invitation-owned application/publication.events.ts
  and persisted with publication state in one transaction. Notification consumer
  subscription/dispatch of the removal fact requires review; existing publication
  consumers are not silently given a nullable revision or changed fact meaning.
- The two additive Manager generation recovery endpoints are documented in
  docs/spec-05-w2-w4-handoff.md and generated OpenAPI. ABANDONED is an explicitly
  evidenced local terminal decision, not a provider-failure/refund claim. Recovery
  from a durable private-media artifact retains the original intent and does not
  regenerate. Missing/unavailable evidence remains pending; old intents never
  become permission for another paid provider call.

Formal hand-off retains exact reviewed provider commit/artifact/digest, conforming
consumer pins and actual Seating confirm/invalidate/UoW rollback/race evidence.
