# Food catalog management, 2026-11-03

Owner requested a manage-web catalog revision and explicitly approved backend soft
deletion on 2026-11-03. Both repositories use branch
`codex/catalog-food-usability-20261103`.

## API and data contract

- Manager-only `DELETE /api/v1/management/catalog/dishes/{dishId}` and
  `DELETE /api/v1/management/catalog/menu-packages/{packageId}`.
- Send Bearer authorization, `Idempotency-Key` and JSON
  `{ "expectedRevision": 4 }`. Success: `200 { "data": { "revision": 5 } }`
  with the revision ETag. The existing persistent idempotency middleware applies.
- Authentication/authorization: 401/403; invalid UUID or revision: 422; stale,
  missing or already deleted record: 409 `CATALOG_LIFECYCLE_CONFLICT`.
- Additive migration `20261103010000_food_catalog_soft_delete` adds nullable
  `archivedAt` to Dish and MenuPackage and constraints requiring deleted records
  to remain RETIRED. Do not rewrite existing migrations.
- Deletion uses the existing aggregate advisory lock, serializable retry,
  expected-revision check and transactional `catalog.archived` audit record.
- Deleted aggregates disappear from management and public lists. Management
  detail reads return 404; restoration, draft update, cloning and publication
  cannot reactivate deleted records. Ordinary retirement remains reversible.
- Version records, menu items and commercial references remain intact. Exact
  historical readers continue resolving their original snapshots and integer VND
  prices. No contract, appendix, invoice or payment is changed.

## Frontend behavior

Only the newest working draft or current publication is displayed per aggregate.
Details are readable without cloning. Edit opens an existing draft or creates one
using the current published version. Save-and-publish first saves the entered data
and publishes with the revision returned by that update. New menu selections use
only the current publication of active dishes. All management cursor pages load.
Create forms and deletion confirmation use the existing dialog and design tokens.

## Local verification

Use the dedicated demo database at `127.0.0.1:55435/wedding_local_demo`; do not use
shared customer data. The manage-web local proxy targets backend port 3001 and the
frontend runs on port 3002. Demo credentials remain in ignored `.env.demo`.

The database behavior test applies every immutable migration to a fresh disposable
database and verifies deletion races, stale revisions, hidden lists, blocked
restoration/edit/publication and unchanged exact menu snapshots. HTTP tests cover
authorization and request validation. These checks do not claim cloud deployment
or live external-provider readiness.

Verified results:

- Backend typecheck, lint, build and OpenAPI generation/check passed.
- 31 HTTP/repository tests passed; 2 PostgreSQL behavior tests passed, including
  fresh-database migration rehearsal and concurrent deletion.
- Venue suite: 131 passed, 1 existing PRINT-facts assertion failed. That same
  failure and all 5 contract-suite failures reproduce at baseline `7ed1a1c`.
- Full backend test command was attempted and remains non-green: the overall
  integration harness needs its own valid migration configuration, alongside
  unrelated pre-existing behavior assertions. This is not full-suite acceptance.
- Manage-web: typecheck, lint, production build, API check and 28 catalog/typography
  tests passed. The full suite had 245 passed and 7 failures in consultation,
  billing-access and account-OTP tests. The identical 7 failures reproduce in a
  detached baseline worktree at `10f63cd` (29 other tests passed).
- Browser against real local HTTP/PostgreSQL verified creation, publication,
  published-version editing, menu dish ordering, read-only details, both lifecycle
  directions, confirmed DELETE 200 for dish/menu, persistence after reload,
  current-only media options, search/filter, Escape/focus return and no horizontal
  overflow at 320/768/1440 pixels. Console had no errors after authenticated reload;
  one development Socket.IO reconnect warning remains.

The original demo account's saved password did not match its existing verifier.
A separate synthetic `catalog-manager@demo.example` was created without changing
that existing account. Local-only credentials are in ignored
`.local-demo/catalog-login.json`. Screenshots and baseline JSON reports are also
under ignored `.local-demo/`; do not commit credentials or raw session traffic.
