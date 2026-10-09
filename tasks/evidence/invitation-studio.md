# Invitation Studio Acceptance Evidence (SPEC-05 Waves 1–7)

Audit date: 2026-10-09 (Asia/Saigon)

Scope:
- `wedding-be`: Modules `invitation-studio`, `payments-billing`, Core Platform, and API Registry
- `wedding-web`: Couple and Public Invitation features under `src/features/invitation-studio/` and routes `app/(couple)/invitations/` & `app/(public)/invitation/[slug]/`
- `wedding-manage-web`: Manager Invitation and Template management features under `src/features/invitation-studio/` and route `app/invitations/`
- `wedding-app`: Mobile Couple Invitation Quick-Edit features under `src/features/invitation-studio/` and screen `src/screens/invitation-quick-edit-screen.tsx`

Status: **PROVIDER_READY & CLIENT_FEATURE_VERIFIED** (Contract extensions pending final PR review)

---

## 1. Requirement Traceability Matrix (SPEC-05 Đợt 1–7)

| Requirement ID | Specification Source | Code / API / UI Implementation | Verification & Tests | Status |
| :--- | :--- | :--- | :--- | :--- |
| **MED-001** (Original Upload) | SPEC-invitation-studio §1, §6; Baseline §21.4 | `media.service.ts`, `media.router.ts`, POST `/api/v1/bookings/:bookingId/invitations/media` | `media.service.test.ts`, `media.router.test.ts`, `media-native-providers.test.ts` | **PASS** |
| **MED-002** (Media Metadata) | SPEC-invitation-studio §6; Baseline §21.4 | `media-policy.ts`, `sharp-media.inspector.ts`, Content-addressed storage SHA-256 | `sharp-media.inspector.test.ts`, `storage-read.test.ts` | **PASS** |
| **MED-003** (Quota & Quota Lock) | SPEC-invitation-studio §6; 100 files, 1 GiB active quota | `media.service.ts` (serialized active quota in UoW advisory lock) | `media.service.test.ts` (101 concurrent uploads serialize to exactly 100) | **PASS** |
| **MED-004** (Cutoff Enforcement) | SPEC-invitation-studio §6; Cutoff -72h before event start | `media-event-start.reader.ts`, `media.service.ts`, `PrismaAutomationReader` | `media-event-start.reader.test.ts`, `prisma-automation.reader.test.ts` | **PASS** |
| **MED-005** (Private Access & URLs) | SPEC-invitation-studio §6; 15-minute (900s) private signed URLs | `media-access.guard.ts`, `fake-storage-provider.ts`, `supabase-storage-provider.ts` | `media-access.guard.test.ts`, `storage-provider.test.ts` | **PASS** |
| **MED-006** (Replacement & Tombstone) | SPEC-invitation-studio §6; Retain historical originals, no auto-delete | `media.service.ts`, `PrismaInvitationStudioRepository` | `media.service.test.ts`, `media-persistence.test.ts` | **PASS** |
| **DES-001** (Template Lifecycle) | SPEC-invitation-studio §2, §7; Baseline §21.4 | `template.service.ts`, `templates.router.ts`, Manager Web `manager-invitation-view.tsx` | `studio-waves.test.ts`, `manager-invitation-view.test.tsx` | **PASS** |
| **DES-002** (Design CAS & Revisions) | SPEC-invitation-studio §2; CAS with expectedRevision | `design.service.ts`, `designs.router.ts`, Web `invitation-studio-view.tsx` | `studio-waves.test.ts`, `invitation-studio-view.test.tsx` | **PASS** |
| **DES-003** (Mobile Text-Only Edit) | SPEC-invitation-studio §2, §7; Mobile bounded text update | `design.service.ts`, `invitation-quick-edit-screen.tsx`, `app-invitation-api.ts` | `invitation-quick-edit-screen.test.tsx`, `app-invitation-api.test.ts` | **PASS** |
| **DES-004** (AI Background Assist) | SPEC-invitation-studio §2, §9; 2000 chars prompt, private output | `ai-image.service.ts`, Gemini client, `wedding-web` AI generation dialog | `ai-image-provider.test.ts`, `invitation-api.test.ts` | **PASS** |
| **QRC-001** (Public Invitation) | SPEC-invitation-studio §3; Opaque slug, Forest/Sage/Ivory theme | `publication.service.ts`, `publications.router.ts`, `app/(public)/invitation/[slug]` | `publication.events.test.ts`, `app-smoke.test.tsx` | **PASS** |
| **QRC-002** (Generic Public QR) | SPEC-invitation-studio §3; Scalable QR code generation | `qr.service.ts`, `qrcode` 1.5.4 dependency | `studio-waves.test.ts` | **PASS** |
| **QRC-003** (Publication Lifecycle) | SPEC-invitation-studio §3; Explicit publish/unpublish | `publication.service.ts`, transactional outbox events | `publication.events.test.ts`, `studio-waves.test.ts` | **PASS** |
| **QRC-004** (Public Asset Security) | SPEC-invitation-studio §3; No private storage key exposure | `publication.service.ts`, minimal public DTO, sanitized HTML | `invitation-media-openapi.test.ts` | **PASS** |
| **PRN-001** (Printable Capture) | SPEC-invitation-studio §4; Frozen readonly render snapshot | `printable.service.ts`, `registry-conformance.test.ts` | `registry-conformance.test.ts` (9/9 consumer double tests pass) | **PASS** |
| **PRN-002** (Order Lifecycle) | SPEC-invitation-studio §4, §8; 7 lifecycle states | `print-policy.ts`, `print-order.service.ts`, `print-orders.router.ts` | `print-policy.test.ts`, `print-order-native.test.ts` | **PASS** |
| **PRN-003** (Quotation & Expiry) | SPEC-invitation-studio §4; 7-day quote validity | `print-order.service.ts`, `manager-invitation-view.tsx` | `print-policy.test.ts`, `manager-invitation-view.test.tsx` | **PASS** |
| **PRN-004** (Approval & Billing) | SPEC-invitation-studio §4; Register accepted charge in billing | `print-order.service.ts`, `prisma-billing.adapter.ts` | `print-order-native.test.ts`, `studio-waves.test.ts` | **PASS** |
| **PRN-005** (Cancellation with Reason) | SPEC-invitation-studio §4, §8; Mandatory reason for approved | `print-policy.ts`, `print-order.service.ts`, Couple confirmation | `print-policy.test.ts`, `print-order-native.test.ts` | **PASS** |
| **PRN-006** (Replacement Proposal) | SPEC-invitation-studio §4, §8; Manager propose -> Couple approve | `print-order.service.ts`, `PrintOrderView.pendingReplacementProposal` | `print-order-native.test.ts`, `invitation-studio-view.test.tsx` | **PASS** |
| **PRN-007** (Production & Handover) | SPEC-invitation-studio §4; Separate IN_PRODUCTION and HANDED_OVER | `print-order.service.ts`, `manager-invitation-api.ts`, Manager UI | `print-order-native.test.ts`, `manager-invitation-view.test.tsx` | **PASS** |
| **PRN-008** (Reporting Projections) | SPEC-invitation-studio §4, §8; Baseline §21.5 | `prisma-reporting.reader.ts`, monotonic sequence & fence | `prisma-reporting.reader.test.ts` | **PASS** |
| **PRN-009** (Automation Cutoff) | SPEC-invitation-studio §4, §8; Baseline §21.6 | `prisma-automation.reader.ts`, drop fake zero-UUIDs, check eligibility | `prisma-automation.reader.test.ts` | **PASS** |

