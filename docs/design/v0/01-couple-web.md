# v0 prompt — wedding-web

Read the shared foundation first. Create a responsive Vietnamese Couple/public Web prototype, suitable for subsequent integration into the existing Next.js/TypeScript repository. Do not replace its working authentication routes or API wrapper. No backend implementation is requested here.

## Art direction

The private workspace should feel like an elegant planning notebook, not a generic analytics dashboard. Pressed-ivory pages, generous whitespace, forest navigation, precise ruled sections and a single warm wedding image where relevant. Public invitation is emotional and photo-led; private editing screens are clear and functional. All Vietnamese typography is Be Vietnam Pro. Latin wordmark only may use Lora.

Desktop editorial header with compact booking context and task navigation; a secondary workspace navigation only where needed. Mobile uses a real navigation menu and stacked content, not tiny desktop tabs. Dense guest/order screens may use tables with prioritized mobile rows. Each page needs an obvious next action.

## Build sequence

First build W07, W09–W15 and W20 as the SPEC-05 vertical slice, with clickable navigation. Then add W03–W06/W08/W22, followed by W16–W19/W21. Treat planned modules as prototype fixtures, not implemented endpoints. W01/W02 can be public entry/detail pages of the same brand family.

## SPEC-05 screens and behavior

Wedding overview: couple names, actual event/hall/timeline fixture and outstanding action such as reviewing a quotation. No invented productivity score, SaaS growth metrics or fabricated completion percentage.

Private media: gallery, visible current file count/accepted-byte quota and explicit cutoff. Input accepts JPEG/PNG/WebP; 25 MiB per file; maximum 100 active originals and 1 GiB accepted active bytes. Loading, validation failure, replace-before-cutoff and detach/tombstone confirmation. Preserve referenced history. Manager-approved cutoff exceptions are distinct from a Couple upload bypass. No crop/retouch suite or public album. Show a real interactive mock file selection path, not a decorative upload button.

Template/variant selection: preview templates and named variants. Full Web editor uses structured allowlisted fields/sections with editable text, safe selected derived images and a responsive preview. Desktop workspace: narrow template/section rail, large invitation preview, compact editing inspector. Mobile editor stacks into section-specific steps/sheets. No arbitrary HTML/SVG/JavaScript/custom remote URL input. Saving has current revision, stale-edit resolution and success feedback.

AI: background-generation panel with labeled prompt 1–2000 characters, one image per request, generating/error/result states and explicit selection into the design. No private wedding photograph is transmitted to AI. Do not put a media UUID in the success headline.

Publication: choose exact design revision; show public preview, publish/unpublish confirmation and persistent publication status/revision after reload. Show generic link and an actual QR preview fixture. Copy/share interactions work. Unpublish leaves historical printable content intact. All design variants share the same generic wedding QR. Do not print recipient names or show RSVP/check-in actions on the generic public page.

Print request: 1–20 variant lines, quantity 1–10,000 each. Quantity by line and variant thumbnails. Couple never enters prices. Detail shows exact commercial revision, per-line quantity/unit price/total, backend-provided order total, expiry and estimated handover. Seven-day quotation validity; expired/stale approval must be visible. Review frozen printable content before approving. APPROVED means approved, not already producing.

Timeline of order states: Đã gửi yêu cầu / Đã báo giá / Đã duyệt / Đang sản xuất / Sẵn sàng bàn giao / Đã bàn giao / Đã hủy. Preserve accepted snapshot/history when live design changes. Show replacement proposal as separate from the effective accepted quote until renewed approval. For approved cancellation show Couple confirmation/reason and pending Manager/billing processing; do not suggest an automatic refund. After production, correction requires a new explicitly priced order.

Public invitation: framed intentional image, couple title, public event/hall facts, approved timeline and selected safe derived assets. Strong rhythm with asymmetric photo/text and narrow readable sections; no generic dashboard chrome, private photo library, guest data, financial data or RSVP from a generic QR. Concealed unavailable/unpublished state.

## Remaining product screens

Restricted workspace before deposit: proposal/timeline only and permitted deposit entry when both parties approved the same revision. Empty/payment-disabled reason states. Do not expose media, guest list, seating or print editing before FULL promotion. Timeline edits invalidate new-revision approvals; effective post-deposit timeline remains until replacement approval. Show this clearly.

Guest households: one row is a party/family, not one person. Representative name, optional contact, group, positive expected count and optional private note. Groups localized as Cha mẹ, Nhà trai, Nhà gái, Bạn bè; custom name/color and archival. No companion names required. Personalized link preview/sharing is distinct from generic QR. RSVP contributions: PENDING uses expected count, ACCEPTED uses responding count, DECLINED/archived contributes zero. Guest RSVP screen accepts attending/not attending and count, shows deadline/expired link, and does not expose phone/notes/billing/group list. Manager owns audited deadline policy.

Seating: compatible fixed restaurant layouts; allow group/color labels on existing tables. No movable geometry, per-person seat assignment or individual table reservation. Out-of-range plan remains visible but cannot be confirmed without compatible replacement or Manager exception.

Billing: show accepted charges, proven settled payments, actual manual refunds, outstanding and available credit with clear distinctions; quotation is not a charge. Invoice is not proof of payment. Pending/unknown callback outcome remains pending until authoritative verification.

## Prototype acceptance

Responsive 1440/768/390px, accessible keyboard/focus, realistic Vietnamese and ≥44px controls. Build loading/empty/denied/error/stale/cutoff/expired states alongside the happy path. Use local fixtures and functioning simulated handlers with an explicit prototype badge. Save no secret or real household contact. Return preview/code plus concise screen-ID coverage; do not claim complete production APIs or payment integration.
