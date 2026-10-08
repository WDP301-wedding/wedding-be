# Wedding taste audit

This is a curated anti-generic design layer for the Wedding products. It is not a dependency on another skill and must not override the approved brand foundation, product behavior, accessibility, or the existing technology stack.

## Three decision dials

The dials describe how a screen should behave visually. They are not quality scores.

| Dial | Low values | High values |
| --- | --- | --- |
| Variance | Familiar, symmetric, predictable composition | More editorial, asymmetric, and varied composition |
| Motion | Static UI with essential feedback | Choreographed transitions and scroll-linked effects |
| Density | Few elements and generous whitespace | More information and actions per viewport |

Start from the product baseline:

| Product | Variance | Motion | Density |
| --- | ---: | ---: | ---: |
| `wedding-web` | 6 | 3–4 | 3 |
| `wedding-manage-web` | 3 | 2 | 7 |
| `wedding-app` | 4 | 3 | 5 |

Adjust at most one or two points when the screen type clearly warrants it. Examples:

- A campaign or venue story page may use `7 / 4 / 2`.
- A public account form may use `4 / 2 / 4`.
- A management command center may use `3 / 2 / 8`.
- A management configuration form may use `2 / 1 / 6`.
- Mobile onboarding may use `5 / 4 / 3`.
- A mobile task list may use `3 / 2 / 6`.

If a design needs to move farther than two points from its product baseline, reconsider whether the composition belongs to that product before proceeding.

## Pre-design read

Before composing a screen, identify internally:

1. the product and primary audience;
2. the single most important user task;
3. whether this is greenfield, a preservation redesign, or a functional overhaul;
4. the real content, states, assets, and constraints already present;
5. the chosen dial values and why they differ from the baseline, if they do.

Do not emit a ceremonial design-plan block or ask the user to tune the dials. State an assumption only when it materially affects the result.

For redesigns, inspect before changing. Preserve working routes, navigation labels, form names, legal copy, domain terminology, and behavior unless the task explicitly authorizes a change.

## Anti-default sweep

Use these as diagnostic questions, not universal bans:

- Are three equal cards being used simply because they are easy?
- Do consecutive sections repeat the same left-text/right-image or centered-heading pattern?
- Has every content group been placed inside a rounded card?
- Does nearly every heading have a tiny uppercase eyebrow above it?
- Are decorative pills, status dots, fake metrics, or badges present without helping the task?
- Does the copy use vague claims, generic names, filler language, or implausibly perfect numbers?
- Are gradients, glass effects, shadows, and animation being used to manufacture “premium” rather than support hierarchy?
- Is a stock image visually unrelated to the Vietnamese wedding context or the content beside it?
- Is the interface merely imitating the approved sample instead of solving the new information hierarchy?

When the answer is yes, remove the pattern or replace it with a task-specific composition. Do not introduce novelty solely to avoid repetition.

## Consistency locks

Audit each rendered screen for these locks:

- **Color:** every color has a semantic role from the Wedding palette. Gold remains detail, navy remains structure/action, and powder blue remains a quiet surface.
- **Shape:** square and low-radius surfaces dominate; pills remain limited to compact statuses, counters, avatars, and progress.
- **Typography:** Vietnamese headings, accents, labels and body use the shared sans-serif tokens with normal tracking and authored case. Serif is restricted to explicit Latin-only wordmarks. Vietnamese glyphs render cleanly.
- **Iconography:** one coherent icon family or the platform-native set is used within a product surface. Icons are not hand-drawn merely for differentiation.
- **Motion:** durations and easing form a small consistent vocabulary. Reduced-motion behavior is present when motion exceeds basic state feedback.
- **Terminology:** the same domain concept uses the same Vietnamese label across web, management, and mobile where roles align.

## Product-specific taste checks

### `wedding-web`

- The opening viewport has one clear message and one dominant action.
- Display headings normally remain within two or three lines and Vietnamese words do not clip or break unnaturally.
- CTA labels remain on one line at desktop widths.
- Photography is intentional, well-cropped, and strong enough to justify its space.
- Consecutive sections vary their rhythm without becoming stylistically unrelated.
- Motion supports storytelling but never delays access to forms, pricing, RSVP, or event details.
- Decorative labels and script accents are used sparingly.

### `wedding-manage-web`

- Navigation, filters, bulk actions, tables, and pagination appear where an operator expects them.
- Density comes from alignment and hierarchy, not reduced readability or cramped touch targets.
- Tables have a narrow-screen strategy and do not silently hide critical actions.
- Status never relies on color alone and uses a stable vocabulary.
- Loading, empty, error, permission-denied, destructive, and success states are designed when reachable.
- Motion is limited to feedback and spatial continuity; data should not animate for spectacle.
- Brand styling does not obscure scanning, sorting, filtering, or comparison.

### `wedding-app`

- Navigation, forms, sheets, back behavior, safe areas, and touch feedback feel native.
- Primary touch targets are approximately 44px or larger.
- The first viewport answers “what matters next?” without reproducing the entire plan.
- Branded moments such as countdowns and milestones do not turn routine workflows into marketing pages.
- Motion uses platform-friendly transforms/opacity and remains smooth on mid-range Android devices.
- Dynamic color or dark-mode tokens preserve hierarchy and contrast.
- Long screens have deliberate grouping and scrolling; content is not fragmented into excessive cards.

## Final taste pre-flight

Before delivery, verify the rendered result:

- [ ] Dial values fit the product and screen type.
- [ ] The primary action and hierarchy are obvious without explanation.
- [ ] No repeated generic layout or card pattern dominates the screen.
- [ ] Color, shape, typography, icon, motion, and terminology locks pass.
- [ ] CTA text, form labels, helper text, errors, and focus states meet contrast requirements.
- [ ] Vietnamese text does not clip, overflow, orphan badly, or break inside words.
- [ ] Loading, empty, error, disabled, success, and destructive states exist where relevant.
- [ ] The target viewport and one adjacent breakpoint have been inspected.
- [ ] Browser/runtime logs contain no unresolved errors.
- [ ] No new UI framework, animation library, icon package, or font dependency was assumed without checking the repository and justifying the addition.

## Deliberate exclusions

Do not import these general-purpose taste patterns into the Wedding system:

- forced random layout selection;
- mandatory AIDA page structure;
- mandatory Tailwind, shadcn, GSAP, Motion, or a specific icon package;
- mandatory image generation before direct implementation;
- blanket bans on serif typography or warm cream/gold/brown palettes;
- animation or texture added to every section;
- rules that exclude dashboards, data tables, forms, or native mobile.

The approved serif and estate palette are explicit brand decisions, not generic defaults. The management dashboard and native mobile app are first-class Wedding products and require their own product patterns.

## Influence and license

The audit approach and dial vocabulary were adapted and substantially rewritten for this project after reviewing [Taste Skill](https://github.com/Leonxlnx/taste-skill) and its audit-oriented variants. Taste Skill is published under the [MIT License](https://github.com/Leonxlnx/taste-skill/blob/main/LICENSE), Copyright (c) 2026 Leonxlnx. The external repository is not installed, invoked, or updated automatically by this skill.
