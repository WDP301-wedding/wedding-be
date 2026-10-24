# Customer / Manager UX follow-up — 2026-10-24

Consolidated current report for both UX implementation phases. Earlier phase-specific
limitations are superseded by the verification and rollout boundaries below.
Scope: wedding-web, wedding-manage-web and supporting wedding-be changes. No app,
database migration, dependency update, commit, push or deployment was performed.

## Implementation

- **Cost preview:** `POST /bookings/{bookingId}/contracts/preview` calculates line
  amounts, total and deposit without creating a revision, approval, ledger entry,
  payment or outbox event. Preview/save share the draft preparation and existing
  ownership, revision, predecessor, timeline, capacity, price and payment-pin
  guards. UI marks old totals outdated when selections change; save is separate
  and revalidates. Unrecorded incidentals are not claimed to be in the final total.
- **Global intake search:** `GET /management/consultation-requests` accepts
  status/q/sort/cursor/limit. Counts apply to the search across statuses;
  totalMatches also applies the selected status. Rows and grouped counts share a
  repeatable-read snapshot. Ordering has a deterministic ID tie-breaker; stale
  cursors return 409. Existing retention and Manager authority remain unchanged.
  This adds no per-row read/count. Text search is debounced, old requests aborted,
  late responses ignored, and paging deduplicated in linear time. Controls remain
  mounted while loading/empty; async actions refresh the latest filter.
- **Activation state:** private owning-Manager
  `GET /management/consultations/{consultationId}/activation-status` reads actual
  access, account and invitation evidence. It distinguishes not issued, pending
  delivery outcome, awaiting acceptance, expired, revoked, activated, unavailable
  account and missing access. Issuance is not proof of delivery or deposit.
- **Explicit send/reissue:**
  `POST /management/consultations/{consultationId}/activation-invitations` requires
  expected revision and durable idempotency. It reuses existing issuer lifetime
  and reissue limits; confirmation explains old-link invalidation. Revoked or
  activated access is not silently re-enabled. Unknown delivery keeps the same
  operation key; definitive state conflicts refresh the UI. No background effect
  sends email. The status reader mounts only in the visible workspace and can
  refresh on window focus or the explicit button. Pre-deposit access stays
  RESTRICTED; post-deposit guards are not removed.
- **Seating:** bounded undo, restoration of saved labels, page/internal-link exit
  warnings, and per-tab same-revision recovery. Draft storage contains table/group
  IDs, no credentials, and never counts as server-saved data. Other revisions are
  not replayed. Dirty editors survive realtime and in-flight background reads;
  new remote data offers an explicit replacement choice. Stale saves preserve
  edits. Layout switching is blocked until labels are saved/restored. State,
  undo and storage are isolated from UI in `use-seating-labels.ts`; navigation
  guarding is isolated in `use-unsaved-seating.ts`.
- **Visual refinements:** styled accessible password controls on both logins;
  Customer's narrow login header no longer hides the account link behind the CTA.
  The form is shown without a tall decorative image above it. Desktop uses an
  existing local image rather than depending on the previous external image URL.
- Earlier layout previews, shared invitation renderer/footer, contract line
  descriptions, account-information distinction and closure confirmation remain.

## Retained details from the initial phase

- Layout choices expose optional published descriptions, table counts and geometry
  from already-loaded immutable versions, without per-option queries. Older servers
  can omit this metadata; the UI must explain unavailable previews.
- Select a Group/color and assign several tables, or explicitly remove labels.
  Planned headcount stays separate from named Guests. Edits are local until Save;
  existing revision and capacity checks remain authoritative.
- Invitation editing saves footer and multiline content in the idempotent payload.
  Preview and public pages share the renderer for ordered sections, text references,
  images and timeline details. Missing published images are stated explicitly;
  stock images are not substituted. Booking context is reused without extra reads.
- Account settings distinguish login email/display name from wedding-specific
  bride/groom names. Passwords start masked; accessible show/hide controls preserve
  form value, focus and submission behavior.
- Intake conversion and invitation delivery have separate outcomes. Conversion
  supplies the actual consultation revision, including replay; failed or unknown
  issuance does not undo conversion. Keep per-consultation idempotency and action
  locking. Issuance is not proof of delivery, acceptance or deposit.
- Closing an intake requires confirmation and archives the request. It does not
  delete accounts or immutable contracts/payments. Global search/count behavior
  described above replaces the initial loaded-record-only filtering limitation.

## Contract and rollout

BE OpenAPI JSON and SHA-256 were regenerated. Released frontend contract pins
were not rewritten to pretend the local BE artifact belongs to an old commit.
Small additive endpoint types reuse existing authenticated transport, timeout and
error middleware. Regenerate the normal pins from the actual BE release commit
as part of a later coordinated release. Deploy BE before these new client flows.

No authenticated live integration, provider delivery or native proof is claimed.
No email/replacement, payment, publication or destructive operation was executed
during verification. The main customer journey was not migrated into wedding-app.

## Verification

- Final `tsc --noEmit`: passed in all three repositories.
- ESLint on changed TypeScript/TSX files with `--max-warnings 0`: passed in all
  three repositories. CSS is formatted, not passed to the TypeScript linter.
- Changed source formatted with Prettier; BE OpenAPI artifact check passed.
- Git whitespace checks passed across all three repositories.
- No automated test suite, build or database/provider integration was run.
- Real Chrome inspected both login pages after hydration at 1440x956 and 440x956.
  Each document width matched its viewport; no page errors were observed. The
  screenshots were visually reviewed. This is login-page evidence only, not
  proof of authenticated preview/filter/activation/seating integration.
- Evidence directory:
  `C:/Users/Admin/.codex/visualizations/2026/10/08/01a11af3-90ab-7882-aec4-6818d93947f0/customer-manager-ux-2026-10-24/`.
- Temporary dev servers were stopped; only their generated AGENTS/next-env edits
  were reverted. Application changes are preserved.

## Manual acceptance after deployment

1. Preview costs, change quantities, verify the old preview becomes outdated and
   history is untouched. Save separately. Check stale/foreign/payment-pin refusal.
2. Search an intake beyond the first page; compare counts, tabs, sorting, reset,
   empty results and pagination. Type quickly/change filters during requests and
   actions; old results must not replace the latest search or remove input focus.
3. On a disposable owned consultation, check activation and accept its invitation.
   Refresh state, verify explicit reissue/old-link invalidation, existing limits
   and same-key recovery. Do not use real customer invitations for acceptance.
4. Assign several tables, undo/restore, navigate away and return. Update from a
   second authorized session; the dirty editor must remain until deliberately
   replaced. Save/reload and check revision/capacity safeguards.
5. Compare real saved/published invitation content and inspect authenticated pages
   at desktop/narrow widths. This remains a manual acceptance gate.
