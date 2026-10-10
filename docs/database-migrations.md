# Database migrations

`wedding-be` is the only repository allowed to change the PostgreSQL schema.
The 2026-10-10 guest-plan terminology change renames the Prisma/application property
to `sourceGuestPlanRevisionId` and explicitly maps it to the existing physical
column/unique constraint. This is a code-only rename with no data rewrite or DDL.
Historical applied SQL and persisted event/audit payloads retain their original
field spelling; new headcount metadata uses the guest-plan spelling. Any future
event consumer must use the approved guest-plan contract, not parse old audit rows.
Prisma migration files in `prisma/migrations/` are immutable after they have been
shared or applied outside a developer's disposable database.

## Connection and deployment rules

- `DATABASE_URL` is the application's runtime connection. Use a direct
  connection when IPv6 is available, otherwise use Supavisor session mode on
  port 5432.
- `MIGRATION_DATABASE_URL` is used only by Prisma Migrate. Use a direct
  connection or Supavisor session mode; transaction-pooler mode is prohibited.
- Both connections require TLS outside local development. Migration credentials
  must use a dedicated PostgreSQL role with only the required schema privileges.
- Use `npm run db:migrate -- --name <migration_name>` for development and commit
  the generated SQL. Use `npm run db:migrate:deploy` as an explicit staging or
  production release step. Never use `prisma db push` on a shared environment.

## Fresh-database verification

The migration history must be deployable without a pre-existing application
schema. Run the automated rehearsal against a disposable PostgreSQL database or
a migration role that may create and drop an isolated schema:

```bash
npx vitest run tests/integration/migration-policy.test.ts
```

The test creates a unique schema, deploys the committed migration history into
it, verifies the expected tables and successful migration records, rehearses a
forward correction, and drops the schema. It skips when
`MIGRATION_DATABASE_URL` is absent so unit-only environments do not receive a
false failure. CI and release verification must provide that variable; a skip is
not acceptable evidence there.

## Rollback policy: correct by moving forward

Never edit, delete, reorder, or replace an applied migration. A successfully
applied migration is not marked rolled back with `prisma migrate resolve`.
`resolve --rolled-back` is reserved for reconciling a migration that actually
failed and was repaired according to Prisma's recovery procedure.

If a released schema change must be reversed:

1. Stop the rollout and determine whether the current and previous application
   versions are both compatible with the current schema. Do not redeploy an
   incompatible older application.
2. Preserve the applied migration exactly as committed. In a disposable
   development database, create a new, later-named compensating migration:

   ```bash
   npm run db:migrate -- --name compensate_<original_name>
   ```

3. Prefer an additive or compatibility-preserving correction. Any destructive
   correction requires an expand/migrate/contract plan, verified backup and
   restore evidence, and project-owner approval before deployment.
4. Review the generated SQL and data impact, then test the complete migration
   history against an empty PostgreSQL database and against a production-like
   snapshot when data transformation is involved.
5. Deploy the compensating migration with `npm run db:migrate:deploy`, run
   `npx prisma migrate status --config prisma.config.ts`, and execute the
   affected integration and smoke tests before resuming the rollout.

The checkpoint rehearsal proves this policy mechanically: it applies a probe
change, leaves that migration and its successful history row intact, applies a
new forward migration that compensates for the probe, and verifies the final
schema rather than rewriting migration history.
