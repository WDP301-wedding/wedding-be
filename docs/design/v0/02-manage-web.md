# v0 prompt — wedding-manage-web

Read the shared foundation first. Create an operational Vietnamese Manager/Staff Web prototype for one restaurant, compatible in structure with the existing Next.js/TypeScript client. This is a prototype; do not overwrite repository code, connect production services or claim backend authorization from hidden buttons.

## Art direction

Estate forest sidebar, quiet Latin wordmark, pressed-ivory main canvas, alabaster tables, champagne-dust headers, 1px sage rules. Be Vietnam Pro for every Vietnamese title, label and number. Beauty comes from alignment, hierarchy, meaningful data and confident restraint. No oversized marketing hero, KPI card wallpaper, glossy charts, generic blue dashboard or decoration-only stock imagery.

Desktop side navigation grouped by operational jobs: Tiệc cưới, Danh mục, Thiệp và in ấn, Khách mời, Nhân sự và đón khách, Thanh toán, Báo cáo. Staff receives a reduced assigned-event workspace; do not show Manager administration as available to Staff. Compact filters, persistent context, predictable row actions and a detail drawer/full detail page for lengthy tasks. Responsive tables prioritize essential columns and preserve actions at narrow width.

## First build: M09–M14 invitation/printing vertical slice

Print queue with status filters, search and paginated rows: event date/couple/hall, order reference, variants/copies, commercial status, production status, last action. Small meaningful queue counts are derived from sample rows, not random statistics.

Order detail: variant previews, immutable line/design references rendered as friendly labels, quantity by line, accepted quote and proposed replacement separately, history of quote/approval/production/ready/handover/cancel. Put the authorized next action near the relevant state.

Quote drawer/page: unit price per line (integer VND, 1–1,000,000), quantity read-only, calculated display totals from fixture adapter, estimated handover date and seven-day expiry. Requote makes a new commercial revision. No direct “approve on behalf of Couple” button. Use exact quote review state and stale-revision handling.

Approved-order replacement: separate proposal and old accepted price/content, explanation of why renewed Couple approval is needed, pending state that blocks production when appropriate. Cancellation after approval requires Couple-confirmed intent, reason and accepted credit adjustment before cancellation. Explain a credit is not a cash refund. Do not allow cancellation of produced history by a generic destructive action.

Production only from APPROVED after reconciliation; ready only from IN_PRODUCTION; handover only from READY_FOR_HANDOVER with evidenceReference 1–120. Timestamp is returned by the server, not edited in the handover request. Other transitions unavailable with a clear reason. “Đã duyệt” and “Đang sản xuất” are distinct labels.

Template library: visual preview plus operational list, create/edit structured content, revision history and archive confirmation. Inputs are user-friendly field/section controls rather than a giant raw JSON textarea. No arbitrary HTML/SVG/remote scripts.

Wedding originals: select booking, preview accepted private images, download original where authorized, view cutoff/quota and audited cutoff policy change. No public album or upload bypass. Download/preview must have simulated functioning handlers and permission/error states.

## Extend other modules using screen-matrix M01–M22

Consultation/availability: restaurant-local date, hall and LUNCH/DINNER view, temporary holds, consultation, proposal, restricted invite and mutually approved timeline revision. Differentiate deposit eligible from actually settled/confirmed.

Catalog: halls, dishes, versioned menu packages, timeline/layout templates. Manager draft/publish/supersede/retire lifecycle. Published layout geometry belongs to restaurant, immutable history preserved. No multi-tenant settings or Couple layout editor.

Payments: accepted base/print charges, deposit and balance settlements, credits and manual refunds shown separately. Manual evidence/reconciliation/refund with required reason/evidence and amount bound supplied by backend. Pending/unknown outcomes and retry safely. No automatic VNPay refund and no “payment successful” based only on redirect.

Guest import/export: household-based records, representative name, optional phone, group, expected count, private note. Row-safe validation preview before atomic import; show errors without unrelated data. Groups localized and archived rather than destructive deletion. Deadline policy explicit. Avoid inventing import file formats beyond contracts; leave importer adapter configurable until approved schema is used.

Staff experience: assigned events only → household search by name/optional phone disambiguation → show group/color, expected/cumulative actual count and allowed notes → add positive arrival count. Multiple arrivals append, excess warns without blocking. Guidance is guest-group area, not personal seat/table. Correction requires reason and retains ledger/audit. No QR scan/check-in feature, no full phone in broad search results if contract permits only phoneLast4.

Reports: expected vs actual attendance by household/group, fulfillment states and accepted print amounts; net cash revenue, receivables and credit distinctly labeled with source refresh/freshness and time range. Draft quote not revenue. Source unavailable/stale is visible, never zero fabricated data. Provide accessible table alternatives to chart summaries.

Notifications: show only approved provider delivery/status/retry fields. No arbitrary secret-bearing webhook editor, private image attachments or raw token diagnostics.

## Acceptance

Clickable prototype, coherent sample data, no dead row/button controls; explicit demonstration label. Inspect 1440px/768px/390px, table readability, focus and transitions. Loading/empty/denied/stale/dependency error/expired/success/destructive confirmation states. Keep operational timing and money authoritative in adapter responses, not client-invented approval logic. Return screen-ID coverage and preview; do not claim Manager/Staff authorization or backend integration has been implemented by the mock UI.
