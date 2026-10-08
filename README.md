# Wedding Backend

Express REST API and the authoritative source for business rules, PostgreSQL schema and migrations, external-provider integrations, audit data, and the shared OpenAPI contract.

The platform spans four sibling repositories. Start with the [cross-repository development guide](docs/cross-repo-development.md) when setting up the full system.

For current implementation status and remaining work, use the [implementation plan](tasks/plan.md)
and [task list](tasks/todo.md). Completed checklists and earlier acceptance records are
indexed in the [documentation archive](docs/archive/README.md). Product requirements,
module SPECs, the contract baseline, and operational guides remain current references.

## Prerequisites

- Node.js 24.21.0 (see `.node-version`)
- npm 11.x
- PostgreSQL when running migrations or database integration tests

## Quick start

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

The API listens on `http://localhost:3001` by default. Check `GET /health/live` for process liveness and `GET /health/ready` for readiness. The committed contract is available at `GET /api/v1/openapi.json` outside production.

The values in `.env.example` are placeholders. For offline development, clear both database URLs and every Supabase, Brevo, Resend, and Gemini variable as complete groups; leave `AI_IMAGE_PROVIDER` blank. Provider adapters are not contacted merely by starting the current foundation server.

## Environment and secrets

- `DATABASE_URL` is used by the running application. `MIGRATION_DATABASE_URL` is used only by Prisma Migrate. They may identify the same local database, but they are separate credentials in deployed environments.
- Supabase service-role, Brevo, Resend, Gemini, database, and metrics credentials belong only in the backend environment.
- A provider configuration is all-or-none. Enabling Gemini also requires `GEMINI_API_KEY` and `GEMINI_IMAGE_MODEL`.
- Use `BREVO_API_KEY` and `BREVO_FROM_EMAIL` for transactional email. Configure only one email provider; legacy `RESEND_*` credentials remain supported. Staging and production require a complete email provider configuration. See [Brevo setup](docs/brevo-email.md).
- Never commit `.env`, credentials, private keys, service-account files, or real values copied into `.env.example`.
- Staging and production database URLs require TLS; see [database migrations](docs/database-migrations.md).

## Common commands

| Command                               | Purpose                                                 |
| ------------------------------------- | ------------------------------------------------------- |
| `npm run dev`                         | Run the API with file watching                          |
| `npm run build`                       | Compile production JavaScript to `dist/`                |
| `npm run start`                       | Run the compiled server                                 |
| `npm run lint`                        | Run ESLint with zero warnings allowed                   |
| `npm run typecheck`                   | Type-check without emitting files                       |
| `npm run test`                        | Run all Vitest tests                                    |
| `npm run test:unit`                   | Run tests outside `tests/`                              |
| `npm run test:integration`            | Run PostgreSQL-backed integration tests when configured |
| `npm run test:contract`               | Verify API contract behavior                            |
| `npm run test:coverage`               | Run the coverage gate                                   |
| `npm run db:generate`                 | Generate the Prisma client                              |
| `npm run db:migrate -- --name <name>` | Create and apply a development migration                |
| `npm run db:migrate:deploy`           | Apply committed migrations without creating new ones    |
| `npm run db:studio`                   | Open Prisma Studio                                      |
| `npm run api:generate`                | Regenerate the OpenAPI artifact and SHA-256 digest      |
| `npm run api:check`                   | Fail if the committed artifact or digest is stale       |
| `npm run audit:ci`                    | Enforce the reviewed dependency-audit policy            |

## Database and API ownership

Only this repository changes `prisma/schema.prisma`, migration history, Zod API schemas, `openapi/openapi.json`, or its generated `openapi/openapi.sha256` digest. Applied migrations are immutable; corrections are new forward migrations. Client repositories consume the OpenAPI artifact pinned to an exact backend commit and the published digest, then generate their own `schema.d.ts` files. Do not hand-edit generated artifacts.

## Offline provider tests

Unit tests use `FakeStorageProvider`, `FakeEmailProvider`, and `FakeAiImageProvider`, so they make no paid or network calls. The real Supabase, Brevo, Resend, and Gemini adapters are tested through controlled client doubles. Run the focused provider suites with:

```powershell
npx vitest run src/integrations/storage/storage-provider.test.ts src/integrations/email src/integrations/ai-image/ai-image-provider.test.ts
```

See [cross-repository development](docs/cross-repo-development.md) for boot order, contract updates, troubleshooting, and the Android/EAS boundary.
