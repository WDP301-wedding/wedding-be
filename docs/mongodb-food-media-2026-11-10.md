# MongoDB food catalog media — 2026-11-10

Owner authorization: store actual dish/menu-package image files and file metadata
in MongoDB, hosted as a separate private Render service. Dish/menu content,
prices, versions, bookings, contracts, invoices and payments remain in PostgreSQL.

## Design and acceptance

- Use the official MongoDB Node.js driver and GridFS: the existing upload limit
  is 25 MiB, larger than a single BSON document. Keep existing content keys,
  signed URL authorization, MIME/magic-byte checks and SHA-256 verification.
- MongoDB owns immutable bytes and file metadata (resource type/id, content type,
  checksum, size, upload time). PostgreSQL retains CatalogMediaAsset association,
  ordering, alternative text, actor, detach history and transactional audit.
- Route only new DISH_VERSION and MENU_PACKAGE_VERSION uploads/clones to MongoDB.
  Other media remain on disk. No public MongoDB port or direct frontend access.
- Explicit optional configuration keeps current deployments working. MongoDB
  reads may fall back to retained disk files only for genuinely absent objects;
  connection failures and corrupt objects must fail closed.
- Migration is explicit, repeatable, checksum-verified, bounded and non-destructive.
  Copy all retained food-media versions, including still-present detached files;
  report missing detached originals separately. Never delete source files or
  rewrite business snapshots. Export active MongoDB files before disk-only rollback.
- Verify routing, duplicate/concurrent uploads, >16 MiB files, corrupt/missing
  files, URL expiry/tampering, cloning and rollback with automated checks. Separate
  offline/local MongoDB evidence from deployed Render verification.

## Delivery steps

1. Implement and test the GridFS store and selective storage adapter.
2. Wire configuration, shared client lifecycle, upload/clone routing and manifest.
3. Add migration/export tooling, private Render service and operator runbook.
4. Run required repository checks and a disposable real MongoDB rehearsal.
5. Review infrastructure changes before applying the Render Blueprint; capture
   deployed upload/read evidence after deployment rather than infer it from health.

## API and ownership hand-off

No request/response shape or role changes. Existing Manager catalog upload,
replacement, ordering and version-clone routes retain authorization, idempotency,
revision/audit behavior and the 25 MiB storage limit. Consumers keep using the
returned expiring `/api/v1/storage/objects/...` URL. No database URI is sent to
Manager/Couple Web or Android; no frontend changes are required.

`food_images.files` stores the content key as unique `filename`, upload date,
length and `metadata`: `schemaVersion`, `resourceType` (DISH_VERSION or
MENU_PACKAGE_VERSION), `resourceId`, `purpose`, `objectKey`, `checksumSha256`,
`contentType`, `sizeBytes`. `food_images.chunks` holds binary chunks. MongoDB does
not become the source of dish/menu prices, descriptions or commercial versions.
PostgreSQL association/ordering/alternative text remains authoritative; there is
no second independently editable metadata copy to reconcile.

Signed reads remain private/no-store, validate expiration/signature before storage
access, and verify reconstructed bytes against the content key. Bad capabilities
or an absent object return 404. Invalid inputs retain 422; detected corruption
returns 502; a MongoDB connection failure returns 503. There is no unauthenticated
upload/list/delete endpoint. Configured MongoDB participates in readiness; a
healthy probe alone is not feature acceptance. While enabled, catalog reads check
MongoDB before disk, including non-food catalog keys; a MongoDB outage therefore
affects catalog media reads. Private wedding-media disk reads remain independent.

Upload persists MongoDB before attaching the PostgreSQL association. Existing
reference-aware cleanup handles an attachment failure. GridFS objects have unique
content keys; duplicate uploads reuse verified bytes. Clones get their own version
resource ID/key, preserving images for published historical versions. No distributed
transaction, PostgreSQL schema migration or historical agreement rewrite is added.

## Render deployment and cutover runbook

1. Deploy the separate `ops/render/mongodb.yaml` Blueprint, with auto-sync off.
   It creates only `wedding-food-mongodb`, a paid Docker Private Service in
   Singapore with its own 1 GiB disk at `/data/db`. It does not adopt/recreate the
   existing API or PostgreSQL database. Review the actual Render plan/cost before
   approving. The official `mongo:8.0` image receives patch updates on rebuild;
   promote tested image versions deliberately. The 0.25 GiB WiredTiger cache is
   explicit for a small service; monitor disk/memory and resize if needed.
