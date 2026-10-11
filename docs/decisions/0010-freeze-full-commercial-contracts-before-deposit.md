# ADR-010: Freeze full commercial contracts before deposit

## Status

Technical implementation of BE-06–10, 2026-10-11, on
`codex/commercial-contracts-step-4`. Required automated and real database/provider
acceptance remains pending. This does not reopen SPEC-01–05 acceptance.

## Context

The approved commercial extension includes multiple menu table quantities, print
copies and service quantities. A single-menu legacy proposal cannot be reinterpreted
as a full agreed obligation. Catalog/profile edits, concurrent approvals and unknown
payment outcomes must not change the monetary intent or double the receivable.

## Decision

- A Booking-owned CommercialContract head explicitly selects FULL_CONTRACT_V1.
  Absence means LEGACY_PROPOSAL_V1. Conversion requires DRAFT and no prior
  BASE/PRINT/CONTRACT charges, verified deposit, or unresolved/succeeded deposit
  attempt. Existing legacy settlements/history retain their original semantics.
- Every draft is a new immutable content revision. Replacement and own approval
  withdrawal supersede the prior revision and create a successor without approvals.
  The shared Booking unit of work serializes commands and optimistic Booking revision.
  Venue/Invitation readers resolve current selections in the enlisted transaction;
  consumers never read another owner's catalog tables.
- Submission re-resolves current catalog/profile/venue/timeline facts and compares
  the canonical schema-ordered SHA-256 digest. A changed draft requires explicit
  reselection/successor; no silent repricing. After submission, catalog/profile edits
  do not change its content. Approval binds the current exact timeline and snapshot,
  with distinct Manager/Couple actors and immutable party/digest/time evidence.
  Operational shift bounds come from the already-frozen Booking proposal, matching
  timeline validation/cancellation/completion rather than mutable shift catalog times.
- Menu tables aggregate within the existing 1–500 rule. Independently entered planning
  headcount must fit active hall capacity. No undocumented seats-per-table ratio or
  Guest-list prerequisite is introduced.
- Both current commercial and timeline approvals are required at reservation and
  application. Deposit is checked ceil(total × 30 / 100), including MENU/PRINT/SERVICE.
  HTTP includes the exact contract revision and digest. Attempts, Booking reservations
  and settlements retain both identities; ACTIVE/UNKNOWN pin them despite expiry.
- Payments registers the unique CONTRACT charge with verified deposit money, using
  the approved total/date in the same transaction as the PAYMENT fact. A failed
  checkout therefore leaves no stale new-model obligation before a permissible
  predeposit revision. Manual evidence registers charge/payment/application atomically.
  Provider verified evidence and money precede recoverable Booking/access application
  as in ADR-005. Retries retain the original attempt, contract digest and source.
- A full-model Booking rejects legacy BASE/PRINT charges; its contracted print price
  is already in the total. Contract-linked production/cancellation belongs to BE-12,
  and appendix/final-invoice adjustments to BE-11–16. Until those land, legacy print
  charging cannot execute on a full-model Booking.
- Store approved PDF bytes and their SHA-256 once at the second approval. The PDF
  contains the immutable document and both approval facts. Later supersession,
  profile edits, catalog archives or renderer changes cannot rewrite that artifact.
  Private draft previews remain explicitly drafts. A document digest identifies the
  agreed business content; a PDF digest identifies the rendered bytes.
- Use pinned PDFKit and bundled full Be Vietnam Pro TTFs under OFL. The font files
  ship in the runtime image. No remote rendering service, new secret or digital
  signature authority is introduced.
- Add the BillingSourceType enum in a preceding committed migration, then atomically
  create schema and guards in a separate forward migration. Never edit historical SQL.

## Consequences and proof

New-model clients must send exact contract identity; legacy bodies still work for
legacy bookings. Charged legacy drafts require an explicit separate recovery decision
rather than automatic conversion. Approved name snapshots intentionally remain stable
when profiles change.

The branch includes strict schemas, mounted HTTP, provider readers, generated OpenAPI,
SQL immutability/source/pinning guards and a private PDF renderer. Typecheck, build,
lint and artifact checks are tracked in the [handoff](../be06-10-commercial-contracts.md).
Static checks are not evidence of real migration, concurrency, PDF glyph rendering,
automated regression coverage or a genuine full-total VNPay sandbox payment.
