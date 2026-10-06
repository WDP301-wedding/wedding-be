---
name: wedding-design-system
description: Design and implement UI for wedding-web, wedding-manage-web, and wedding-app with the approved garden-estate editorial visual system. Use for new or revised screens and shared components in these three products; do not use for backend-only work or unrelated brands.
---

# Wedding Design System

Apply the approved design direction autonomously across the Wedding Management ecosystem. Preserve each product's purpose while making the three surfaces feel like one brand.

## Required context

- Read [references/foundation.md](references/foundation.md) for every visual design or UI implementation task.
- Read [references/product-patterns.md](references/product-patterns.md) only for the product being changed.
- Read [references/taste-audit.md](references/taste-audit.md) when designing, implementing, or reviewing a visual change.
- Read [references/delivery-workflow.md](references/delivery-workflow.md) when implementing or reviewing code, not when only answering a conceptual question.

The prior screenshots in `assets/approved-samples/` are implementation and information-architecture anchors, not visual templates for the current system. Never transcribe their copy, typography, colors, imagery, or layout wholesale. Resolve visual decisions from the current references; resolve copy from the current product requirements, domain terminology, and Vietnamese-language quality instead.

## Product contract

- Use Vietnamese for user-facing copy unless the user requests another language.
- Keep the visual character garden-estate inspired: pressed-ivory canvas, laurel/forest structure, antique-champagne detail, soft-charcoal text, Be Vietnam Pro Vietnamese typography, Lora Latin wordmarks only, framed warm imagery, and generous whitespace.
- Do not copy third-party logos, wording, photography, or unique branded assets. Inspiration may inform composition and visual tone only.
- Prefer existing project components and tokens. Extend the central theme when a reusable decision is missing; do not scatter near-duplicate colors or spacing values through screens.
- Let the public website feel emotional and image-led, the management website operational and information-dense, and the mobile app intimate and native. Shared tokens create family resemblance; identical layouts do not.
- Maintain semantic HTML or native accessibility, visible focus, readable contrast, touch targets, responsive layouts, loading/empty/error states, and dark-mode behavior where the product already supports it.
- Use low-radius or square surfaces, hairline rules, tonal layers, and image mattes instead of heavy shadows. Reserve pills and fully rounded shapes for statuses, avatars, compact counters, and progress indicators.
- Prefer calm, useful motion only when it clarifies state. Respect reduced-motion preferences.
- Calibrate variance, motion, and density from the product baseline before composing a screen. These are decision aids, not quality scores or reasons to add novelty.

## Decision authority

The user has approved this system for subsequent Wedding screens. Make routine visual and composition decisions without requesting a new mockup approval. Ask only when requirements introduce a materially different brand direction, a missing product decision that changes behavior, or an irreversible external action.

When several layouts are valid, choose the one that best preserves content hierarchy, task clarity, and the product-specific pattern in the references. Do not invent novelty merely to make screens look different.

## Completion standard

A UI task is complete only when the relevant automated checks pass, the rendered result has been inspected at its target viewport, browser/runtime errors are absent, the taste pre-flight passes, and the screen remains consistent with the approved visual foundation and product pattern. Temporary photography is acceptable for prototypes but must be identified as replaceable before production.
