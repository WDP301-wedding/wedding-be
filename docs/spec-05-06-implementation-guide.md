# Backend Implementation Guide: SPEC-05/06 and the Commercial Revision

Updated 2026-10-10 after the owner confirmed the complete scope. The previous guide
embedded copies of specifications, client instructions and the retired design skill.
Those copies are no longer implementation sources. Their earlier version remains in
Git history; completed implementation evidence is preserved in the files below.
Use direct links to current authoritative files instead of copied requirements.

## Current Sources

- [Confirmed requirements and business decisions](./backend-scope-2026-10-10.md).
- [Product requirements](../PRODUCT-REQUIREMENTS.md).
- [Contract baseline Section 22](../CONTRACT-BASELINE.md#22-confirmed-backend-scope--2026-10-10).
- [Capability/ownership map](../CAPABILITY-MAP.md).
- [Commercial extensions to completed SPEC-02–05](../SPEC-commercial-contracts.md).
- [SPEC-06 Guest Management](../SPEC-guest-management.md).
- [Active backend tasks](../tasks/backend-revision-todo.md).
- [Team/provider hand-off contract](./team-implementation.md).
- [Serialized forward migration policy](./database-migrations.md).

The scope is backend-only from SPEC-06. The frontend team owns all new UI and client
integration. Existing frontend code is retained; there is no mandatory design skill.
Guest invitation links are read-only. Group/household management, imports, expected
counts, seating and Staff check-in remain required.

## Completed SPEC-05 Backend

The owner states SPEC-05 backend is complete. Preserve existing checkpoints:

- [Invitation specification and checkpoints](../SPEC-invitation-studio.md).
- [Invitation backend evidence](../tasks/evidence/invitation-studio.md).
- [Review fixes and their proof](../tasks/evidence/spec05-review-fixes.md).
- [W2–W4 exact provider hand-off](./spec-05-w2-w4-handoff.md).
- [Historical plan/evidence](../tasks/plan.md).

This scope amendment does not fabricate a fresh test run, provider review or deployed
release. New pre-deposit print selection and contract-linked billing are BE-05/12,
separate additions rather than a demand to redo completed Invitation work.

## Implementation Sequence

Start BE-01 with separate nullable couple names and legacy-safe DTO/persistence.
Then implement service/print catalogs, itemized commercial contracts and approval,
exact whole-contract deposit, appendix/print charging and final invoice extensions
in the order and with the tests specified in the active task table.

GM-W1–5 implement Guest Management with real ordered headcount/publication/access
providers at integration. SPEC-07–11 consume its reviewed ports; no guest response
model, deadline or response event is produced. All new code/schema/API tasks remain
pending until evidence is recorded. Backend hand-off never requires writing client UI.

## Commands and Evidence

Use existing npm scripts: lint, typecheck, test, build, test:contract, relevant
test:integration/test:coverage, db:generate, api:generate and api:check. Run migration
rehearsal only against disposable PostgreSQL, preserve applied migrations and record
skips as incomplete. Routine documentation checks use Prettier and git diff --check.
Each finished task records actual commands/results, immutable provider version,
API digest and requirement/concurrency/authorization evidence. Do not check off new
contract or Guest implementations based only on the interview or this guide.
