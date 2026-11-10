# MongoDB food-image storage evidence — 2026-11-10

## Owner-authorized co-hosted continuation

The owner subsequently requested actual deployment inside the existing 25 USD
backend service, replacing the separate-service plan. No additional Render
service or disk-size/compute-plan increase is authorized. Follow the
[co-hosted runbook](../../docs/mongodb-cohost-render-2026-11-10.md).

Pre-release verification: **221/221 scoped tests** on disposable PostgreSQL 18.6
and MongoDB 8.3; **2/2 additional auth-enabled MongoDB bootstrap/privilege tests**;
**101/101 contract tests**; final typecheck/build, changed-file ESLint, OpenAPI
check, shell syntax check and dependency audit pass. Audit reports no high/critical
advisories. A fail-fast broad sweep still reproduces the previously observed
`media-native-providers.test.ts` COMPLETED-phase fixture failure (expected 404,
received 409); no existing test/quality guard was disabled.

Read-only live preflight: existing service `1c-2g`, same 1 GiB disk, 825,323,520
bytes available; 30 dish-image and 6 menu-image associations, 95,272,223 source
bytes total. Applied PostgreSQL migrations match the release (no new migrations).
Hashes/counts were captured for contract revisions/lines/approvals, appendices,
invoice revisions, ledger entries and payment attempts to compare after release.
The pre-release live deploy is `dep-dbotpo95efls73f02m0g`, commit `1149479`.
Actual deployment, migration and restart verification follow; local results alone
are not deployed acceptance.

### Observed co-hosted release

- Existing service only: `srv-dbct9ao473hc73a5qud0`, plan `1c-2g`, original disk
  `dsk-dbctva0m7kps73cubbb0`, size 1 GiB, one instance, Singapore, only public HTTP
  port 10000. No new service/disk or plan increase; separate Blueprint unapplied.
- Commit `feae2d796d5420418eb39d83331a9b264b587b38`; phase-one disk-only deploy
  `dep-dbph93ec6qcc73allc00` became live at 2026-11-10 13:00:08 UTC. Embedded-mode
  deploy `dep-dbphbbff3r2c7385jr2g` became live at 13:02:31 UTC (20:02:31 Saigon).
- MongoDB **8.0.34**, `wedding_catalog`, `food_images.files`/`food_images.chunks`.
  First reconciliation: examined 36, verified 36, written 36, missingDetached 0.
  Original disk files remained present and checksum-matched for every association.
- Actual service restart changed instance `q8b5s` to `lqq6q`; next reconciliation
  at 13:04:51 UTC verified the same 36 and wrote **zero**. GridFS metadata digest
  before/after: `f5f511e3681d511674a737e17ca30bd31b99c1eaf9332749be8e8da1cbe36198`.
  Retained association/key/checksum digest:
  `cf4f514bf34e729edca465d9be29c68a7b8cee3c3740ee2a5f10eca5b6234db8`.
- An owned synthetic image existing **only in MongoDB**, with no source disk file
  or PostgreSQL association, was fetched through the deployed signed HTTPS route
  with an exact checksum match before and after restart. A separately owned
  private disk image and an existing Hall image passed signed HTTPS checks too.
  Tampered signatures returned 404. Anonymous MongoDB reads and the app account's
  admin serverStatus command were denied. Both owned probe objects were removed
  after verification; no customer/catalog association was created/deleted.
- The actual public `/api/v1/catalog/dishes` and `/api/v1/catalog/menu-packages`
  endpoints returned 200 with current catalog items and image URLs; an image
  returned by each endpoint was fetched successfully with non-empty bytes. Thus
  verification covers the catalog API-to-image flow, beyond direct storage probes.
- Counts and SHA-256 hashes matched across all rows in eight pre-existing tables:
  contract revisions, contract lines, contract approvals, appendix revisions,
  appendix approvals, final invoice revisions, ledger entries and payment attempts.
  Native rollback export verified all 36 images with no missing detached sources.
- MongoDB WiredTiger cache limit: 268,435,456 bytes. After-restart Render memory
  samples peaked at 552,484,860 bytes and ended at 483,041,280 bytes against 2 GiB;
  free disk observed at 516,505,600 bytes after restart. These are bounded samples,
  not a sustained-load or future-capacity guarantee.
- A synthetic three-page Chromium PDF smoke ran in the same active container,
  with external browser requests blocked and API readiness HTTP 200 during rendering.
  PDF: 23,868 bytes; cgroup memory after PDF 974,831,616 bytes, below 2 GiB. This
  tests headless browser availability/resource sharing, not every production PDF.
- Source branch is `codex/mongodb-food-media`, auto-deploy remains off. Merge the
  release branch before changing back to main; rollback requires the verified
  export sequence when new Mongo-only catalog images exist.
- [Machine-readable release evidence](./mongodb-cohost-render-2026-11-10.json).
  No real-money payment, paid generation, credential logging or shared-data deletion
  was performed. Existing broader backend-suite limitations remain below.

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

The full Vitest suite completed with real local PostgreSQL and MongoDB (exit 1,
1,418.49 seconds): **289 files passed, 51 failed; 2,323 tests passed, 162 failed,
16 skipped; two worker errors**, as reported by Vitest. Workers running
`booking-lifecycle/runtime.test.ts` and `commercial-contracts-api.test.ts` exited
unexpectedly with Windows exit code `3221226505`; their remaining tests are not
verified by this sweep. This run is not green. It reports failures in existing payment/print/notification/upgrade/realtime
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
- Latest plan URL: <https://dashboard.render.com/blueprint/exs-dbpaln3rjlhs73fclk0g/sync/exe-dbpamrbrjlhs73fcpdeg>,
  generated from reviewed commit `96d35b3`. Planning is not deployment. After
  reviewing the concrete plan/cost, the owner chose **keep the plan, do not deploy**
  in this chat on 2026-11-10. Approval was not applied and no paid service was created.
- A read-only Render PostgreSQL inventory could not run through hosted MCP because
  the database correctly blocks external connections. No allowlist was widened.
  Actual source counts must be collected by migration inside the running API Shell.
- Deferred by the owner: approval of the concrete Render infrastructure plan, actual MongoDB
  deployment and authenticated persistence/restart checks, controlled API release,
  source copy/verification/cutover, and deployed Manager image operations with
  historical reads. Follow the [runbook](../../docs/mongodb-food-media-2026-11-10.md).
  No shared data migration, source deletion or production payment/generation ran.
