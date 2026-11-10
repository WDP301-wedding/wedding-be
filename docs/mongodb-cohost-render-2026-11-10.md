# MongoDB in the existing Render service — 2026-11-10

The owner explicitly revised the separate-service plan and authorized deployment
inside `wedding-be-render-trial`, plan `1c-2g` (1 CPU / 2 GiB), using the existing
1 GiB disk. Do not create/apply the separate MongoDB Blueprint or increase plans
or disk size under this authorization. The earlier adapter/schema/API scope is
unchanged. Keep all PostgreSQL data, source images, contracts and payments.

## Runtime

The Docker runtime installs pinned MongoDB Community Server 8.0.34 from the
official Debian 12 repository plus Database Tools for native backups. It still
runs as the unprivileged `node` user. `scripts/render-start.sh` keeps its existing
TLS/migration behavior and selects the supervisor only when
`CATALOG_MONGO_EMBEDDED_ENABLED=true`.

MongoDB binds only to 127.0.0.1:27017 with authentication, stores its data beneath
`/var/data/mongodb` and limits WiredTiger cache to 0.25 GiB. Existing image sources
remain beneath `/var/data/wedding-media`. No MongoDB TCP endpoint is published.
Root and application passwords are separate, persistent Render secrets, generated
once and never logged or committed. The localhost bootstrap exception creates
the administrator only on an empty database. Existing credentials are never reset.
The API gets a readWrite-only account for `wedding_catalog`; administrator/app
password variables are removed from the child API environment (the application
connection URI necessarily contains its own credential).

Startup waits for authenticated readiness, runs `reconcile-to-mongo --apply`, and
only then starts the API. Reconciliation verifies existing Mongo-only images and
copies any missing retained legacy food images with exact read-back checks. It
does not require source files for new Mongo-only uploads on a later restart.
Missing active source images or corrupt images fail startup; missing previously
detached originals are counted. PostgreSQL writes are not part of reconciliation.

The supervisor handles SIGTERM/SIGINT, stops API/workers first, cancels an in-flight
reconciliation and then stops MongoDB. A bounded shutdown escalates stuck children;
unexpected MongoDB/API exit stops the sibling and fails the instance. MongoDB
therefore cannot silently disappear while the API keeps reporting ready.

## Release sequence and rollback

1. Capture live deploy/commit, disk headroom, food-media source counts and applied
   PostgreSQL migrations via read-only operations. Current inventory: 36 retained
   associations, 95,272,223 source bytes, 825,323,520 disk bytes available. These are
   measurements before deployment, not acceptance of the new runtime.
2. Build/deploy the reviewed exact commit with embedded mode off first. Verify the
   API, storage, MongoDB binary and disk paths. No plan/disk/branch change is needed
   when a specific Git commit is deployed manually. Keep auto-deploy off.
3. Generate missing root/app passwords securely in process memory and send them
   directly to Render env storage. Preserve all unrelated environment values.
   Enable embedded mode and deploy the same exact commit. Do not configure an
   external CATALOG_MONGO_URI; the supervisor injects its loopback URI.
4. Observe reconciliation counts, authenticated MongoDB access, scoped app role,
   checksum-verified reads, signed HTTP image reads and current/historical food
   associations. Probe retained non-food/private media and API readiness too.
5. Restart the same release and verify persistent image metadata/checksums and
   PostgreSQL evidence again. Record RAM/disk usage and process exit behavior.
   A live/health result alone is not feature-level acceptance.

For rollback after new Mongo-only uploads, pause food-media mutations and export
with the existing `export-to-disk --apply` CLI using the local application URI in
the running service, then verify all active files. Only after successful export
disable embedded mode and deploy the retained disk-only version. If initial
activation fails before the API serves writes, retained original disk files permit
direct rollback to the preceding disk-only release. Never restore the shared disk
snapshot as a MongoDB recovery method, delete source directories, or rewrite
commercial history. Use `mongodump`/`mongorestore` and backups outside this disk.

## Evidence and limits

Deployment completed on 2026-11-10: commit `feae2d7`, active deploy
`dep-dbphbbff3r2c7385jr2g`. The existing service still uses `1c-2g`, its original
1 GiB disk and only HTTP port 10000. Its source branch is
`codex/mongodb-food-media` with auto-deploy off; merge this branch before switching
the service back to `main`. Do not point the service at an older disk-only branch
without completing the export/rollback sequence above.

All 36 retained food images were copied and checksum-verified, with original
disk files retained. A real service restart verified unchanged metadata and
Mongo-only signed HTTP reads; reconciliation then verified 36 and copied zero.
All eight captured commercial/financial table hashes matched before and after.
See the evidence document and JSON record for target-specific checks and limits.

## Show MongoDB usage during a demonstration

In the running service's Render Shell, from `/app`, run this read-only command.
It prints database/version, actual GridFS collections, one metadata document and
the number of binary chunks for that document. It does not print credentials.

```sh
node --input-type=module <<'NODE'
import { MongoClient } from 'mongodb';
import { embeddedMongoSettings } from './dist/integrations/storage/embedded-mongo.js';
const settings = embeddedMongoSettings(process.env);
if (!settings) throw new Error('Embedded MongoDB is not enabled.');
const client = new MongoClient(settings.appUri);
try {
  const database = client.db(settings.database);
  const sample = await database.collection('food_images.files').findOne();
  console.log({
    database: settings.database,
    version: (await client.db('admin').command({ buildInfo: 1 })).version,
    files: await database.collection('food_images.files').countDocuments(),
    chunks: await database.collection('food_images.chunks').countDocuments(),
    sample,
    sampleChunks: sample
      ? await database.collection('food_images.chunks').countDocuments({ files_id: sample._id })
      : 0,
  });
} finally {
  await client.close();
}
NODE
```

Upload an image through the existing Manager interface, rerun the query sorted
by uploadDate if needed, and correlate its resourceId/content key with the API.
MongoDB stores actual bytes plus technical metadata; PostgreSQL retains catalog
content/prices/version associations and commercial history. No separate paid
MongoDB service or public MongoDB port is needed for this proof.

Local bootstrap/authentication, privilege-denial, restart credential reuse,
supervisor ordering/failures and Mongo-only reconciliation tests supplement the
earlier GridFS acceptance tests. The previous broad backend suite has documented
baseline failures; do not claim all backend tests pass. Record actual release
verification separately in tasks/evidence/mongodb-food-media-2026-11-10.md.
