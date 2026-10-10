# ADR-005: Recover deposit application after durable settlement

## Status

Implemented technical realization of approved SPEC-04 Section 8 and baseline 1.1.0,
2026-10-08. Module acceptance and the VNPay/HTTP hand-off remain pending. This
decision implements the existing recovery contract without changing money policy.

## Context

Proven money must survive a Booking or Identity failure. Booking confirmation and
promotion must commit together. Replaying a completed deposit must bypass fresh
payability rejection; an unapplied payment still requires current eligibility.

## Decision

- Create the durable Billing attempt, Booking reservation and accepted base charge
  in one shared booking boundary. Derive the amount and commercial revision from
  Booking, use the fixed fifteen-minute expiry, and return only after commit.
  A later timeline retaining the commercial revision preserves its original base
  charge acceptance. A deposit is payment toward that charge.
- W4 supplies a persisted, correlated SUCCEEDED attempt before the internal worker
  applies money. W3 supplies no callback parser, checkout or public settlement route.
- Commit the immutable payment/audit/outbox first. A fresh Booking check precedes
  first recording; proven late money remains recorded when current eligibility fails.
  If the mandatory Booking reader is unavailable, the persisted successful attempt
  remains retryable and no successful downstream application is reported.
- Apply the Booking recorder and its Identity promotion in a second shared boundary.
  Insert the immutable `BillingDepositApplication` completion marker after both
  succeed. A payment without its marker is durable PENDING work. Owner effects,
  their evidence and the marker roll back together on failure.
- Reconciliation retries the same payment identity/date. A committed marker makes
  exact replay succeed without requiring Booking to become payable again. Changed
  settlement dates conflict. Retry serialization/uniqueness failures at most three
  times around the entire boundary, never inside an aborted owner transaction.
- Add migration `20261008007000_billing_deposit_application`. It preserves existing
  facts and adds no inferred completion. SQL restricts markers to proven deposit
  payments and prevents updates/deletes. The repository requires the opaque scope.

## Alternatives

A single transaction that rolls back proven money leaves the ledger incomplete
after downstream failure. Independent Booking/Identity commits can leave access FULL
after confirmation rolls back. An in-memory flag disappears on restart. Inferring
completion from current Booking phase cannot prove the same payment completed promotion.

## Consequences and evidence

Settlement and downstream application have separate observable states. W4 retains
callback evidence and retries pending applications; W6 exposes safe pending status.
The approved payment-succeeded event describes proven money and may precede downstream
completion. No new event is invented for the internal completion marker.

The provider composition injects one core scope into Billing and the real Booking
providers. Booking invokes the Identity promoter for the reserved account. HTTP
remains unwired until its later checkpoint.

Proof: `tests/integration/payments-billing/deposit-orchestration.test.ts`,
`ledger.test.ts`, `application-upgrade.test.ts`, and the W3 section of
[Billing evidence](../../tasks/evidence/payments-billing.md). Tests inject failure
after real promotion, verify complete owner rollback with retained money, and recover
after creating a new provider instance. They also prove same/distinct-command races,
timeline supersession, concealed denial, late money and immutable completion.

Authority: [ADR-004](0004-enlist-booking-owner-providers-and-retention-evidence.md),
[SPEC-04](../../SPEC-payments-billing.md), and
[the approved plan](../archive/plan-2026-10-10.md#21-spec-04-payments-billing-bounded-implementation-plan).
