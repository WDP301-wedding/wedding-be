# Visual foundation

## Brand character

The system should feel like a cultivated garden estate hosting an intimate celebration: quiet, tactile, romantic, and exceptionally composed. It combines editorial restraint with botanical warmth—pressed-ivory paper, laurel green structure, antique-champagne detail, and architectural image framing.

Avoid clinical white, digital-blue product chrome, generic SaaS gradients, glassmorphism, oversized rounded cards, heavy shadows, loud decorative motifs, and script fonts. Luxury comes from material contrast, whitespace, typography, and intentional imagery rather than ornament.

## Color tokens

Use these semantic roles rather than choosing colors screen by screen.

| Role | Light value | Purpose |
| --- | --- | --- |
| Estate forest | `#334537` | Primary action, active navigation, dark structural bands |
| Deep evergreen | `#243B2A` | Hover/pressed state and the darkest structural surface |
| Laurel sage | `#4A5D4E` | Brand anchor, selected states, botanical emphasis |
| Antique champagne | `#C5A880` | Fine rules, image mattes, premium emphasis, small highlights |
| Earth | `#8C6D62` | Secondary celebratory accent; use sparingly |
| Pressed ivory | `#FAF8F5` | Page canvas and warm base surface |
| Alabaster | `#FFFFFF` | Raised card and form surface |
| Champagne dust | `#F3EFEA` | Muted sections, table headers, quiet panels |
| Soft charcoal | `#232321` | Primary body text |
| Muted charcoal | `#62645F` | Secondary text and inactive UI |
| Sage rule | `rgba(74, 93, 78, 0.12)` | Standard dividers and card outlines |
| Brass rule | `rgba(197, 168, 128, 0.35)` | Elevated frames and special dividers |

Use `#FAF8F5` or the closest existing semantic canvas token before adding a new background. Gold/champagne is a fine detail, never a large text background. Text and interactive states must meet WCAG AA contrast; do not use low-contrast champagne for small text.

Dark themes should preserve the same material relationship instead of mechanically inverting the palette. Recommended anchors: dark canvas `#1C211D`, raised surface `#28312A`, primary text `#F7F3EC`, muted text `#C9CDC6`, primary action `#B7CCB9`, and champagne detail `#E0C298`.

## Typography

- Vietnamese display, headings, body, and UI: `"Be Vietnam Pro", "Segoe UI", Arial, sans-serif`. Use its 400–600 weights and scale/whitespace—not artificial tracking—for hierarchy. This is the safe default for all Vietnamese copy, labels, forms, tables, and operational data.
- Latin-only wordmarks or a short Latin venue name may use `Lora, Georgia, "Times New Roman", serif` for an editorial note. Never apply Lora to Vietnamese content in browser UI: real Chromium rendering must take priority over a serif treatment.
- Labels and overlines: Be Vietnam Pro semibold. A small amount of tracking is optional for short ASCII labels; retain authored case and normal tracking for Vietnamese labels or any text containing diacritics.
- Use a script face only when the product already has an approved, Vietnamese-safe asset and the accent is optional. It is not part of the default system.
- Use Unicode NFC source text. Do not transform Vietnamese copy to uppercase in CSS and do not apply `letter-spacing` to Vietnamese text: both can disrupt diacritic shaping or produce visibly separated words. Keep `font-kerning: normal` and common ligatures enabled.
- Verify representative Vietnamese diacritics in a rendered browser/device, including `quyết định`, `tiếp tục`, `kế hoạch`, and `đầy đủ`. Do not allow a serif heading to clip, split Vietnamese words, or force a fallback face unexpectedly.

Suggested hierarchy: display 56/68 desktop and 38/46 mobile; display-small 40/50 desktop and 28/36 mobile; headline 32/40, 24/32, 20/28; body 18/28, 15/24, 13/20; labels 13/18, 11/16, 10/14. Treat these as roles, not a reason to force every size into every screen.

## Shape, border, and depth

- Web surfaces use a 2–4px radius. Mobile may use 4–12px where native ergonomics benefit, without turning every section into a card.
- Favor 1px sage rules for standard grouping and antique-champagne rules for image mats, premium summaries, and significant dividers.
- A framed image may use an outer champagne rule and 8–16px ivory matte. An arched top is allowed only for a primary feature image when it strengthens the venue story.
- Shadows are rare and diffuse: cards may use `0 4px 20px -2px rgba(35, 35, 33, 0.04)`; overlays may use `0 16px 40px -8px rgba(35, 35, 33, 0.08)`. Prefer tonal layers, rules, and whitespace first.
- Fully rounded shapes are limited to statuses, avatars, counters, and progress indicators. Default tags are compact rectangles with minimal rounding.

## Spacing and density

Use a 4/8-point rhythm. Typical editorial spacing: 6px, 12px, 20px, 36px, and 56px; desktop page margins 64px with 32px gutters; mobile page margins 24px with 16px gutters. Use a fluid 12-column desktop grid (max 1380px), 8-column tablet grid, and 4-column mobile grid.

Marketing and invitation views should have generous vertical pauses and occasional narrow reading columns. Operational views should be compact through alignment and systematic grouping, not smaller text. Align major edges across page headers, imagery, summaries, tables, and actions.

## Imagery

- Choose warm, editorial images of Vietnamese weddings, refined venues, flowers, celebrations, or food when relevant to the content.
- Favor one large, well-matted focal photograph over a collage of decorative images. Crop intentionally and test desktop and mobile aspect ratios.
- Use a low-opacity ivory or forest overlay only when needed for readable text; preserve the image's atmosphere.
- Prototype photography must be replaceable. Production uses project-owned or explicitly licensed assets with meaningful alt text when the image conveys content.

## Interaction and accessibility

- Primary buttons are estate forest with pressed-ivory text, rectangular/low-radius, semibold labels in authored case, and enough padding for a 44px target. Hover deepens toward evergreen; never rely on letter-spacing animation as the only feedback.
- Secondary actions use a sage or champagne hairline with charcoal text; editorial links use a subtle underlined text treatment and may include a trailing arrow.
- Every form control has a visible label, useful help/error text, a clear forest focus state, and a stable disabled state. Inputs are lightly framed or bottom-ruled—not floating rounded capsules.
- Preserve heading order, landmarks, accessible names, keyboard navigation, live regions for async status, and a deliberate narrow-screen strategy for data tables.
- Respect reduced-motion preferences. Motion should clarify state, not delay access to booking, RSVP, operational data, or forms.
