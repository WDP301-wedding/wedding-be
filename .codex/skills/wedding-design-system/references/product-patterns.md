# Product patterns

Read only the section for the product being changed. The screenshots in `../assets/approved-samples/` document the approved baseline.

## `wedding-web`

Purpose: emotional public and couple-facing experiences such as invitations, discovery, wedding details, and guest interactions.

Taste baseline: **variance 6, motion 3–4, density 3**. Routine forms may lower variance and motion; major editorial or campaign pages may raise variance by one. Preserve clarity and keep the primary action obvious.

Preferred composition:

- A slim brown announcement strip for high-value context.
- A centered estate-style wordmark/header with one clear action.
- A navy script ribbon or quiet transition band when it supports the page story.
- Full-bleed or split-layout photography occupying substantial visual space.
- Serif uppercase page titles with short burgundy script accents.
- Gold-outline summaries for date, venue, time, package, or RSVP facts.
- Powder-blue section headings and warm paper form areas.
- Editorial whitespace and a single dominant action per section.

On mobile, stack image before content, keep primary facts visible, reduce display type, and turn multi-column fact/form groups into one column. Do not reproduce desktop navigation at reduced scale.

Approved anchor: `../assets/approved-samples/wedding-web.png`.

## `wedding-manage-web`

Purpose: fast operational work for managers and staff. Beauty supports scanability; it must not obscure state or actions.

Taste baseline: **variance 3, motion 2, density 7**. Operational consistency takes priority over novelty. Increase density through hierarchy, grids, and progressive disclosure rather than smaller text.

Preferred composition:

- Deep navy sidebar or structural navigation with a thin gold accent.
- Serif uppercase page titles paired with compact operational metadata.
- A featured venue/event strip combining navy copy and one image.
- Square metric cells with gold borders rather than floating rounded cards.
- Powder-blue table/panel headings, clear row separators, and restrained status pills.
- Dense but readable tables on desktop; deliberate column prioritization on narrow screens.
- Timelines and attention queues use alignment, time, and small color markers instead of large decorative cards.

Keep controls predictable and close to the data they affect. Use confirmation for consequential actions and expose system status without visual noise.

Approved anchor: `../assets/approved-samples/wedding-manage-web.png`.

## `wedding-app`

Purpose: an intimate planning companion for a couple, optimized for quick progress checks and the next useful action.

Taste baseline: **variance 4, motion 3, density 5**. Branded moments may be expressive, but navigation, forms, sheets, and touch behavior remain native and predictable.

Preferred composition:

- Compact estate wordmark followed by a full-width hero image.
- Navy date/venue band immediately attached to the hero.
- Centered welcome block with a short script accent, serif title, and gold divider.
- Powder-blue countdown/progress panel with a thin gold border.
- Task lists built from separators and ordered indices, not a stack of rounded cards.
- Appointment or milestone sections in powder blue.
- Native controls and platform behavior; use the existing Expo theme, `expo-image`, and native-capable UI components already present in the project.

Support dynamic color/dark mode through semantic tokens. Important dates and values may be selectable. Keep scroll behavior, safe areas, touch targets, and Android rendering in the verification loop.

Approved anchor: `../assets/approved-samples/wedding-app.png`.

## Cross-product reuse

Reuse semantic tokens, typography roles, status meanings, field patterns, and content terminology. Share implementation packages only when the repositories already support that architecture; do not force cross-repository coupling merely to avoid a few duplicated constants.
