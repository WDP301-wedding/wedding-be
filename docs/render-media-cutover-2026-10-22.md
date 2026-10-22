# Render disk and production website cutover

The owner authorized moving existing Supabase images to Render and connecting the
official wedding-web deployment directly, without a frontend preview. The approved
budget is the smallest paid backend ($7/month) plus a 1 GB disk ($0.25/month).
PostgreSQL stays Free and expires on 2026-11-21; this is not durable paid DB hosting.
The owner also authorized restoring email, FCM, AI and internal scheduling workers
to the existing Railway configuration after the final data transfer. Blueprint
worker flags use `sync: false` so applying infrastructure does not overwrite that
operator-controlled cutover state.

## Storage contract

`STORAGE_DRIVER=render-disk` requires `STORAGE_DISK_PATH=/var/data/wedding-media`,
`STORAGE_PUBLIC_ORIGIN=https://wedding-be-render-trial.onrender.com` and a separate
random `STORAGE_SIGNING_KEY` of at least 32 characters. Keep that key stable across
restarts and out of source control. The service has one instance and a disk mounted
at `/var/data`. Deploys have a brief interruption with an attached disk.

The existing content keys, database references, MIME validation, 25 MB limit and
resource ownership checks are unchanged. Atomic uploads never overwrite different
content. Reads verify MIME/magic bytes and SHA-256 against the content key.
Authorized API responses return an absolute URL under `/api/v1/storage/objects/`
with an HMAC signature bound to the complete object key and expiry. Default expiry
is 15 minutes, maximum one hour. Missing, malformed, altered or expired grants
return 404. Responses are private/no-store; there is no public listing or upload
endpoint. URL signatures are bearer credentials: do not record their query strings.
The canonical OpenAPI includes the signed image endpoint. No schema migration is
needed. Existing Supabase configuration remains available for rollback.

## Additive media transfer

Before cutover, save a local source inventory and byte-verified backup. The first
inventory contained 14 objects totaling 3,526,278 bytes. Originals stay on Supabase.
With the destination disk attached and the source credentials configured, set
`STORAGE_IMPORT_FROM_SUPABASE=true` for one controlled deployment. The start script
executes `scripts/render-copy-media.mjs` before starting the API. It recursively
lists the two existing prefixes, validates every content key, downloads originals,
and uses the same disk provider to write and read back each image. A mismatch or
unexpected key aborts startup. It writes a private receipt inside the disk and logs
only object count, total bytes and an aggregate inventory hash. It is additive and
safe to retry. Then set the import flag to false and redeploy to verify persistence
without any source-storage dependency. Never import into the build filesystem.

## Database and website switch

The earlier trial is a snapshot, not a continuous replica. Compare the target with
the recorded post-smoke snapshot before replacing any data. Back up both databases;
freeze the old writer and workers before the final consistent source export.
Restore transactionally into the named Render target only after confirming there
are no unexpected target business changes. Verify every public table digest and all
65 applied migration records. Close temporary external DB access after verification.
Do not delete the old database or source media.

The website keeps `/api/v1` on its own origin for secure refresh cookies. Change the
production rewrite to Render and allow only Render's signed-object path in the image
optimizer. Set server-only `BACKEND_ORIGIN` to the Render origin. Deploy production
directly after backend/data verification, then check login, refresh, catalog/media
and the relevant Couple routes in a real browser. A health response alone is not
feature acceptance. Other client repositories are outside this change.

Rollback after accepting new writes must preserve those writes: freeze Render,
export and reconcile them before reverting the website. Never simply point back
at the stale source. Notification/FCM/AI worker flags remain explicit and must not
be enabled during read-only migration verification. Provider credentials or offline
tests do not establish live email, push, generation or payment readiness.

Render disk snapshots are daily and retained seven days. Keep an independent
verified export of media and a PostgreSQL-native backup; disk snapshots do not back
up managed PostgreSQL. Runtime results and exact revisions are recorded separately.

## Deployment from main

The owner authorized switching the backend's deployment branch to `main` and
enabling automatic deployments after the cutover. `render.yaml` records
`branch: main` and `autoDeployTrigger: checksPass` (After CI Checks Pass).
Pushes and merges to `main` deploy after all GitHub CI checks pass; failed checks
or commits with no checks do not deploy. The existing Render service must also
have these settings applied because the Blueprint is not linked for automatic
infrastructure synchronization.

Automatic deployment builds the application image; it does not apply database
migrations. Continue to handle new migrations through the controlled database
release procedure. The attached media disk and operator-managed secrets and
worker flags remain in place across deployments.