---

## 2. Detailed Audit and Defect Resolution Record

### Đợt 5: Print Orders, Idempotency, Billing & Replacement Flow
1. **Idempotency Fingerprint & Command Replay:**
   - *Previous state:* The command digest only hashed the request body payload, allowing unintended cross-action replays.
   - *Fix applied:* In `src/modules/invitation-studio/infrastructure/studio.repository.ts`, `command<T>()` now binds `action`, `resourceId`, `actorId`, `bookingId`, and `payload`:
     - `intentDigest = digest({ actorId: context.actorId, action, key })`
     - `commandDigest = digest({ bookingId, actorId: context.actorId, action, resourceId, payload })`
   - *Evidence:* Exact command replay succeeds; mismatched action or resource returns 422 `IDEMPOTENCY_KEY_REUSED`.
2. **Replacement Proposal Lifecycle:**
   - *Previous state:* Replacement proposal did not surface `pendingReplacementProposal` in `PrintOrderView` for Couple review.
   - *Fix applied:* Added `pendingReplacementProposal: CommercialRevisionView | null` to `PrintOrderView` and schemas. Handled expiry (7-day validity), status transition, and preservation of commercial/printable revision history.
   - *Evidence:* Verified in `print-order.contracts.ts`, `print-orders.schemas.ts`, `print-order.service.ts`, and frontend client tests.
