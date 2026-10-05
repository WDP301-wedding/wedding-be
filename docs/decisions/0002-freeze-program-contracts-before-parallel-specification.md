# ADR-002: Freeze Program Contracts Before Parallel Specification

## Status

Accepted

## Date

2026-10-06

## Context

The original program plan requires each module specification, implementation, evidence,
and owner approval to finish before the next dependent specification begins. That
sequence protects unresolved contracts but prevents new contributors from owning later
specifications concurrently.

The project owner wants to define and reconcile the cross-module contract baseline for
all remaining capabilities first. Once ownership, state semantics, provider ports,
events, snapshots, and compatibility rules agree, separate contributors should be able
to specify and plan different modules without creating conflicting domain models.

The repository already has implemented contracts for `core-platform` and
`identity-access`, approved contracts for `venue-catalog`, stable module IDs, and an
acyclic capability map. The remaining risk is not the absence of module boundaries; it
is allowing separate specifications to silently redefine the same boundary.

`SPEC-02` is already being implemented under an approved venue-catalog plan. Reopening
or replanning that work would add risk without helping the remaining contract freeze.

## Decision

Adopt `CONTRACT-BASELINE.md` as the single versioned cross-module contract for the
Wedding Management program.

Under the project-owner-approved version `1.0.0`:

- `SPEC-02` continues unchanged through its existing V4 acceptance gate;
- contributors may draft `SPEC-03` through `SPEC-11` with controlled overlap, while
  final provider/consumer contract approvals remain dependency-ordered and each
  module plan still waits for approval of its own SPEC;
- each SPEC must declare the baseline version it consumes and list its produced and
  consumed provider contracts/events;
- one provider module owns each identifier, fact, state transition, and event schema;
- consumer SPECs may refine local behavior but cannot fork or override provider
  semantics;
- incompatible discoveries use the baseline change procedure rather than silent edits;
- implementation follows dependency readiness, a serialized migration lane, and real
  provider integration gates even when specifications were written in parallel.

The required final SPEC approval graph is `03 → 04 → 05 → 06`, followed by
`07 → 08 → 10` in parallel with `09`; `11` waits for both `09` and `10`. Early
drafting does not waive these gates.

The contract baseline does not create a shared runtime package. Backend interfaces
remain in their owning modules, and client types remain generated from the backend
OpenAPI artifact.

## Alternatives Considered

### Keep the Fully Sequential Specification Sequence

- Pros: Every downstream author sees a completed upstream implementation.
- Cons: New contributors remain idle or work without ownership; feedback on later
  cross-module assumptions arrives late.
- Rejected if the baseline is accepted: Contract review can resolve semantic
  dependencies before implementation without serializing all documentation work.

### Start Every Module Implementation in Parallel

- Pros: Maximum apparent concurrency.
- Cons: Shared Prisma migrations, money/access effects, provider availability, and
  end-to-end invariants still have real order; mocks can hide incompatible behavior.
- Rejected: Parallel specification does not eliminate implementation dependencies.

### Create a Shared Cross-Repository Types Package

- Pros: One importable location for interfaces.
- Cons: Creates a fifth artifact, duplicates OpenAPI distribution, couples client and
  backend release cadence, and risks leaking internal domain types.
- Rejected: The baseline documents semantics, owner modules publish backend ports, and
  OpenAPI remains the external client contract.

### Let Each SPEC Negotiate Contracts Independently

- Pros: Minimal up-front coordination.
- Cons: Encourages duplicate ownership, incompatible enums, reversed dependencies,
  and late integration rework.
- Rejected: It does not satisfy the reason for parallel specification.

## Consequences

- Cross-module decisions receive earlier review and become explicit versioned
  commitments.
- Multiple contributors can own separate SPECs and plans after one baseline approval.
- SPEC-02 continues without baseline-driven replanning, and SPEC-03 implementation
  remains blocked until venue-catalog V4 acceptance.
- Contract changes become more deliberate and require impact analysis.
- Some detailed module choices remain intentionally deferred; the baseline must not
  grow into a monolithic implementation specification.
- Provider implementations, migrations, money effects, and final integration still
  respect dependency order and acceptance gates.
- The capability map and task plan record the accepted dependency graph and controlled
  overlap rules from the baseline lock.

## Approval Record

The project owner accepted this decision and locked
`WEDDING-CONTRACT-1@1.0.0` on 2026-10-06. Future changes follow the baseline's
compatibility and change-control procedure; this ADR remains as the historical record
of why controlled parallel specification was introduced.
