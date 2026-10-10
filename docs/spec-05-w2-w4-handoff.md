# Invitation Backend Provider Hand-off

Current contract index after documentation consolidation on 2026-10-10.
[Invitation specification](../SPEC-invitation-studio.md),
[contract baseline](../CONTRACT-BASELINE.md) and the
[committed OpenAPI](../openapi/openapi.json) define the owned contracts.
[Backend scope](./backend-scope-2026-10-10.md) governs commercial/profile amendments;
[active tasks](../tasks/backend-revision-todo.md) govern unfinished work.
This index does not declare consumer review, live providers or deployment accepted.

## HTTP and Access Boundary

All Invitation routes use the canonical OpenAPI operations under `/api/v1`. Private
routes require current Identity/Booking authority; command schemas reject unknown
fields, writes require their declared idempotency/revision checks. Public invitation,
render, generic QR and derived-asset reads grant no guest response, check-in, private
library or billing authority. Missing/unpublished content returns concealed 404.
Public derived assets and private original media remain separate.

## Application Contracts

- `InvitationPublicationReader.requirePublishedPublicInvitation` and
  `resolvePrintableRevision` provide exact approved/publication revisions.
- `PrintableSeatingContentRegistry.registerConfirmed` and `markRequiresReview` require
  the shared `ContractContext`/UoW; `renderSnapshot` accepts readonly arrays/rows.
- `PrintableService.capture` is internal and enlisted by approved print ordering;
  there is no public bypass of quotation, billing, approval or authorization.
- `computePrintableSeatingDigest`, `seatingRenderSchema` and `validityProofSchema` are
  exported application contracts. Consumers do not import Invitation repositories.
- Exact digest/removal/recovery semantics are in baseline Section 21.11 and the
  [application contracts](../src/modules/invitation-studio/application/studio.contracts.ts).
  Preserve publication/removal event revision identities and strict payloads.

## Unknown AI Effects

Retry uses the same durable generation intent and accepted upload journal rather
than purchasing a new generation. Without a verifiable retained artifact the intent
remains `PENDING`. Audited Manager `ABANDONED` reconciliation ends internal processing;
it does not prove the provider charged nothing, authorize a refund or permit the
same terminal intent to generate again. RV-10/11 require separate authorized proof.

## Consumer and Runtime Gates

Publish an exact reviewed backend commit, API digest, owned provider artifacts and
consumer pins before integrated acceptance. Actual Seating must confirm/invalidate
through the shared UoW with conformance, rollback and race proof; fixture registry
calls are not a real producer. Notifications owns actual dispatch and recovery.
Guest, Seating and Notifications integration, print-file rendering and live external
services remain their explicit GM/SEA/NTF/RV tasks. Client implementation belongs to
the frontend team and is not a backend task gate.

## Historical Evidence

- [Original W2-W4 checkpoint, tests, API inventory and limitations](../tasks/evidence/spec05-w2-w4-handoff-2026-10-09.md).
- [Module evidence](../tasks/evidence/invitation-studio.md) and
  [later review-fix evidence](../tasks/evidence/spec05-review-fixes.md).
- [Runtime/provider audit](../tasks/evidence/spec01-05-runtime-audit-2026-10-10.md).

Historical typecheck/coverage failures and simultaneous wave work are preserved in
the original dated record, not presented as the current checkout state. Later CI
success still does not establish live Supabase/Gemini or printable-file acceptance.
