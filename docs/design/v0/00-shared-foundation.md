# Common brief — prepend to each v0 project

Build a polished, Vietnamese-language, interactive Wedding Management prototype for a single restaurant. Follow the specified product roles and workflow, not a generic wedding SaaS dashboard. Use fictional demonstration data only. This is a UI prototype: never pretend that simulated payment, upload, delivery, or API operations are production functionality.

## Authoritative visual system

Theme: a cultivated garden estate, pressed paper, architectural framing, laurel greens, restrained antique champagne. Warm, tactile, editorial and useful. No generic AI-generated dashboard aesthetic.

Define reusable semantic tokens:

```css
:root {
  --canvas: #FAF8F5;
  --surface: #FFFFFF;
  --surface-muted: #F3EFEA;
  --primary: #334537;
  --primary-pressed: #243B2A;
  --brand-sage: #4A5D4E;
  --champagne: #C5A880;
  --earth: #8C6D62;
  --text: #232321;
  --text-muted: #62645F;
  --rule: rgba(74, 93, 78, .12);
  --rule-premium: rgba(197, 168, 128, .35);
}
```

Dark mode where applicable: canvas `#1C211D`, surface `#28312A`, text `#F7F3EC`, muted `#C9CDC6`, action `#B7CCB9`, champagne `#E0C298`. Semantic success/warning/error colors must be accessible and accompanied by text, not invented brand colors for decoration.

All Vietnamese display headings, body, labels, navigation and data use Be Vietnam Pro 400–600 with Segoe UI/Arial fallback. Lora is allowed ONLY for a Latin wordmark such as “Wedding”, not Vietnamese names or headings. Do not use text-transform uppercase or letter-spacing on Vietnamese. Preserve diacritics, NFC, font kerning and ligatures. Check “quyết định”, “tiếp tục”, “kế hoạch”, “đầy đủ”.

Web radius 2–4px. Android ergonomics permit 4–12px. Hairline dividers and tonal panels, not floating stacks of cards. Round avatars/counters/status indicators only where useful. Tiny champagne details; no gold blocks behind small text. Shadows rare and diffuse. No gradient blobs, glassmorphism, blue-purple SaaS chrome, script fonts, emoji decoration, huge pill buttons or a repetitive grid of three metric cards.

Desktop fluid 12-column grid, max 1380px, roughly 64px outer margins and 32px gutters. Mobile 24px margins and 16px gutters; dense screens may adapt sensibly. 4/8-point spacing rhythm. Use scale and whitespace for hierarchy. Vietnamese body 15/24 or 18/28, labels 13/18. Never shrink operational data to create density.

Buttons use estate forest with ivory text; keep authored Vietnamese sentence case. Focus must be visible. Targets ≥44px. Semantic HTML, landmarks, labels, keyboard navigation, live regions and reduced-motion handling. Do not claim WCAG conformance merely because colors look good; inspect rendered contrast.

Photography: one intentional, warm, framed wedding/venue photograph where it helps the task; no decoration-only photo in operational tables. Prototype photographs must be replaceable and clearly identified in handoff. Do not copy a third-party venue logo, protected brand assets or its wording.

## Product and interaction rules

- All money displays integer VND using Vietnamese formatting, dates use restaurant business time Asia/Ho_Chi_Minh. Sample amounts come from coherent fixtures, not imaginary growth percentages.
- Backend is the authority for access, eligibility, timeline approvals, money, transitions, seating compatibility and check-in. UI shows the returned state and a reason when unavailable.
- After deposit, access promotion preserves the same identity. Restricted users get only permitted proposal/timeline and deposit actions. Android is post-deposit FULL Couple only.
- UI must include loading, empty, retryable error, denied, expired, stale revision and success states where reachable. Prevent double submission; show unknown outcomes without inviting a duplicate financial action.
- Mock adapters may support the prototype, but label them as demonstration; do not invent working endpoints. Keep components and business actions separated so approved API contracts can be integrated later.
- Use realistic Vietnamese copy, not lorem ipsum, English admin labels, fake statistical trends, unexplained numbers or technical identifiers as primary UI instructions.

## Non-negotiable boundaries

No multi-tenant/multi-restaurant features. No automatic VNPay refund. No public wedding-photo library. No photo-editing suite. No per-person seat assignment. Couple cannot alter table geometry/capacity. Physical invitation has no printed recipient name and one generic QR per wedding; generic QR does NOT RSVP, identify guests or check them in. Personalized RSVP link is separate. Staff check-in is household name search with multiple arrivals, not QR scanning.

Build a responsive, clickable prototype with coherent sample state, not static screenshots or dead buttons. Do not deploy publicly, request secrets, change access permissions or connect to production services as part of generation.
