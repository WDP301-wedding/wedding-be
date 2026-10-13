# Wedding Backend

Express REST API and the authoritative source for business rules, PostgreSQL schema and migrations, external-provider integrations, audit data, and the shared OpenAPI contract.

The platform spans four sibling repositories. Start with the [cross-repository development guide](docs/cross-repo-development.md) when setting up the full system.

## Documentation

Read the [confirmed backend scope](docs/backend-scope-2026-10-10.md), then choose
work from the [active backend backlog](tasks/backend-revision-todo.md). It is the
only executable checklist for BE, RV and SPEC-06 onward. SPEC-01–04 and SPEC-05
backend acceptance remain historical baselines, not proof of live external services;
see the [runtime/provider audit](tasks/evidence/spec01-05-runtime-audit-2026-10-10.md).
From SPEC-06 onward this repository owns backend work only; existing frontend code
is retained and future client delivery belongs to the frontend team.

### Requirements and Contracts

- [Frontend screen brief and copyable Stitch prompt (Vietnamese)](docs/frontend-stitch-design-brief-vi.md):
  role/channel screen map, business rules, UI states and the verified Swagger contract.

- [Product requirements](PRODUCT-REQUIREMENTS.md), [capability map](CAPABILITY-MAP.md)
  and [contract baseline](CONTRACT-BASELINE.md#23-group-and-optional-guest-list--2026-10-10).
- Foundation and completed modules: [Core](SPEC-core-platform.md),
  [Identity](SPEC-identity-access.md), [Venue](SPEC-venue-catalog.md),
  [Booking](SPEC-booking-lifecycle.md), [Payments](SPEC-payments-billing.md),
  [Invitation](SPEC-invitation-studio.md).
- Extensions and pending modules: [Commercial contracts](SPEC-commercial-contracts.md),
  [Guest](SPEC-guest-management.md), [Seating](SPEC-seating-plan.md),
  [Staff](SPEC-staff-operations.md), [Notifications](SPEC-notifications-automation.md),
  [Analytics](SPEC-analytics-dashboard.md), [Release](SPEC-release-demo.md).
- [Provider/ownership hand-off rules](docs/team-implementation.md) and
  [current Invitation hand-off](docs/spec-05-w2-w4-handoff.md).

### Development and Operations

- [Git and CI policy](CONTRIBUTING.md), [cross-repository setup](docs/cross-repo-development.md)
  and [local demo](docs/local-demo.md).
- [Database migrations](docs/database-migrations.md), [Identity operations](docs/identity-access-operations.md),
  [Brevo email](docs/brevo-email.md), [Railway deployment](docs/railway-deployment.md)
  and [dependency audit policy](docs/dependency-audit.md).

### History and Evidence

`tasks/evidence/` retains module verification and audit records; `docs/decisions/`
retains architectural decisions. Preserve both. Archived documents below are not
active task lists, current API contracts or fresh release/provider acceptance:

- [Historical implementation plan](docs/archive/plan-2026-10-10.md).
- [Historical task checklist](docs/archive/todo-2026-10-10.md).
- [Original post-Booking mixed-client scope](docs/archive/post-booking-experience-2026-10-08.md).
- [SPEC-05 W2–W4 checkpoint](tasks/evidence/spec05-w2-w4-handoff-2026-10-09.md).

Current intake/overview requirements now live in [Booking](SPEC-booking-lifecycle.md#11-intake-and-couple-overview);
account settings and current password OTP in [Identity](SPEC-identity-access.md#23-account-settings-and-current-password-otp).
The redundant SPEC-05/06 implementation guide has been removed; this index links
directly to its authoritative sources. Archival does not close any pending task.

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

The API listens on `http://localhost:3001` by default. Check `GET /health/live` for process liveness and `GET /health/ready` for readiness. Swagger UI is available at `/docs`, and the committed contract at `GET /api/v1/openapi.json`, outside production. Set `OPENAPI_ENABLED=true` to expose both in production. Swagger's **Try it out** executes real requests on the current backend, including mutations; protected endpoints still require normal authentication and authorization. Use **Authorize** with an access token; browser-managed refresh cookies are sent automatically. The UI adapts the canonical paths to their deployed `/api/v1` prefix while keeping root health paths and the client artifact unchanged.

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

Full commercial contract extension BE-06–10: [backend handoff](./docs/be06-10-commercial-contracts.md)
and [ADR-010](./docs/decisions/0010-freeze-full-commercial-contracts-before-deposit.md).
Implementation and pending acceptance evidence are tracked separately.

Only this repository changes `prisma/schema.prisma`, migration history, Zod API schemas, `openapi/openapi.json`, or its generated `openapi/openapi.sha256` digest. Applied migrations are immutable; corrections are new forward migrations. Client repositories consume the OpenAPI artifact pinned to an exact backend commit and the published digest, then generate their own `schema.d.ts` files. Do not hand-edit generated artifacts.

## Offline provider tests

Unit tests use `FakeStorageProvider`, `FakeEmailProvider`, and `FakeAiImageProvider`, so they make no paid or network calls. The real Supabase, Brevo, Resend, and Gemini adapters are tested through controlled client doubles. Run the focused provider suites with:

```powershell
npx vitest run src/integrations/storage/storage-provider.test.ts src/integrations/email src/integrations/ai-image/ai-image-provider.test.ts
```

See [cross-repository development](docs/cross-repo-development.md) for boot order, contract updates, troubleshooting, and the Android/EAS boundary.

See [Railway deployment](docs/railway-deployment.md) for the deployed backend,
container build, Supabase TLS configuration, and release verification.
