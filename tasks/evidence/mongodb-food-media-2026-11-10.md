# MongoDB food-image storage evidence — 2026-11-10

Scope: actual dish/menu-package image bytes and technical metadata in MongoDB
GridFS; content/prices/versions, associations/audit and commercial history stay in
PostgreSQL. Owner selected this scope and Render hosting in this chat and confirmed
workspace `my space` (`tea-dbcss8ks728c73851hl0`).

## Local verification

- Disposable MongoDB **8.3** on loopback port 27128; tests create random databases
  and drop only those databases. Existing business databases are not test targets.
- Disposable PostgreSQL databases created by existing catalog test fixtures on
  the local demo cluster at loopback port 55435. Initial startup/recovery failures
  were followed by a confirmed accepting-connections probe before rerunning.
- Focused acceptance: **12 files / 214 tests passed**, including signed access,
  selective storage, 17 MiB GridFS file, concurrent upload deduplication/orphan
  chunks, corrupt metadata/bytes, missing/deleted files, repeatable source copy,
  exact read-back, rollback export, and dish/menu publish/clone/replacement with
  both real databases. Existing food-media inheritance and hall-media tests pass.
- `npm run test:contract`: **23 files / 100 tests passed**.
- `npm run typecheck` (final), `npm run build`, `npm run api:generate`,
  `npm run api:check`, changed-source ESLint and `git diff --check`: passed.
- Official Render JSON Schema validation of the separate Blueprint: passed;
  Render's remote planning also accepted the new Private Service definition.
- OpenAPI SHA-256: `5e6ea2a0e3f9de33f458b5e82c6dffb11f7211a2b903f31804cb23a625eaa57d`.
  API shapes/authorization are unchanged; the signed-read description documents
  optional MongoDB-backed images. No Prisma migration is required or introduced.

Reproduce focused acceptance with `TEST_MIGRATION_DATABASE_URL` pointing at an
explicit disposable/local PostgreSQL and `TEST_MONGO_URI` pointing at disposable
MongoDB, then run Vitest for `src/integrations/storage`, `src/config/env.test.ts`,
`src/config/runtime-manifest.test.ts`, `tests/integration/mongodb-food-media.test.ts`,
`tests/integration/venue-catalog/mongodb-media.test.ts`,
`tests/integration/venue-catalog/food-media-inheritance.test.ts`, and
`tests/integration/venue-catalog/catalog-media-behavior.test.ts` with one worker.
The dedicated CI job supplies MongoDB 8.0 plus PostgreSQL 17; CI execution is
separate evidence and is not claimed by this local run.

## Existing broader verification limitations

The full Vitest suite was run with real local PostgreSQL and MongoDB; it is not
green. It reports failures in existing payment/print/notification/upgrade/realtime
fixtures outside the new scoped acceptance. Do not describe all backend tests as
passing or use the focused result as full release acceptance.

Baseline proof used a clean `git archive` of pre-change commit `1a0149d`, with the
same dependency installation, unchanged generated Prisma client and local test
database target. On that baseline:

- `tests/integration/payments-billing/operations-upgrade.test.ts` fails because
  its pre-upgrade schema lacks `RestaurantProfile.depositPercentage` when the
  current catalog seeder executes.
- `tests/integration/codex-realtime-review.test.ts` reproduces three failures:
  relay fixture expectations and missing runtime config in a broker fixture.
- Baseline comparison: **2 files / 4 failed, 2 passed**. This proves these specific
  failures predate MongoDB; it does not classify every broader-suite failure.

Full `npm run lint` also encounters six `no-undef` errors in the pre-existing,
untracked/ignored local browser artifact `.playwright-mcp/table-label-production-qa.js`.
That artifact was not edited/deleted and no lint rule, test, threshold or existing
acceptance guard was disabled. Changed TypeScript/JavaScript files pass ESLint.

## Render state and remaining acceptance

- Existing API `wedding-be-render-trial` is in Singapore, with its existing disk.
  Its deployment/configuration and PostgreSQL data have not been changed.
- A separate Blueprint was created with auto-sync **off**:
  `exs-dbpaln3rjlhs73fclk0g`. The reviewed plan creates only one new Private
  Service (`wedding-food-mongodb-u3p5`), 0.5 CPU / 512 MB, 1 GiB disk at `/data/db`,
  generated root/application credentials and no public web endpoint. No existing
  resources are adopted, replaced or removed.
- Plan URL: <https://dashboard.render.com/blueprint/exs-dbpaln3rjlhs73fclk0g/sync/exe-dbpalnbrjlhs73fcll2g>.
  Planning is not deployment; approval has not been applied.
- A read-only Render PostgreSQL inventory could not run through hosted MCP because
  the database correctly blocks external connections. No allowlist was widened.
  Actual source counts must be collected by migration inside the running API Shell.
- Pending: user approval of the concrete Render infrastructure plan, actual MongoDB
  deployment and authenticated persistence/restart checks, controlled API release,
  source copy/verification/cutover, and deployed Manager image operations with
  historical reads. Follow the [runbook](../../docs/mongodb-food-media-2026-11-10.md).
  No shared data migration, source deletion or production payment/generation ran.