2. Root and application passwords are generated server-side by Render. On an
   empty disk, the official MongoDB entrypoint creates the root user and executes
   `ops/mongodb/01-catalog-user.js`. The API uses `wedding_catalog_app` with only
   readWrite on `wedding_catalog`, never the root account. Initialization scripts
   do not rotate credentials on an existing disk. Rotate through MongoDB commands
   and coordinate API environment changes; never delete the disk to rotate.
3. Build/deploy the reviewed API commit with MongoDB unset first. Other media stay
   on the API disk. Do not remove or resize that disk as part of this migration.
4. Pause Manager food-media edits/clones during final copy/verification/cutover.
   Run commands in the **running API service Shell**, where its source disk is
   mounted; pre-deploy commands and one-off jobs cannot access that disk.
5. In that shell, set `CATALOG_MONGO_DATABASE=wedding_catalog` and
   `CATALOG_MONGO_URI=mongodb://wedding_catalog_app:<URL-encoded application password>@<MongoDB private host>:27017/wedding_catalog?authSource=wedding_catalog`.
   Obtain host/password from the MongoDB service Dashboard and keep them out of
   logs, Git, screenshots and frontend environment. Use the private hostname in
   the same Render region/workspace. Never expose MongoDB as a public Web Service.
   Shell-only exports do not enable MongoDB in the already-running API process.
6. The running-service Shell does not inherit the start script's exported TLS URL
   parameters. Before the CLI, require PostgreSQL TLS in shell DATABASE_URL too:

   ```sh
   case "$DATABASE_URL" in
     *\?*) ;; # Preserve an existing explicit TLS policy.
     *) export DATABASE_URL="${DATABASE_URL}?sslmode=require&uselibpqcompat=true" ;;
   esac
   npm run media:migrate -- copy-to-mongo
   npm run media:migrate -- copy-to-mongo --apply
   npm run media:migrate -- verify
   ```

   The first command only reads/checks source files; it does not validate a write
   to MongoDB. `--apply` performs writes and exact read-back checks. `verify` reads
   MongoDB against every PostgreSQL food-media manifest entry. Counts include
   associations, not distinct content keys. Missing **active** files, bad checksums,
   corrupt MongoDB objects and connection errors fail the command with exit 1.
   Missing already-detached originals are counted separately; retain that report.
   Review all counts and failures before cutover. Copy is repeatable and never
   deletes disk sources or updates CatalogMediaAsset/business tables.

7. Set the same two MongoDB variables persistently on the API service, deploy the
   reviewed API revision, and resume Manager edits after verification. Check a
   dish upload, menu upload, signed read/checksum, replacement, order, published
   version cloning and historical images; also check a hall and private invitation
   image. Record commit, counts and evidence without secrets. No live commercial,
   payment or generation operation is necessary.

## Rollback and backup

Freeze food-media edits, keep MongoDB enabled/available, and run
`npm run media:migrate -- export-to-disk --apply` in the API Shell with the same
environment. This includes newly uploaded/cloned MongoDB images. It verifies each
export against bytes/checksums and fails on missing active files. Only after a
successful export remove **both** MongoDB variables and redeploy disk-only mode.
Recheck current and historical images before resuming edits. Removing configuration
alone is insufficient once new images exist only in MongoDB.

Keep the MongoDB disk and original API files through acceptance and rollback
retention. Back up MongoDB with native `mongodump`/`mongorestore` (MongoDB Database
Tools); store backups outside the MongoDB disk and rehearse restoring to a disposable
database. Render filesystem snapshots are not database-consistent backups. Preserve
PostgreSQL backups independently because association/audit rows are still required.
No automatic retention or source cleanup is introduced by this revision.

## Reproducible local verification

Use a disposable MongoDB and `TEST_MONGO_URI` for `npm run test:mongo`. The suite
creates a unique test database and drops only that database. The CI MongoDB job
runs this suite against MongoDB 8.0. Run existing PostgreSQL catalog media/version
inheritance tests against a disposable local PostgreSQL too. Production MongoDB
URI variables are not needed by the test suite.

Official references: [GridFS Node driver](https://www.mongodb.com/docs/drivers/node/current/crud/gridfs/),
[MongoDB on Render](https://render.com/docs/deploy-mongodb),
[disk constraints](https://render.com/docs/disks), and
[Blueprint schema](https://render.com/docs/blueprint-spec).
