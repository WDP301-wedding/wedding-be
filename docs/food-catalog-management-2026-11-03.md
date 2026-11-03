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
