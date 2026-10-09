# Product patterns

Read only the section for the product being changed. The prior screenshots in `../assets/approved-samples/` may be used to understand established information architecture and product behavior; they are not visual templates for this updated system.

## `wedding-web`

Purpose: emotional public and couple-facing experiences such as invitations, discovery, wedding details, and guest interactions.

Taste baseline: **variance 6, motion 3–4, density 3**. Routine forms may lower variance and motion; major editorial or campaign pages may raise variance by one. Preserve clarity and keep the primary action obvious.

Preferred composition:

- A slim muted or champagne-dust announcement strip only when it carries meaningful context.
- A calm editorial header: Latin wordmark may use Lora; Vietnamese navigation and actions use Be Vietnam Pro.
- A full-bleed or split hero with warm photography, restrained ivory/forest overlay only where copy needs it, and a concise Be Vietnam Pro statement.
- Pressed-ivory canvas, asymmetrical but balanced editorial sections, measured photo mattes, and hairline rules instead of decorative color bands.
- Short labels used selectively; Be Vietnam Pro section titles and body copy at a comfortable reading width. Serif styling is restricted to explicit Latin-only wordmarks. Preserve Vietnamese case and normal letter spacing.
- Alabaster fact or RSVP groups with sage borders; champagne is reserved for framing and small emphasis.
- One dominant action per section. Vary page rhythm to match the story rather than repeating a card grid.

On mobile, stack image before content, keep primary facts visible, reduce display type, and turn multi-column fact/form groups into one column. Do not reproduce desktop navigation at reduced scale.

Approved anchor: `../assets/approved-samples/wedding-web.png`.

## `wedding-manage-web`

Purpose: fast operational work for managers and staff. Beauty supports scanability; it must not obscure state or actions.

Taste baseline: **variance 3, motion 2, density 7**. Operational consistency takes priority over novelty. Increase density through hierarchy, grids, and progressive disclosure rather than smaller text.

Preferred composition:

- Deep evergreen or estate-forest sidebar/navigation with a restrained champagne active rule; avoid bright-blue application chrome.
- Be Vietnam Pro page titles paired with compact operational metadata and controls; reserve Lora for a Latin-only wordmark.
- Pressed-ivory canvas with alabaster work surfaces, champagne-dust table/panel headers, sage row separators, and clear alignment.
- Square or barely rounded metric cells with thin sage/champagne rules instead of floating card stacks.
- A featured venue/event strip may combine forest copy with one framed image, only when it surfaces relevant work.
- Compact rectangular status tags that pair color with text/icon; no decorative pills or vague synthetic metrics.
- Dense but readable tables on desktop; deliberate column prioritization on narrow screens.
- Timelines and attention queues use alignment, time, and small color markers instead of large decorative cards.

Keep controls predictable and close to the data they affect. Use confirmation for consequential actions and expose system status without visual noise.

Approved anchor: `../assets/approved-samples/wedding-manage-web.png`.

## `wedding-app`

Purpose: an intimate planning companion for a couple, optimized for quick progress checks and the next useful action.

Taste baseline: **variance 4, motion 3, density 5**. Branded moments may be expressive, but navigation, forms, sheets, and touch behavior remain native and predictable.

Preferred composition:

- A compact Latin Lora wordmark or a Be Vietnam Pro screen title, followed by a warm hero or a content-led first action—not a mandatory marketing layout.
- Pressed-ivory canvas, estate-forest date/venue or progress anchors, and champagne hairlines for important grouping.
- A centered welcome/milestone block with a short Be Vietnam Pro title, calm body copy, and a thin divider; no default script accent.
- Champagne-dust planning or appointment panels with thin sage/champagne borders.
- Task lists built from separators, order, and clear completion affordances rather than a stack of rounded cards.
- Appointment or milestone sections in powder blue.
- Native controls and platform behavior; use the existing Expo theme, `expo-image`, and native-capable UI components already present in the project.

Support dynamic color/dark mode through semantic tokens. Important dates and values may be selectable. Keep scroll behavior, safe areas, touch targets, and Android rendering in the verification loop.

Approved anchor: `../assets/approved-samples/wedding-app.png`.

## Cross-product reuse

Reuse semantic tokens, typography roles, status meanings, field patterns, and content terminology. Share implementation packages only when the repositories already support that architecture; do not force cross-repository coupling merely to avoid a few duplicated constants.
