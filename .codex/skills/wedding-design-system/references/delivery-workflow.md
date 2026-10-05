# Delivery workflow

## 1. Establish the screen contract

Inspect the target repository, existing routes/components/theme, nearby tests, and any task acceptance criteria. Identify the primary user, primary action, essential states, and target breakpoints before composing the screen.

Use the approved system without requesting routine visual approval. When the task leaves minor copy or layout choices open, make a coherent product decision and document only material assumptions.

## 2. Calibrate and audit the direction

Read the relevant product baseline in `product-patterns.md`, adjust the three taste dials only when the screen type warrants it, and run the pre-design checks in `taste-audit.md`. Treat the chosen values as constraints on composition, not as requirements to add visual effects.

For redesigns, audit the current screen before editing. Preserve working information architecture, routes, field names, legal copy, and product terminology unless the task explicitly changes them.

## 3. Compose with existing primitives

Start from the product pattern, then map real content and actions into it. Reuse existing tokens and components. Add a semantic token or focused component only when it will represent a stable repeated decision.

Avoid:

- copying an approved sample verbatim when the new task has a different information hierarchy;
- hard-coding repeated visual values inside feature screens;
- replacing native mobile behavior with web-like styling;
- decorative controls with no working state;
- dependency additions for effects achievable with the current stack.

## 4. Implement a complete vertical slice

Include realistic Vietnamese copy and the states required by the workflow. Preserve existing architecture and API boundaries. Keep large style definitions separate from behavior-heavy components when that improves readability.

Treat remote images and API responses as untrusted external inputs. Never place secrets or personal production data in samples.

## 5. Verify the result

Run the repository's own commands. Current baseline commands are:

### Next.js products

```text
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

### Expo product

```text
npm run format:check
npm run lint
npm run typecheck
npm test -- --runInBand
npm run build
```

Then inspect the rendered UI at the intended desktop/mobile viewport and one adjacent breakpoint. Confirm:

- no console/runtime errors;
- no clipped or overflowing Vietnamese text;
- meaningful focus order and accessible names;
- correct image crop and readable overlay contrast;
- visible loading, empty, error, and success behavior where applicable;
- no generated preview files or temporary platform configuration left in the working tree.

For UI changes, save an evidence screenshot in the repository's established output location when one exists. Screenshots support review but do not replace behavioral tests.

Run the product-specific taste pre-flight from `taste-audit.md` against the rendered result. Fix failed checks before delivery; do not waive them merely because automated tests pass.

## 6. Review against five questions

1. Does the screen solve the user's primary task?
2. Does it clearly belong to the correct Wedding product while sharing the brand family?
3. Are hierarchy and states understandable without explanation?
4. Is the implementation accessible, responsive, and maintainable?
5. Did the change avoid copying third-party brand assets and identify temporary photography?

If all five answers are yes and verification passes, proceed without another mockup approval.
