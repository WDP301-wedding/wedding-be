# Render migration trial — 22 October 2026

Owner requested moving the backend and PostgreSQL to Render and selected Free
for both resources. Target workspace is `my space`,
`tea-dbcss8ks728c73851hl0`. Backend and PostgreSQL 17 use Singapore and the
database's internal connection string. Supabase Storage remains the file store;
moving PostgreSQL does not copy or replace Storage objects.

## Deployment configuration

`render.yaml` records the desired trial configuration. It reuses the existing
Dockerfile and pins the migration branch rather than modifying Railway deployment
settings. Automatic deploys are off and there is one HTTP instance. Owner pools
retain the existing 1/3/2 profile and two-process rollout budget. Render Free
Postgres documents 100 connections; the application deliberately retains its
more conservative 60-slot declared ceiling until live verification.

Render's generated internal connection strings do not include a TLS query.
The Render-only startup script appends `sslmode=require&uselibpqcompat=true`
before the unchanged application entrypoint. It rejects already customized URLs
instead of creating a second query string. TLS is required over the private network;
Render documents self-signed internal certificates. This is scoped to the new
Render service and does not change external/Supabase TLS verification.

The complete approved Identity environment and stable OTP/notification credential
keys must be transferred securely from the existing deployment. Do not create
new keys for copied ciphertext. Secrets and database exports stay outside Git.
The Blueprint placeholders are not a complete standalone application environment.
Existing provider configuration, CORS origins and public invitation origin require
comparison with the source. Never log environment-variable values.

Free has no pre-deploy migration command or SSH. Import and validate the database
before first application startup. Future migrations use the controlled external
connection with TLS and an explicit migration environment; do not run migrations
against the source by copying an old environment accidentally.

## Data and acceptance sequence

1. Inspect the live source configuration and record source/target identities.
2. Export the application `public` schema with a consistent read-only PostgreSQL
   snapshot, including `_prisma_migrations`. Do not reset or modify the source.
3. Restore only into the newly created, verified-empty Render database. Preserve
   migration checksums and compare table row counts/content digests to that exact
   snapshot. Supabase-managed Auth/Storage schemas are not application migrations.
4. Start the Render service with Notifications, FCM, Seating reconciliation and
   AI jobs disabled. Do not run paid generation or real-money payment tests.
5. Verify the exact deployment, DB readiness, authentication/authorization,
   existing booking/Guest/Seating/billing/invitation reads and existing signed
   Storage downloads. Health 200 alone does not prove provider readiness.
6. Revoke verification sessions and inspect errors. Record copied data freshness,
   deployment identity, limitations and every unverified path.

The source remains authoritative during this trial. Before a final traffic switch,
stop source writes and background jobs, take a fresh export, validate the final
restore, update client API configuration and provider callback/egress settings,
then verify browser flows. The existing Railway/Supabase resources remain the
rollback source. Once the new DB accepts writes, switching back requires reconciling
those writes; never overwrite immutable contract, invoice or settlement history.

## Free-plan limits and outstanding work

The web service sleeps after 15 idle minutes, so it cannot provide continuously
running background jobs or a cold-start latency SLA. Free PostgreSQL expires after
30 days and does not include backups. Keep a verified local export and choose
paid capacity before using this as durable hosting. No production-readiness or
full-provider acceptance is implied by this migration trial.

References: [Render Free](https://render.com/docs/free),
[PostgreSQL connections](https://render.com/docs/postgresql-creating-connecting),
[Blueprint specification](https://render.com/docs/blueprint-spec).

## Verified trial result

Backend is Live at [wedding-be-render-trial.onrender.com](https://wedding-be-render-trial.onrender.com),
using deployment `dep-dbctdq6i0phs73fvqheg`, source `5a8d15488bbd2aa6473a5d95d0b8539ed08fa6a9`.
Resources were provisioned with MCP/CLI and the final Docker command was corrected
in the Dashboard. The validated Blueprint records matching desired settings; it is
not currently linked as the cloud resources' management source.

The consistent source snapshot started at **16:15:22 on 22 October (Asia/Saigon)**.
All **147 tables** matched row counts and content digests after restore; all
**65 migration records/checksums** matched. Target is PostgreSQL 17.11, with TLS 1.3
verified for the external import. Temporary external DB access is now closed and
application readiness remains 200 over the private connection.

All **32 authenticated/public smoke operations** returned expected statuses and
matched completion logs. Existing signed Storage download succeeded. CORS with the
existing frontend origin, secure refresh-cookie attributes, logout and token
revocation passed. One five-request parallel Guest wave took **518 ms**; this is
not a p95, browser end-to-end result or capacity claim. The post-smoke differences
are confined to seven expected security/audit/Analytics tables; the other 140
tables and migration checksums remain unchanged. Both deployed-commit CI jobs
passed, including PostgreSQL integration and coverage.

An initial diagnostic mistakenly printed the trial DB connection string in tool
output. Its credential has been replaced using Render-managed rotation; the old
role now has NOLOGIN and retains its owned objects. The new credential and copied
OTP/notification keys were verified without including their values in Git.

Free DB expiry: **21 November 2026**, approximately 16:05 Asia/Saigon. Workers remain
disabled on the trial. The existing Railway/Supabase deployment remains authoritative;
no frontend or traffic cutover has happened. To point a website preview to this API,
set its server-side `BACKEND_ORIGIN=https://wedding-be-render-trial.onrender.com`
and rebuild/redeploy that preview. Keep the frontend's same-origin API proxy.

[Sanitized migration evidence](../tasks/evidence/render-migration-trial-2026-10-22.json)
records failed attempts, successful verification and final-cutover prerequisites.
