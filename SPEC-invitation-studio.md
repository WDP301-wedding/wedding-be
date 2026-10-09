# Specification: Invitation Studio

- Status: **Approved specification — module plan and implementation acceptance pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `invitation-studio` (`SPEC-05`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
- Initial owner role: B (member name to be assigned)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: MED-001 through MED-006; PRN-001 through PRN-005 and PRN-007 through PRN-009; QRC-001 through QRC-004
- Depends on: `core-platform`, `identity-access`, `venue-catalog` (accepted 1.1.0 eligibility read), `booking-lifecycle`, `payments-billing`
- Consumers: `guest-rsvp`, `seating-plan`, `notifications-automation`, `analytics-dashboard`

## 1. Purpose and boundaries

This module owns post-deposit private wedding media, invitation designs/revisions,
generic public invitations, printable snapshots, print orders/lines/quotes, and print
fulfilment. It provides a full Couple Web editor and a constrained Couple App
quick-edit/preview/share surface. It does not own payment truth, guest/RSVP data,
catalog geometry, or a live seating repository.

Private media requires current `FULL` access and a confirmed booking. Private original Storage keys and
signed library URLs never reach public output. A generic public slug is opaque and unguessable,
but is never RSVP, check-in, or identity authority and returns only published content.

## 2. Immutable revision and print state contract

Design edits create immutable `invitationDesignRevisionId`s. Publishing captures one
immutable public revision. A printable revision freezes design, effective timeline,
optional eligible seating snapshot, public-invitation reference, and content digest.

```text
REQUESTED -> QUOTED -> APPROVED -> IN_PRODUCTION -> READY_FOR_HANDOVER -> HANDED_OVER
| | |
+----------+----------+----------------------------------------------> CANCELLED
```

Manager re-quotation creates a new commercial revision. Couple approval names the exact
current revision. No transition skips quote, Couple approval, or printable/commercial
capture; deadline details await this SPEC's decision approval.

## 3. Produced backend contracts

```ts
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
    validityProof?: PrintableSeatingValidityProof;
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

Registration is idempotent by revision/digest. Invalidation is terminal for that same
revision number; delayed registration cannot restore eligibility. Reconfirmation creates
a new immutable revision with a higher number. Changed digest is
`409 PRINTABLE_SEATING_DIGEST_CONFLICT`. Higher revision wins; delayed calls cannot
re-enable older content. Seating designs require the highest eligible registered
snapshot; non-seating designs explicitly store `seatingPlanRevisionId: null`.

## 4. Consumed contracts and emitted events

| Provider          | Contract                                  | Use                                                        |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------- |
| identity-access   | actor/access resolution                   | Require current `FULL` Couple access.                      |
| booking-lifecycle | confirmed event/access readers            | Confirm deposit and snapshot event/timeline context.       |
| payments-billing  | `BookingChargeRegistrar`, `BillingReader` | Register frozen charge; never compute receivables locally. |
| core-platform     | private storage and AI-image boundary     | Validate assets and isolate generated content.             |

It emits `invitation.publication-changed`, `invitation.print-quotation-issued`,
`invitation.print-order-approved`, and `invitation.print-order-ready` v1. Approval
includes the returned immutable `receivableChargeId` and is emitted only after charge
registration or durable reconciliation prevents duplicate registration.

## 5. Authorization and HTTP contract

Managers manage template library, quote/fulfilment, and authorized media operations.
Full Couple users manage only their confirmed booking's media/designs, print requests,
and current-quote approval. Restricted prospects, Staff, public viewers, and QR holders
cannot read private assets or mutate invitation/print records.

Specified resources are `/bookings/{bookingId}/media`, `/bookings/{bookingId}/invitations`,
`/public/invitations/{publicSlug}`, `/bookings/{bookingId}/print-orders`, and Manager
quote/fulfilment actions. External writes require strict schemas, expected revision, and
`Idempotency-Key`. Public outputs omit private library media IDs/URLs, guest data, operations, billing,
and audit data.

## 6. Race, safety, and acceptance

- Upload verifies allowlisted type/content/size/dimensions, generates private keys, and
  keeps prior content if replacement fails.
- Publish/edit and requote/approval compare exact revisions; one winner means no mixed
  printable or commercial snapshot.
- Approval atomically freezes all lines then registers the charge; retry replays or
  reconciles the recorded pending effect.
- Audit publication, media lifecycle, generation, quote, approval, production,
  handover, cancellation, and denied private access with redacted metadata.

Acceptance covers MED/PRN/QRC, QR isolation, private-media isolation, printable
immutability, charge idempotency, seating-snapshot order, and real booking/billing
integration before completion.

## 7. Media, design, and publication decisions

| Concern         | Approved fixed contract                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media           | JPEG/PNG/WebP only, verified content, at most 25 MiB/file, 1–12,000 pixels per dimension, at most 40 million decoded pixels.                                        |
| Quota           | 100 active original files and 1 GiB active accepted bytes per booking, serialized quota claim.                                                                      |
| Cutoff          | Event start − 72 hours by default; Manager-defined instant is snapshotted as policyRevision before upload. Couple create/replace/delete blocked at or after cutoff. |
| Restaurant use  | Manager can read/download accepted originals after cutoff for agreed use; changing cutoff is explicit audited policy command, not an upload bypass.                 |
| Asset deletion  | Detach/tombstone from mutable library before cutoff; referenced printable/published revisions keep immutable content. No automatic destructive cleanup here.        |
| AI generation   | Prompt text 1–2,000, one image per request, validated private output; no private wedding photo sent to AI under this scope.                                         |
| Design          | Structured allowlisted sections/fields only; no arbitrary script/HTML/SVG/remote URL; text fields 0–2,000 and title 1–120.                                          |
| Public identity | One stable opaque publicInvitationId/slug per booking; all physical variants use the same generic QR.                                                               |
| Publication     | Explicit full-access Couple publication or authorized Manager action; unpublish returns concealed 404 to public reads. Historical printable content remains.        |

Original library keys/URLs are never public. An explicitly selected design image is
published as a separate derived asset with a reviewed safe URL; public response never
exposes the private original/library reference. Rendering must escape text and enforce
asset ownership; a design revision cannot refer to another booking's asset. Published
responses omit recipient names, guest groups, operational notes, and internal audit data.

Design DTO includes `designId, revisionId, revisionNumber, title, textFields, sections,
derivedAssetIds, includesSeating, updatedAt`. Quick App edits accept textFields only
and create a new immutable revision through the same backend command. Public DTO contains
only published titles/text, public event/hall information, approved timeline presentation,
and safe derived assets; it offers no guest RSVP/check-in mutation.

## 8. Print quotation, approval, replacement, and cancellation

| Command                         | Actor / source state                                       | Result and constraint                                                                                               |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Request                         | Own FULL Couple / confirmed booking                        | REQUESTED with 1–20 lines; each design variant belongs to booking, quantity 1–10,000.                               |
| Quote/requote before approval   | Manager / REQUESTED or QUOTED                              | New immutable commercial revision; QUOTED; expiry seven days after quote.                                           |
| Approve                         | Own FULL Couple / QUOTED                                   | Exact quote/revision and non-expired deadline; all printable snapshots plus charge accepted; APPROVED.              |
| Begin production                | Manager / APPROVED                                         | IN_PRODUCTION only after all financial/snapshot reconciliation is complete.                                         |
| Ready                           | Manager / IN_PRODUCTION                                    | READY_FOR_HANDOVER with timestamp.                                                                                  |
| Handover                        | Manager / READY_FOR_HANDOVER                               | HANDED_OVER with evidenceReference 1–120 and timestamp.                                                             |
| Cancel request/quote            | Couple own order or Manager / REQUESTED or QUOTED          | CANCELLED; no charge exists.                                                                                        |
| Cancel approved                 | Manager / APPROVED, before production                      | Couple-confirmed cancellation intent, reason and credit adjustment; CANCELLED only after billing credit acceptance. |
| Requote after approval          | Manager + new Couple approval / APPROVED before production | Separate replacement proposal; old accepted revision remains effective until atomic replacement.                    |
| Correct after production starts | New order and explicit new quote/approval                  | Prior produced/handed-over history never changes; cost is visible as a separate order.                              |

A quoted line stores `lineId, designRevisionId, quantity, unitPriceVnd, lineTotalVnd`.
Unit price is positive integer VND up to 1,000,000 per copy. Server calculates
`lineTotalVnd = quantity × unitPriceVnd` and `orderTotalVnd = sum(lineTotalVnd)`;
checked arithmetic and total bound 1,000,000,000,000. Quote stores estimated completion/
handover instant and `expiresAt`; both must be after quote time. No recipient name or
per-recipient token can enter line input, printable DTO, QR data, or render output.

Approval snapshots each line's latest exact approved design choice, effective timeline
through `BookingTimelineSnapshotReader`, highest eligible registered seating content
when included, generic public identity, and commercial revision. Same shared application
transaction serializes timeline effective-pointer changes, seating invalidation, and
quote approval. If any required provider fails, no partial APPROVED state/charge is
visible. Retry uses the same commercial source and snapshot digest.

Replacement accepts a new full charge and a credit for the previous accepted charge
through `BookingChargeAdjustmentRegistrar`; both are atomic or durably pending with
production blocked. Cancellation similarly credits the original charge once. Excess
paid money is visible billing credit; manual refund remains Manager/billing-owned.
Prior printable and commercial records remain immutable after replacement/cancellation.

## 9. Typed HTTP hand-off and stable errors

| Method/path                                                           | Strict input                                                                          | Result                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| POST /bookings/{id}/media                                             | File upload, altText 1–250; no object key                                             | mediaAssetId/revision/safe authorized preview.                                |
| PATCH /bookings/{id}/media/{assetId}                                  | expectedRevision, approved metadata or replacement file                               | New active file version, previous referenced content retained.                |
| DELETE /bookings/{id}/media/{assetId}                                 | expectedRevision                                                                      | Tombstone/detach; before cutoff; durable mutation key.                        |
| POST /bookings/{id}/invitations                                       | design template ID or approved structured content                                     | Design/revision DTO.                                                          |
| POST /bookings/{id}/invitations/{designId}/revisions                  | expectedRevision, textFields/allowlisted sections/assets                              | New immutable revision; App limited to textFields.                            |
| POST /bookings/{id}/invitations/{designId}/publication                | expectedRevision, designRevisionId                                                    | Stable public identity and publishedRevisionId.                               |
| GET /public/invitations/{slug}                                        | Slug only                                                                             | Minimal public DTO, concealed 404 when absent/unpublished.                    |
| POST /bookings/{id}/print-orders                                      | lines[{designId, quantity}]                                                           | REQUESTED DTO/revision, no submitted price.                                   |
| POST /management/print-orders/{orderId}/quotations                    | expectedRevision, prices by line ID, estimatedHandoverAt                              | QUOTED DTO/commercialRevisionId/total/expiresAt.                              |
| POST /bookings/{id}/print-orders/{orderId}/approval                   | expectedRevision, commercialRevisionId                                                | Accepted printable IDs/charge/status.                                         |
| POST /management/print-orders/{orderId}/production, /ready, /handover | expectedRevision; handover evidence when applicable                                   | Allowed state/time/revision only.                                             |
| POST cancellation/replacement action                                  | expectedRevision, exact commercial reference, reason and required Couple confirmation | Audited terminal/replacement result; pending when reconciliations incomplete. |

Errors include `MEDIA_CUTOFF_REACHED`, `MEDIA_QUOTA_EXCEEDED`,
`PRINT_QUOTE_EXPIRED`, `PRINT_QUOTE_STALE`, `PRINTABLE_TIMELINE_NOT_EFFECTIVE`,
`PRINTABLE_SEATING_REQUIRES_REVIEW`, `PRINT_CANCELLATION_NOT_ALLOWED` (409),
upload/schema errors (422), unowned resources (concealed 404), and mandatory provider
unavailable (503). List reads use bounded cursor pages. `InvitationAutomationReader`
and `InvitationReportingReader` are the additive owner ports from baseline Section 21.

## 10. Independent slices and requirement evidence

| Slice                                      | May overlap                                  | Real integration requirement                                                   |
| ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------ |
| Media validation/quota, AI adapter doubles | Payment/booking implementation               | Real confirmed-booking/access and Storage adapter contract.                    |
| Design/editor/public DTO                   | Billing and guest development                | Implemented committed public API before client network integration.            |
| Registry/equal-revision precedence         | Seating pure rules via shared fixtures       | Application unit-of-work and same-booking rollback/race tests.                 |
| Print arithmetic/lifecycle/replacement     | Billing ledger via conforming registrar fake | Actual billing charge/credit and approved timeline snapshot before production. |
| Print acceptance                           | No fake-only closure                         | PostgreSQL quote/edit/invalidation races + real providers.                     |

Proposed waves: media gate/storage/quota; structured design and templates/AI;
publication/public QR; printable registry/snapshot boundary; quote/approval/credit;
HTTP/OpenAPI; Web/App/Manager slices; acceptance (eight).

| Requirements         | Focused proof                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| MED-001–006          | Restricted/other-booking denial, validated upload, cutoff boundary, quota race, originals download, explicit derived publication. |
| PRN-001–003          | Multi-variant quantities, quote totals/expiry/handover; server rejects submitted totals.                                          |
| PRN-004/005          | Snapshot digest stays identical after design/timeline/seating changes; same-revision invalidation wins both orders.               |
| PRN-007/009          | Every actor/state transition, cancellation credit, new quote approval, rollback/retry/replacement.                                |
| PRN-008; QRC-001–004 | Render has no recipient name and all variants share one generic QR; public cannot RSVP/check-in.                                  |

New seating registrations include the optional 1.1.0 `validityProof` field.
Print approval rechecks current booking headcount/revision and venue active eligibility
through the additive upstream ports in baseline Section 21.10, under the booking unit-of-work.
A pending invalidation event cannot make an out-of-range snapshot valid for printing.
Venue eligibility reads hold the lifecycle shared lock until snapshot approval commits;
a concurrent retirement cannot slip between checking eligibility and accepting the charge.
The accepted venue eligibility dependency is explicit; no live seating read is introduced.

## 11. Approved print-file output follow-up (2026-10-08)

The project owner schedules print-file output after SPEC-05 implementation acceptance.
This module retains ownership of approved-revision preview, generated print files,
and authorized download for restaurant printing. The follow-up plan must specify file
format, physical dimensions, front/back arrangement, fonts, image quality, QR readability,
and exact printable revision identity before implementation.

Render the accepted immutable snapshot and its retained assets, not the latest mutable
design, timeline, or seating plan. No recipient name or personalized credential enters
the output; all variants retain the booking's generic QR. Private originals remain
authorized-only. Verify file preview/download, snapshot fidelity after later edits,
and QR readability with representative generated files.

Output without seating can complete after SPEC-05. Seating-inclusive output requires
real accepted SPEC-07 snapshot integration; conforming registry fakes cannot close it.
See [plan Section 21](./tasks/plan.md#21-approved-product-completion-sequence-2026-10-08)
for the approved product completion sequence. Detailed output contracts and tasks
remain follow-up work rather than a claim of implementation acceptance.
