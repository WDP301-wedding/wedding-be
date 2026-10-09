# Specification: Invitation Studio

- Status: **Approved specification — module plan and implementation acceptance pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `invitation-studio` (`SPEC-05`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
- Initial owner role: B (member name to be assigned)
- W1 backend status: **Implementation and verification complete**, 2026-10-09; checklist and limits in Section11. W2–W4 backend/API checkpoints are recorded in Sections13–14; formal integration and whole-module acceptance remain pending.
- Media HTTP status: **Mounted at `/api/v1`**, 2026-10-09, after the user's subsequent API wiring request; transport scope in Section12. Other W6 work remains pending.
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

## 11. W1 backend implementation checkpoint — 2026-10-09

This records implementation progress against Sections1/4–7/9–10, MED-001…006,
ACC-004, baseline6.3/6.4/21.1/21.2/21.8 and the team/migration rules. It does not
change approved contracts or accept the complete module. The user authorized W1
implementation, completion and marking verified tasks.

- [x] Private originals, immutable file/metadata revisions, accepted checksum/type/bytes/dimensions, policy/cutoff snapshots and retained history; no persisted signed URL or bearer.
- [x] Full JPEG/PNG/WebP decoding;25MiB/file, dimensions1–12000,40million decoded pixels including animation frames, altText1–250, server-generated keys and bounded decoder work.
- [x] Serialized active quota100 files/1GiB, replacement subtraction, failed replacement preservation, CAS, pending409, different-body422 and durable replay/rollback recovery.
- [x] Default event start−72h from the approved effective restaurant-local timeline; exact cutoff boundaries, explicit Manager cutoff command with before/after audit and authorized originals after cutoff.
- [x] Current account/session/role/FULL-own-consultation/CONFIRMED checks with matching persisted settlement; Staff/restricted/public/unowned/revoked/disabled denial and private900-second signed reads.
- [x] PostgreSQL acceptance, immutable facts, independently committed pre-upload journal/intent, bounded working sets, repeatable recovery sweeps, exact byte/count quota and populated migration/backfill proof.
- [x] Native owner-read composition/shared Core transaction; scope forgery, access/state/effective-timeline races and outer-owner rollback tested; strict multipart factory keeps global1MiB JSON/security limits.

| Requirement/source                | W1 executable evidence                                                                                                                                                            | Work retained in later waves                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| MED-001; ACC-004; baseline6.3/6.4 | Native Booking/timeline/Identity/deposit readers and `tests/integration/invitation-studio/media-native-providers.test.ts`                                                         | Complete upstream settlement verification/confirmation/FULL-promotion journey before module acceptance. |
| MED-002; SPEC§7 quota/cutoff      | `media.service.test.ts`, `media-persistence.test.ts` and native provider tests: concurrent count/byte claims, exact1GiB/+1 byte, CAS, cutoff and rollback.                        | Multi-upload client UI in W7; external transport publication in W6.                                     |
| MED-003                           | Authorized original signed reads; native Manager read after cutoff; retained accepted bytes without re-encoding.                                                                  | Public runtime list/download DTO/API hand-off in W6; restaurant UI in W7.                               |
| MED-004                           | Private object purpose/keys,900-second reads, redacted persistence, no automatic original publication.                                                                            | Explicit separate derived publication in W3.                                                            |
| MED-005                           | `sharp-media.inspector.test.ts`, service/storage/router tests: full decoding, malformed/truncated/MIME/size/dimension/frame/key boundaries.                                       | Publish reviewed transport/OpenAPI in W6.                                                               |
| MED-006                           | Tombstone/history and cutoff controls; no photo editor/public album/unrestricted mutation introduced.                                                                             | No additional W1 feature required.                                                                      |
| baseline21.1/21.2/21.8; team§5    | Core/Identity scope/reference tests and native PostgreSQL denial/race/rollback tests.                                                                                             | Other Guest/seating/print/outbox owner adapters and formal provider checkpoint.                         |
| Core/migration/quality rules      | Full89 files/865 tests,137 W1/prerequisite tests; coverage97.16% lines/92.87% branches, per-file80%; typecheck/build/lint/format/API/audit and empty/populated migrations passed. | Exact reviewed commit/API/client pins and whole-module/release gates.                                   |

Source implementation is in `src/modules/invitation-studio/`; native prerequisites
are owner-local Booking/Payments/Identity adapters and `src/core/database/booking-boundary.ts`.
The Storage proof runs the production Supabase adapter against a controlled SDK,
not live Supabase. Native owner facts in tests are fixtures, not payment acceptance
or a production seed. The subsequent media HTTP wiring is recorded in Section12.

Current tracking: [todo B-EXEC](./tasks/todo.md#b-exec--execution-waves-and-verified-implementation-status),
[plan20.12/20.13](./tasks/plan.md#2013-spec-05-w1-closure-cross-check--2026-10-09),
and [guide14.5/18.7](./docs/spec-05-06-implementation-guide.md).
Earlier plan20.9–20.11/guide18.4–18.6 are historical checkpoints, superseded for
current W1 status. W2–W8, formal PROVIDER_READY/INTEGRATION_READY/ACCEPTED,
SPEC-06 and release remain separate gates.

## 12. Media HTTP server checkpoint — 2026-10-09

The user's subsequent request authorized mounting the completed media commands/read.
`src/server.ts` now registers `InvitationStudioRuntime.router` at `/api/v1`.

| Method | Path under `/api/v1`                            | Result                                                                  |
| ------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| POST   | `/bookings/{bookingId}/media`                   | 201; safe asset DTO and authorized preview path.                        |
| PATCH  | `/bookings/{bookingId}/media/{assetId}`         | 200; JSON metadata or multipart replacement with expectedRevision.      |
| DELETE | `/bookings/{bookingId}/media/{assetId}`         | 200; detach DTO, retained originals/history.                            |
| GET    | `/bookings/{bookingId}/media/{assetId}`         | 200; authorized current original signed URL,900-second expiry/no-store. |
| PATCH  | `/management/bookings/{bookingId}/media-policy` | 200; Manager cutoff revision with before/after audit.                   |

- [x] Native composition/server registration; managed DB shutdown/startup cleanup.
- [x] Strict request/response schemas, current authority/CAS/durable intent and bounded multipart retaining global JSON/security policy.
- [x] Safe asset DTO `mediaAssetId/revision/detachedAt/previewPath`; no internal storage/file/journal fields. Preview path contains no credential; separate GET signs the original.
- [x] Disabled Storage fails503 instead of fake acceptance; native HTTP/PostgreSQL/controlled SDK tests exercise upload/replay/read and unavailable Storage.
- [x] Five operations in deterministic OpenAPI artifact/digest; focused57-test proof at plan20.14.
- [x] Full91 files/875 tests, no skipped database suites; coverage97.24% lines/92.96% branches and per-file80% passed. Typecheck/build/lint/format/API/audit gates passed; disposable PostgreSQL stopped. Current working-tree API digest is recorded in plan20.14.
- [ ] Other W6 endpoints/provider/event/reporting work and reviewed committed API/client pins; whole-module acceptance remains separate.

Current transport gates are recorded in plan20.14 and guide18.8. Earlier W1
checkpoint statements about an unmounted factory are historical after this wiring.

## 13. W2–W4 backend implementation checkpoint — 2026-10-09

The project owner authorized completing all three backend waves. Detailed
implementation/evidence/path decisions are recorded in [plan20.15](./tasks/plan.md#2015-spec-05-w2w4-implementation-and-verification--2026-10-09)
and checked in [todo B-EXEC](./tasks/todo.md#b-exec--execution-waves-and-verified-implementation-status).

- [x] W2: Manager immutable template versions/archive/CAS, own structured design
      revisions, bounded allowlists, authoritative Android session text-only edits and
      offline Gemini generation into the private media library. PENDING unknown effects
      survive rollback and cannot automatically cause another paid generation.
- [x] W3: exact-revision explicit publication, stable booking identity and generic
      QR shared by variants, safe separately derived assets, minimal immutable public
      projection/escaped HTML/QR PNG, concealed unpublication, transactional outbox and
      exact PublicationReader methods. Public/private paths are mounted in the runtime
      and described by the same strict Zod schemas as generated OpenAPI.
- [x] W4: immutable safe geometry/proof registry and printable snapshots; equal
      invalidation wins in both orders/in one transaction, high-water cannot decrease,
      reconfirm requires a higher number, missing historical proof cannot authorize a
      new capture. Native Booking/Venue owner reads retain booking/lifecycle locks through
      commit and validate current count/range/capacity/exception. Captures do not read
      Seating repositories. Fake/native conformance and rollback/retirement proof pass.

`PUBLIC_INVITATION_ORIGIN` configures the stable public HTML/QR origin; missing
configuration disables publication503. Public derivatives are bounded PNGs and remain
in the private bucket; the server exposes only currently published safe opaque URLs.
The additive removal fact is `invitation.unpublished` v1 with required
`bookingId/publicInvitationId/publishedRevisionId/changedAt`; the existing
`invitation.publication-changed` event meaning and required fields remain unchanged.
No personalized credential, recipient name/group, private original/library identifier,
billing or operational field is projected into generic QR/public DTOs.

Full-backend proof:96 files/949 tests on Node24.21.0, no DB suite skipped,
coverage97.30% lines/92.74% branches with per-file80% passed. The final native
runtime/conformance check passes42 tests, including production Gemini/Supabase
adapters with controlled SDKs, print-vs-timeline/headcount locking and no external calls. Seven migrations deploy on
disposable PostgreSQL18 and schema diff is empty. Typecheck/build/lint/generated
API/audit and source-manifest evidence are tracked at plan20.15. These are local
implementation checks; reviewed provider commit, committed client API pins, actual
Seating producer integration, W5 billing/print approval/fulfilment, W6 automation/
reporting, W7 clients and W8 whole-module owner acceptance remain separate.

## 14. W2–W4 re-audit corrections — 2026-10-09

The earlier checkpoint omitted opaque-token prompt filtering, current template-list
reauthorization, template/private HTTP denial audit, readonly registry compatibility,
and a usable AI recovery path. These are corrected; exact APIs and remaining owner
gates are in [W2–W4 hand-off](./docs/spec-05-w2-w4-handoff.md).

There are19 mounted W2–W4 operations, including Manager pending-generation list and
evidenced abandonment. A retry recovers a journaled private image without another
paid AI call; no verified artifact remains pending until explicit reconciliation.
Storage acceptance failure after valid AI output remains recoverable rather than
being classified as a failed generation. Publication events have strict application
schemas. Shared fake/native registry tests cover readonly input, denials, unavailable
and unknown dependency outcomes as well as ordering/replay/proof cases.

Quality evidence and limitations are recorded at plan20.16. A working-tree backend
check is not owner review, consumer pin or actual Seating producer acceptance.
