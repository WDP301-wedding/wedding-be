# Cross-repository development

This guide is the onboarding source for the four independently versioned Wedding Management repositories. Keep the repositories as siblings because every client contract generator defaults to `../wedding-be/openapi/openapi.json`.

```text
workspace/
├── wedding-be/
├── wedding-web/
├── wedding-manage-web/
└── wedding-app/
```

## Ownership boundaries

| Repository                                                                   | Owns                                                                                                                                                        | Does not own                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`wedding-be`](https://github.com/WDP301-wedding/wedding-be)                 | Express API, authoritative business validation, PostgreSQL/Prisma, migrations, audit records, external-provider adapters, Zod schemas, and OpenAPI artifact | Browser/native presentation or client-side business authority |
| [`wedding-web`](https://github.com/WDP301-wedding/wedding-web)               | Public, Guest, and Couple Next.js experiences                                                                                                               | Database access, secrets, or independent API schemas          |
| [`wedding-manage-web`](https://github.com/WDP301-wedding/wedding-manage-web) | Manager and Staff Next.js experiences                                                                                                                       | Database access, secrets, or independent API schemas          |
| [`wedding-app`](https://github.com/WDP301-wedding/wedding-app)               | Couple workflows in the Expo/React Native Android app                                                                                                       | Database access, secrets, or independent API schemas          |

Client validation exists for user experience. The backend remains authoritative for state changes, authorization, booking, payment, refund, invitation delivery, seating, and check-in.

## Shared Codex design skill

The canonical Wedding UI skill is committed at
`.codex/skills/wedding-design-system/` in `wedding-be`. It applies to UI work in
`wedding-web`, `wedding-manage-web`, and `wedding-app`; it does not apply to
backend-only work.

From `wedding-be`, install or refresh the user-scoped copy so Codex can discover
the same skill while working from any of the four sibling repositories:

```powershell
.\scripts\install-codex-skills.ps1
```

Use `$wedding-design-system` explicitly when assigning a Wedding UI task. Commit
changes to the canonical repository copy first, then rerun the installer to refresh
the local copy. Do not maintain independent edited copies in the client repositories.

The files in `assets/approved-samples/` are visual references only. They establish
hierarchy, density, shape, color, and tone, but they contain known copy and
typography defects. Never copy visible wording, spelling, line breaks, or glyph
rendering from those screenshots; product requirements and reviewed Vietnamese
copy are authoritative.

## First local start

All repositories require Node.js 24.21.0 (the version pinned in `.node-version`) and npm 11.x. From each repository, use `npm ci`; do not use `npm install` to reproduce the committed lockfile.

1. Start the backend from `wedding-be`:

   ```powershell
   npm ci
   Copy-Item .env.example .env
   npm run dev
   ```

2. In `wedding-web` and `wedding-manage-web`, copy `.env.example` to `.env.local`, install, and start each app. Next.js selects the next free port unless one is supplied; use `npm run dev -- --port 3000` for public web and `npm run dev -- --port 3002` for management web when matching the backend CORS example.

3. In `wedding-app`, copy `.env.example` to `.env`, install, and run `npm run android`. `10.0.2.2` reaches the host machine from the standard Android emulator. A physical device needs a reachable development-machine address and matching backend network/CORS configuration.

Only the client API base URLs are public configuration. Values prefixed `NEXT_PUBLIC_` or `EXPO_PUBLIC_` are compiled into client output and must never contain credentials.

## Safe placeholder and offline configuration

The committed `.env.example` files contain placeholders, not usable secrets. Real `.env*` files are ignored by Git.

For backend work that does not require PostgreSQL or external services, clear `DATABASE_URL`, `MIGRATION_DATABASE_URL`, all three `SUPABASE_*` variables, both `RESEND_*` variables, `AI_IMAGE_PROVIDER`, both `GEMINI_*` variables, `METRICS_TOKEN`, and `OTEL_EXPORTER_OTLP_ENDPOINT`. Keep `METRICS_ENABLED=false`. Optional configuration is normalized from blank strings to disabled features.

Tests must not call paid or network providers. Use the backend fakes:

- `FakeStorageProvider`
- `FakeEmailProvider`
- `FakeAiImageProvider` or `DisabledAiImageProvider`

The real adapters are exercised with controlled client doubles in their unit tests. Never put a service-role key, Resend key, Gemini key, production database URL, signing key, or EAS access token into a client repository, test fixture, issue, log, or committed example.

## Database connections and migrations

Only `wedding-be` owns database changes.

| Variable                 | Consumer                                     | Purpose                                                                                             |
| ------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | Running backend through `@prisma/adapter-pg` | Normal application queries; use a direct connection or Supavisor session mode on port 5432          |
| `MIGRATION_DATABASE_URL` | Prisma CLI through `prisma.config.ts`        | Schema migration privileges; use a direct connection or session mode, never transaction-pooler mode |

Both URLs require `sslmode=require` or a stricter mode in staging and production. Prefer separate least-privilege runtime and migration roles even when they target the same database.

Create a development migration with:

```powershell
npm run db:migrate -- --name <migration_name>
npm run db:generate
```

Review and commit `prisma/schema.prisma` and the new directory under `prisma/migrations/`. Run `db:generate` locally; this repository ignores its generated Prisma client output. Apply already committed migrations in CI/staging/production with `npm run db:migrate:deploy`. Never use `prisma db push` on a shared environment and never edit an applied migration; recover with a new forward migration. The detailed recovery policy is in [database migrations](database-migrations.md).

## Immutable OpenAPI update flow

`wedding-be` is the single contract authority. Client repositories pin a released artifact in `api-contract.lock.json`; they never import backend source.

1. Change backend Zod route schemas and tests.
2. In `wedding-be`, run `npm run api:generate`, `npm run api:check`, and `npm run test:contract`.
3. Commit and push the backend change first. Record the exact 40-character commit SHA containing `openapi/openapi.json` and calculate that file's SHA-256 digest.
4. In each client, update only the `repository`, `commit`, `path`, and `sha256` fields in `api-contract.lock.json`. The commit must be immutable; never use `main`, another moving branch, or an uncommitted local artifact as the recorded source.
5. With the four repositories in the sibling layout, run `npm run api:generate` in every client. This validates the digest and rewrites only `src/lib/api/generated/schema.d.ts`.
6. Run `npm run api:check`, client tests, and client builds; then commit each lock file and generated schema together.

For an explicit local source, set `OPENAPI_SOURCE` only for the command process:

```powershell
$env:OPENAPI_SOURCE = Resolve-Path ..\wedding-be\openapi\openapi.json
npm run api:check
Remove-Item Env:OPENAPI_SOURCE
```

Client CI downloads `openapi/openapi.json` from the exact GitHub commit in the lock file, verifies the SHA-256 digest, and runs `api:check`. Private repositories may supply a fine-grained, read-only `BACKEND_CONTRACT_READ_TOKEN` as a CI secret; it is not a client runtime variable.

## Quality gates

Run commands from the owning repository.

| Repository           | Local gate sequence                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wedding-be`         | `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run api:check`, `npm run test:coverage`, `npm run build`, `npm run audit:ci`; PostgreSQL-backed migration/integration gates additionally need both database URLs |
| `wedding-web`        | `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run api:check`, `npm run test:coverage -- --maxWorkers=2`, `npm run build`, `npm audit --audit-level=high`                                                       |
| `wedding-manage-web` | `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run api:check`, `npm run test:coverage -- --maxWorkers=1`, `npm run build`, `npm audit --audit-level=high`                                                       |
| `wedding-app`        | `npx --yes expo-doctor@1.20.4`, `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run api:check`, `npm run test:coverage`, `npm run build`, `npm run audit:ci`                                                     |

## Android and EAS boundary

- `npm run android` starts Expo locally and opens an Android target; it does not create a distributable build.
- `npm run build` performs an offline Android JavaScript export to `dist/`. CI uses this as the core-platform build gate and does not require EAS credentials.
- `eas.json` defines the later `preview` Android APK profile. A manual `npx eas-cli@23.2.0 build -p android --profile preview` uses Expo's cloud service, requires the project to be linked and authenticated, may consume quota or incur cost, and is outside routine CI.
- `EXPO_PUBLIC_EAS_PROJECT_ID` remains blank until the project is linked. The `release-demo` capability owns the final downloadable Android artifact and store/signing decisions.

## Troubleshooting

| Symptom                                       | Resolution                                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node/npm engine warning or install failure    | Use the versions in `.node-version` and `packageManager`, then rerun `npm ci`                                                                                    |
| Backend exits during configuration parsing    | Check that provider variables are either all present or all blank; Gemini and metrics require their enabling variables and companion secrets                     |
| Browser client cannot call the backend        | Confirm the client base URL, backend port, and exact origin in `CORS_ALLOWED_ORIGINS`; do not use wildcard origins                                               |
| Android emulator cannot reach `localhost`     | Use `http://10.0.2.2:3001` for the standard emulator; use a reachable LAN address for a physical device and HTTPS outside development                            |
| `api:check` reports a digest mismatch         | Use the backend artifact from the exact commit in `api-contract.lock.json`, or update the lock to the newly committed backend SHA and digest before regenerating |
| `api:check` says the schema is stale          | Run `npm run api:generate`, review the generated diff, and commit the lock and schema together                                                                   |
| Prisma migration cannot connect               | Ensure `MIGRATION_DATABASE_URL` is direct/session mode with migration privileges; transaction-pooler URLs are unsupported for Prisma Migrate                     |
| Web ports collide                             | Start explicitly with `npm run dev -- --port 3000` and `npm run dev -- --port 3002`, then keep backend CORS origins synchronized                                 |
| EAS prompts for credentials or a project link | Stop unless intentionally performing the manual release-stage cloud build; local development and CI do not need EAS                                              |

## Repeatable local PostgreSQL acceptance database

Identity-access migration and concurrency tests must use a disposable PostgreSQL database, never
the shared Supabase `public` schema. On Windows, start Docker Desktop and create the same PostgreSQL
17 class used by CI:

```powershell
docker run --name wedding-ia17-postgres --rm -d `
  -e POSTGRES_DB=wedding_ia17 `
  -e POSTGRES_USER=wedding_ia17 `
  -e POSTGRES_PASSWORD=wedding_ia17_only `
  -p 127.0.0.1:55432:5432 `
  postgres:17

docker exec wedding-ia17-postgres pg_isready -U wedding_ia17 -d wedding_ia17

$env:DATABASE_URL = 'postgresql://wedding_ia17:wedding_ia17_only@127.0.0.1:55432/wedding_ia17'
$env:MIGRATION_DATABASE_URL = $env:DATABASE_URL
$env:TEST_MIGRATION_DATABASE_URL = $env:DATABASE_URL
```

Run migration/integration/coverage gates in that same PowerShell session. Stop the container after
the audit; `--rm` removes it automatically:

```powershell
docker stop wedding-ia17-postgres
```

## Windows Next.js SWC file locks

`npm ci` deletes `node_modules` before reinstalling. If a `next dev` process is active, Windows can
hold `next-swc.win32-x64-msvc.node` open and cause `npm ci` to fail with `EPERM`. Stop the exact
Public Web or Management Web dev terminal with `Ctrl+C`, then rerun `npm ci`. If the owner is not
obvious, use Process Explorer's **Find Handle** search for the SWC filename and stop only the process
whose command line points at the affected repository. Never use a blanket `taskkill /IM node.exe`
because it can terminate unrelated Node.js work.
