# Food catalog tables, version history and inherited images

Owner request: 2026-11-03, Asia/Saigon. This request explicitly authorizes the
catalog changes in `wedding-manage-web` and image inheritance in `wedding-be`.
It keeps the existing retirement behavior when a dish belongs to published menus.
This follows the original [catalog delivery](./food-catalog-management-2026-11-03.md)
without replacing its historical verification evidence.

## Management behavior

- A dish/menu aggregate appears once in its table. Name, price and version refer
  to `currentPublishedVersionId`; a separate badge identifies `draftVersionId`.
  Never substitute an unpublished draft price for a published price. An aggregate
  without a publication is labeled unpublished, with its draft price identified.
- Details show publication, optional draft and read-only superseded versions.
  Each historical menu displays its own exact dish version names/descriptions;
  a later dish publication cannot rewrite those items.
- "Tạo phiên bản mới" opens a local form populated from the publication. Cancel,
  Escape and closing the modal before saving issue no catalog mutation. A saved
  draft is resumed with "Tiếp tục bản nháp"; closing does not delete that draft.
- Save creates the clone only when needed, then updates its entered content.
  Save-and-publish uses the revision returned by the update. A lost clone response
  retains the original version ID/source/idempotency key for safe retry, or adopts
  that exact draft if the refreshed snapshot already contains it.
- Existing list/detail/clone/update/publication/lifecycle APIs are reused. Clone
  retry keys are headers only; no new request field or database migration is added.
  Manager authorization and the one-draft-per-aggregate rule remain in force.

## Backend image ownership

Dish and menu clones copy attached source image bytes through the selected
StorageProvider into keys owned by the destination version. New attachment IDs
retain image order and alternative text. Detached images are excluded. Original
attachments/objects remain intact, including when cloning a superseded version.
Replacing the new image cannot detach/delete the historical version's image.

Source and provider metadata are checked for ownership, checksum, content type
and size. Missing storage/read support fails closed with `PROVIDER_UNAVAILABLE`;
invalid provider content fails with `PROVIDER_ERROR`. Existing provider read/write
errors propagate through the standard error response; no success is returned with
silently missing images.

A destination-version advisory transaction lock serializes copying and persistence
even across different idempotency keys using the same version ID. Draft, menu
items, attachments and clone audit commit together. Failure rolls back the draft;
cleanup takes the same lock and deletes copied objects only after checking that
no committed attachment references them. The transaction allows up to 60 seconds
for this infrequent management operation. Cleanup failure preserves the original
error; a late provider write or failed cleanup can require orphan reconciliation.

No contract, appendix, invoice, payment, menu price formula or dish-retirement rule
is changed. Historical signed-read behavior remains under the original owner.

## Verification

- Regression tests first reproduced missing cloned images. Eleven disposable
  PostgreSQL tests initially passed, covering both food types, exact historical sources,
  independent replacement, rollback, partial read failure, same-destination races,
  absent read support, corrupted bytes and a write followed by a lost response.
- Final image suite: 18 passed, including six invalid provider-metadata guards and
  preservation of the original error when orphan cleanup fails. Focused coverage
  of `food-media-clone.ts` is 100% lines/statements/functions/branches without
  lowering the configured 80% thresholds. Database teardown has a 60-second bound
  matching setup; one initial 10-second teardown timeout under load was rerun.
- Existing menu behavior and soft-deletion PostgreSQL tests passed alongside the
  initial seven image tests. These databases apply all immutable migrations and
  remove only their own generated database after each run.
- Local HTTP on port 3001 and browser on port 3002 verified one row per aggregate,
  historical prices/descriptions, historical menu dish versions, new draft saves
  without repricing the publication, and Cancel/reopen with zero catalog writes.
  Images remained available on v1 and v2 after cloning for both food types.
- Browser measurements at 320/768/1024/1440 pixels show no page overflow; narrow
  tables scroll inside their own focusable containers. Vietnamese uses the existing
  sans-serif tokens. Screenshots and synthetic fixture scripts are ignored under
  `.local-demo/`.

Final local checks: backend typecheck, lint, build, API generation/check and
changed-file formatting/diff checks passed. Menu service/HTTP tests: 20 passed.
The final PostgreSQL run (image inheritance, existing menu behavior, soft deletion)
passed all 20 tests after applying immutable migrations to generated test databases.
Frontend typecheck, lint, production build and unchanged API-pin check passed;
32 catalog tests and four typography tests passed. Narrow-table scrolling and
Escape/focus restoration were checked in the real browser. The local development
console retained one Socket.IO connection warning and no application errors after
reload. The production build is served on local port 3002.

The broad frontend attempt had 247 passed and 11 failed: seven failures match the
previously documented consultation/OTP/billing-access baseline; extra typography,
billing-page and intake-filter failures occurred under host load. Typography and
billing-page and intake-filter reruns passed. No assertions or typography rules
were weakened. A temporary publication/draft selection inversion was rejected by
the new row regression test; the original source was restored immediately.
Backend contract checks had 95 passed and the same five failing assertions already
recorded by the original predeploy review (CI, Invitation, Seating, Staff and Venue
OpenAPI). The full backend attempt recorded numerous failures outside this patch
and was stopped before completion; its partial output is ignored in `.local-demo/`.
Do not treat these broader suites as green release gates.

These are local implementation/test results, not cloud deployment or external
provider acceptance. No cloud deployment was performed.