3. **Cancellation of Approved Orders:**
   - *Previous state:* Cancellation allowed empty reasons on `APPROVED` orders.
   - *Fix applied:* In `print-policy.ts` and `print-order.service.ts`, enforced non-empty `reason` (`safeText(500, 1)`) and required explicit Couple intent.
   - *Evidence:* Unit test `cancellationIntentBodySchema` verifies validation failure on blank reasons.
4. **Payments/Billing Contract Separation:**
   - *Previous state:* Credit adjustments were conflated with refunds (`refundedVnd`).
   - *Fix applied:* In `src/modules/payments-billing/infrastructure/prisma-billing.adapter.ts`:
     - `acceptedChargesVnd` = `grossChargesVnd - creditVnd` (net charges).
     - `refundedVnd` reflects only actual cash refunds, completely separate from credit adjustments.
     - `outstandingVnd` = `max(0, netChargesVnd - paidVnd)`.
5. **Credit Replay Verification:**
   - *Previous state:* Credit replay did not verify field-level equivalence.
   - *Fix applied:* `registerCredit` verifies exact match of `bookingId`, `receivableChargeId`, `amountVnd`, and `reason`. Any discrepancy throws 409 `CREDIT_SOURCE_CONFLICT`, preventing duplicate credit recording.
6. **Print Order Pagination & Authorization:**
   - *Previous state:* Missing schema validation and cursor pagination.
   - *Fix applied:* Added `printOrderListQuerySchema` with `limit` (1..100) and `cursor`. Implemented cursor pagination with deterministic tie-breaker `[createdAt: desc, id: desc]`.

---

### Đợt 6: Reporting Projections, Automation & Port Conformance
1. **Reporting Monotonic Sequence & Fence:**
   - *Previous state:* Used mutable `updatedAt` as chronological sequence.
   - *Fix applied:* In `prisma-reporting.reader.ts`, projections use monotonic audit log sequence `seq`, respect `throughSequence` fence, and bind pagination cursors to `(seq, id)`.
2. **Real `approvedAt` Timestamp:**
   - *Previous state:* `approvedAt` fell back to `order.updatedAt`.
   - *Fix applied:* `approvedAt` is resolved from immutable audit log `invitation.print-order-approved`, remaining stable across subsequent status transitions (`IN_PRODUCTION`, `HANDED_OVER`).
3. **Authority & SYSTEM Purpose Allowlist:**
   - *Previous state:* Missing purpose checks on `SYSTEM` authority calls.
   - *Fix applied:* Enforced `reporting:invitation-studio` in `prisma-reporting.reader.ts` and `automation:media-cutoff` in `prisma-automation.reader.ts`.
4. **Automation Cutoff Exclusion of Invalid Recipients:**
   - *Previous state:* Generated fake UUID `'00000000-0000-0000-0000-000000000000'` when Couple account was missing.
   - *Fix applied:* Dropped dummy UUIDs; only bookings with confirmed Couple accounts and valid status are returned.
5. **Port Conformance Testing:**
   - *Previous state:* Missing conformance verification on printable seating ports.
   - *Fix applied:* `tests/integration/invitation-studio/registry-conformance.test.ts` executes 9 consumer-double tests covering frozen snapshots, dependency faults, immutable replay, and high-water invalidations.

---

### Đợt 7: Client Applications & UI Flows (`wedding-web`, `wedding-manage-web`, `wedding-app`)
1. **Session & Booking Binding:**
   - Connected `WebIdentitySession` in `wedding-web/app/(couple)/invitations/page.tsx`.
   - Connected `ManagementIdentitySession` in `wedding-manage-web/app/invitations/page.tsx`.
   - Connected `AndroidIdentitySession` in `wedding-app/src/app/(couple)/invitation.tsx`.
2. **Media Upload Integration:**
   - Wired file input directly to `gateway.uploadMedia` via multipart form upload, handling progress, previews, and error toasts.
3. **Manager Template Management:**
   - Added full template creation, JSON canvas edit, publication, and archival in `wedding-manage-web/src/features/invitation-studio/manager-invitation-view.tsx`.
4. **Slug & Publication Revision:**
   - Client views now consume the backend-generated `publicSlug` from publication responses instead of fallback `bookingId`.
