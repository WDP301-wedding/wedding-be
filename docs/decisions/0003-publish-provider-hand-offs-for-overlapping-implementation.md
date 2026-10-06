# ADR-003: Publish Provider Hand-offs for Overlapping Implementation

## Status

Accepted by the project owner on 2026-10-06. Supplements accepted ADR-002 without
replacing its module-plan, implementation and acceptance gates.

## Context

The owner clarified that independent team implementation means different contributors
can implement SPEC slices concurrently where dependencies permit. The first drafts
restated semantic boundaries but lacked ordered source evidence, snapshot/search ports,
billing adjustments, automation commands and explicit implementation readiness.

## Decision

Adopt accepted WEDDING-CONTRACT-1@1.1.0 Section 21 and the revised SPEC-03 through
SPEC-11. Separate approved contracts, isolated coding with conforming fakes, specific
real provider readiness, consumer integration, and whole-module acceptance.

An approved module/plan can implement against a reviewed provider contract while that
provider's implementation is unfinished. Specific real methods may become ready before
all upstream screens finish. Deposit, access, print snapshot and attendance acceptance
requires real providers and PostgreSQL. The principal integration spine and the
seating/staff/analytics versus notification branches remain.

One steward serializes core outbox/unit-of-work, additive identity/venue prerequisites,
Prisma migrations, OpenAPI publication and composition-root wiring. Module owners
implement their own application ports and files. Existing 1.0.0 signatures remain;
new ports provide ordered headcount, reporting, search and automation.

## Alternatives

- Whole-program sequential coding prevents useful overlap after interfaces stabilize.
- Simultaneous all-module integration ignores money/history/migration dependencies.
- Consumer repository reads bypass ownership and make independent testing unreliable.

## Consequences

Each SPEC has DTOs, defaults, failures, provider/fake proof and parallel-work matrices.
Integration/acceptance remain ordered; shared-file changes have one lane. Numeric
policies are fixed by this SPEC approval. Existing CP/IA/VC acceptance stays intact.
The initial three-person allocation is A: SPEC-03/04, B: SPEC-05/06 and C: SPEC-07/08.
SPEC-09/10/11 and the named integration steward are not yet assigned.

## Approval

Approval evidence (2026-10-06): the project owner replied, “vậy tôi duyệt draft trên”,
after reviewing the revised SPEC-03 through SPEC-11, hand-off dependencies and the
three-person ownership split. Contract revision 1.1.0 and the nine specifications are
approved together. This does not approve unprepared module task/wave plans, mark any
provider as implemented, accept a module, or authorize deployment.

References: [accepted amendment 1.1.0](../../CONTRACT-BASELINE.md#21-accepted-amendment-110-implementation-hand-off-contracts),
[team implementation](../team-implementation.md), and [ADR-002](0002-freeze-program-contracts-before-parallel-specification.md).
