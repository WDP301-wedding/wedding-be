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

Status: configuration prepared; data import, deployment and live verification
are tracked separately in the migration evidence.