5. **AI Generation DTO & Limits:**
   - Fixed DTO field to `mediaAssetId` (replacing legacy `assetId`).
   - Extended prompt limit to 2,000 characters per specification.
6. **Idempotency Key Preservation:**
   - Mutation helpers retain original `Idempotency-Key` across network retries, preventing duplicate order or AI generation triggers.
7. **Production Handover DTO:**
   - Removed obsolete `handedOverAt` from `manager-invitation-api.ts`; request body strictly adheres to `{ expectedRevision, evidenceReference }`.
8. **Design System & UX Standards:**
   - Public invitation page styled with approved palette: Forest Green (`#1e3a2f`), Sage (`#879883`), Ivory (`#fdfbf7`), Champagne Gold (`#d4af37`).
   - Clear visual distinction between `APPROVED` ("Đã Phê Duyệt") and `IN_PRODUCTION` ("Đang Sản Xuất").

---

## 3. Contract Lock & OpenAPI Verification

1. **Client API Contract Lock:**
   - In `wedding-web`, `wedding-manage-web`, and `wedding-app`, `api-contract.lock.json` is fully synchronized with `wedding-be`:
     - `commit`: `6bb247bd6fd7e979a64f929f4a0495ea7c5a3de2`
     - `sha256`: `a42c4672c7d4c5fa75328d3e3520da9146ba66ff1491842ed7c764cb1bb9b824`
   - Generated TypeScript interfaces (`schema.d.ts`) were generated directly via `npm run api:generate` with zero drift.
2. **Backend OpenAPI Artifact:**
   - Deterministically generated via `npm run api:generate` (89 paths registered).
   - Validated via `npm run api:check` with zero drift across all 4 repositories.

---

## 4. Test Suite Execution Summary

| Repository | Quality Gate | Command | Output & Status |
| :--- | :--- | :--- | :--- |
| `wedding-be` | Unit Test Suite | `npm run test:unit` | **63 test files passed, 786 tests passed** (0 failures) |
| `wedding-be` | Contract Tests | `npm run test:contract` | **7 test files passed, 23 tests passed** (0 failures) |
| `wedding-be` | Typecheck | `npm run typecheck` | **0 errors** |
| `wedding-be` | ESLint | `npm run lint` | **0 errors, 0 warnings** (`--max-warnings 0`) |
| `wedding-be` | OpenAPI Check | `npm run api:check` | **0 drift** (SHA-256 byte-for-byte identical) |
| `wedding-be` | Build | `npm run build` | **Clean production compilation** |
| `wedding-web` | Test Suite | `npm test` | **9 test files passed, 58 tests passed** (0 failures) |
| `wedding-web` | Typecheck | `npm run typecheck` | **0 errors** |
| `wedding-web` | ESLint | `npm run lint` | **0 errors, 0 warnings** |
| `wedding-web` | OpenAPI Check | `npm run api:check` | **0 drift** (API schema is current) |
| `wedding-manage-web`| Test Suite | `npm test` | **15 test files passed, 98 tests passed** (0 failures) |
| `wedding-manage-web`| Typecheck | `npm run typecheck` | **0 errors** |
| `wedding-manage-web`| ESLint | `npm run lint` | **0 errors, 0 warnings** |
| `wedding-manage-web`| OpenAPI Check | `npm run api:check` | **0 drift** (API schema is current) |
| `wedding-app` | Jest Test Suite | `npm test` | **5 test suites passed, 35 tests passed** (0 failures) |
| `wedding-app` | Typecheck | `npm run typecheck` | **0 errors** |
| `wedding-app` | ESLint | `npm run lint` | **0 errors, 0 warnings** |
| `wedding-app` | OpenAPI Check | `npm run api:check` | **0 drift** (API schema is current) |

---

## 5. Outstanding Work & Scope Boundaries

1. **Downstream SPEC-06 (Guest RSVP):**
   - No SPEC-06 household invitation, guest capability token, or RSVP ingestion logic was implemented. Scope was strictly limited to SPEC-05 (Invitation Studio) and necessary cross-boundary ports.
2. **Formal Pull Request & Commit Pin:**
   - Branch `huy/spec-05-06` working tree contains the full verified implementation. Upon PR merge to main, client locks will be repinned to the immutable merged commit SHA.
3. **Database Environment Safety:**
   - Shared/production databases were not touched. All migrations and integration tests run exclusively on disposable local PostgreSQL.
