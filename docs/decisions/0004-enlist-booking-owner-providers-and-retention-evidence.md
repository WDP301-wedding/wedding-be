# ADR-004: Enlist booking owner providers and terminal retention evidence

## Status

Implemented technical realization of the approved SPEC-03 and contract amendment
1.1.0, 2026-10-08. SPEC-03 implementation acceptance remains pending at BK-C4.
This record does not introduce a new business policy or mark the module ACCEPTED.

## Context

Payment consumers need booking eligibility, settlement and identity promotion to
participate in one booking transaction. Independent repository transactions could
commit promotion before the surrounding payment boundary rolls back. Reads through
the root Prisma client also miss changes made inside the current transaction.

A terminal booking supplies retention evidence to identity. Several accounts may
have grants for the same consultation, so a globally unique business-record ID
cannot represent every account's evidence. Identity continues to require evidence
for all linked consultations before starting its existing retention period.

## Decision

- The booking boundary owns a serializable PostgreSQL transaction and advisory
  booking lock. Consumers receive an opaque, frozen context; infrastructure alone
  receives the enlisted Prisma client. Owner repository callbacks enlist in that
  transaction. Scoped reads use the same client, including identity access reads.
- Reject fabricated, copied, expired, detached, nested and different-booking
  transaction contexts. Propagate owner failure to the outer transaction.
- Cancellation approval and manual/worker completion call the identity-owned
  retention recorder inside their state/audit/outbox transaction. Identity enumerates
  its own consultation grants; booking supplies the consultation, business record
  and terminal date. The original account recorder signature remains intact.
- Retention evidence is unique by `(accountId, sourceBusinessRecordId)`, with the
  existing account/consultation uniqueness and completeness checks retained. The
  forward migration replaces the narrower global index without rewriting evidence.
- Store event version, correlation and optional causation with outbox rows. The
  core envelope adapter reconstructs the baseline envelope from durable fields.
  Upgrade recovers correlation from matching audit evidence where possible; a
  legacy event without such evidence starts its own correlation at its event ID.

## Alternatives

Independent transactions lose atomic rollback and read visibility. Passing Prisma
clients to consumers exposes repository ownership. Selecting one arbitrary Couple
account for retention omits other linked accounts. Inventing request IDs during
event migration would misrepresent historical evidence.

## Consequences and evidence

The provider boundary is ready for controlled consumer integration, but does not
implement SPEC-04 payment processing. The configured runtime always injects the
real identity retention recorder; isolated repository tests may use the default
no-op callback. Retention duration and erasure guards remain identity-owned.

Proof: `src/core/database/booking-unit-of-work.test.ts`,
`tests/integration/booking-lifecycle/runtime.test.ts`,
`tests/integration/booking-lifecycle/slot-hold-race.test.ts`,
`tests/integration/booking-lifecycle/upgrade.test.ts`, and
[the BK-W8 checkpoint](../../tasks/evidence/booking-lifecycle.md).

Authority: [ADR-003](0003-publish-provider-hand-offs-for-overlapping-implementation.md),
[SPEC-03](../../SPEC-booking-lifecycle.md), and
[the approved bounded plan](../archive/plan-2026-10-10.md#20-spec-03-booking-lifecycle-bounded-implementation-plan).
