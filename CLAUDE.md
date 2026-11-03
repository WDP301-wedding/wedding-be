# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

`AGENTS.md` holds the binding ownership and business rules (backend-only scope,
the 2026-10-19 wedding-web remediation exception, Group + optional Guest, no RSVP,
integer VND money, immutable commercial history, no rewriting applied migrations,
no paid/real-money/destructive provider calls during audits). Follow it. Before
planning new work also read `docs/backend-scope-2026-10-10.md`; the active backlog
is `tasks/backend-revision-todo.md` (the website revision tracks its tasks in
`../wedding-web/tasks/`). SPEC-*.md files are per-module specs; `docs/archive/` is
historical, not current contract.

## Commands

Node 24.x (`.node-version`), npm 11. ESM project (`"type": "module"`) — relative
imports use the `.js` suffix even from `.ts` files.

```bash
npm ci && npm run db:generate      # Prisma client is generated into src/generated/prisma (gitignored)
npm run dev                        # tsx watch, http://localhost:3001; Swagger at /docs
npx vitest run path/to/file.test.ts           # single test file
npx vitest run path/to/file.test.ts -t "name" # single test case
npm run test:unit                  # colocated src/**/*.test.ts only
npm run test:integration           # tests/integration (PostgreSQL)
npm run test:contract              # tests/contract (OpenAPI/docs/CI policy checks)
npm run db:migrate -- --name <name>
npm run api:generate               # regenerate openapi/openapi.json + openapi.sha256
```

Full local gate (matches CI): `npm run format:check`, `npm run lint` (zero
warnings), `npm run typecheck`, `npm run api:check`, `npm run test:coverage`
(80% branches/lines **per file**), `npm run build`, `npm run audit:ci`.

Integration tests that create/drop schemas use `TEST_MIGRATION_DATABASE_URL`;
point it only at a disposable PostgreSQL. `DATABASE_URL` (runtime) and
`MIGRATION_DATABASE_URL` (Prisma Migrate only) are separate credentials.
Provider env groups (email, Gemini, storage, metrics) are all-or-none; config
parsing in `src/config/env.ts` fails fast on partial groups.

## Architecture

Express 5 + Prisma 7 (pg adapter) + Zod 4 / zod-openapi, structured as a modular
monolith.

- `src/app.ts` — `createApp()` builds the shared middleware stack (request
  context, logging, metrics, security headers, CORS, request deadline, rate limit
  backed by Redis when available, JSON body, `/health`, `/docs`, `/api/v1/openapi.json`,
  error handler). Routes are injected through `registerRoutes`, which keeps the
  app testable with supertest without booting modules.
- `src/server.ts` — composition root. Creates each module runtime in order
  (identity → venue-catalog → booking-lifecycle → payments-billing →
  invitation-studio → guest-management → … → notifications), passes providers
  between them, and closes already-created runtimes if a later one fails.
- `src/modules/<module>/` — one bounded context per SPEC. Layering:
  `domain/` (pure policies, no I/O), `application/` (services and ports),
  `infrastructure/` (Prisma repositories/readers, adapters), `http/` (router,
  Zod schemas, `*.openapi.ts` path definitions). `<module>.runtime.ts` wires
  dependencies and exposes `{ router, resource, providers }`; cross-module access
  goes through these providers/ports rather than another module's repositories.
- `src/core/` — cross-cutting: `database/` (Prisma client factory, pool budget,
  booking unit-of-work/boundary, safe reads), `idempotency/` (Idempotency-Key
  middleware + persisted responses — required for money/commercial writes),
  `audit/`, `realtime/` (socket.io + Redis adapter, outbox relay),
  `errors/` (`AppError` + central handler), `openapi/` (registry + generator).
- `src/integrations/` — storage, email (Brevo/Resend), AI image (Gemini), each
  with a `Fake*Provider` used by unit tests so no network or paid calls happen.

## API contract

Every route's schemas are registered in `src/core/openapi/registry.ts` via the
module's `*.openapi.ts`. After changing any request/response schema run
`npm run api:generate` and commit `openapi/openapi.json` and `openapi/openapi.sha256`
together; `api:check` and the contract tests fail on drift. Client repos
(wedding-web, wedding-manage-web, wedding-app) pin this artifact by backend commit
SHA + digest — never hand-edit generated artifacts there or here.

## Database

Only this repo owns `prisma/schema.prisma` and `prisma/migrations/`. Applied
migrations are immutable; fixes are new forward migrations (see
`docs/database-migrations.md`; `tests/integration/migration-policy.test.ts`
enforces policy).

## Conventions

- Branches: `codex/<module>-<slice>`, PR into `main`; never push directly to `main`.
- Keep evidence separate: offline tests, sandbox/provider evidence and production
  readiness are recorded independently under `tasks/evidence/` and `docs/`.
  Don't mark a provider feature live from credentials, mocks or a 200 health check.
