# Visual foundation

## Brand character

The system should feel refined, ceremonial, warm, and dependable. It borrows the editorial confidence of a premium wedding estate while remaining practical for Vietnamese couples and venue staff.

Avoid generic SaaS gradients, glassmorphism, oversized rounded cards, excessive shadows, decorative clutter, and playful colors that weaken the estate character.

## Color tokens

Use these roles rather than choosing colors screen by screen.

| Role | Light value | Purpose |
| --- | --- | --- |
| Primary navy | `#163A70` | Primary actions, navigation, strong bands |
| Deep navy | `#102B55` | Hover/pressed states, dark structural areas |
| Display brown | `#553419` | Major serif headings and wordmarks |
| Script burgundy | `#6B3A3A` | Handwritten accents and selected emphasis |
| Antique gold | `#B08A47` | Hairlines, borders, small highlights |
| Powder blue | `#DCE6F6` | Section backgrounds and quiet panels |
| Light blue | `#A0B9DB` | Secondary blue states and dark-theme primary |
| Paper | `#FFFEFA` or `#FBF8F4` | Main warm background |
| Ink | `#2F2925` | Primary body text |
| Muted | `#716B66` | Secondary text |

Dark themes should keep the same semantic relationships, not mechanically invert colors. Recommended anchors: primary `#A0B9DB`, primary text `#102B55`, powder `#1C2D46`, display `#E7DABF`, script `#DCAAAA`, gold `#D8BD82`.

Use gold as detail, not as a large background. Ensure text and interactive states meet WCAG AA contrast.

## Typography

- Display: an editorial serif with Vietnamese glyph support. Current safe stack: `Georgia, "Times New Roman", serif`.
- Script: a restrained handwritten face used only for short accents. Current safe stack: `"Segoe Script", "Brush Script MT", cursive`.
- Body/UI: a clear sans serif. Current safe stack: `"Segoe UI", Arial, sans-serif`.
- Major headings are usually uppercase, regular or medium weight, with controlled tracking and short line lengths.
- Script text must not carry essential instructions, long paragraphs, table labels, or small metadata.
- Verify Vietnamese diacritics in the rendered browser/device, especially with uppercase serif text.

## Shape, border, and depth

- Web surfaces: square corners or `0–8px` radius.
- Mobile surfaces: `4–14px` radius where native ergonomics benefit; avoid turning every section into a card.
- Use `1px` antique-gold borders for premium information groups and dividers.
- Shadows are rare and soft. Prefer contrast, whitespace, borders, and color bands for hierarchy.
- Fully rounded shapes are limited to statuses, avatars, counters, and progress tracks.

## Spacing and density

Use a 4/8-point rhythm. Favor generous vertical whitespace on marketing and invitation views; use tighter, systematic spacing in operations views. Align major edges across headers, imagery, summaries, and content sections.

Do not solve density by shrinking typography below readable sizes. Reflow grids, collapse secondary metadata, or use progressive disclosure instead.

## Imagery

- Choose warm, editorial wedding photography with couples, flowers, ceremony details, or refined venues.
- Prefer one strong image over several small decorative images.
- Crop intentionally around the subject and test common desktop and mobile aspect ratios.
- Use navy overlays only when needed for legible white text.
- Prototype photography may come from a reputable licensed source. Production must use project-owned or explicitly licensed assets and include meaningful alt text when the image conveys content.

## Interaction and accessibility

- Primary buttons are navy, rectangular, and concise. Secondary actions may use a thin navy or gold outline.
- Every form control has a visible label, useful help/error text, and a clear focus state.
- Preserve heading order, landmarks, accessible names, keyboard navigation, and live regions for async status.
- Minimum touch target is approximately 44px. Do not rely on color alone for status.
- Tables need a responsive strategy: horizontal containment, prioritized columns, or a deliberate card transformation.
- Provide designed loading, empty, error, disabled, success, and destructive states when the workflow can reach them.
