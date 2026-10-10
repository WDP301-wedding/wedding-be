# Spec: `core-platform`

> Current amendment: [confirmed backend scope](./docs/backend-scope-2026-10-10.md) and [commercial extensions](./SPEC-commercial-contracts.md). Completed implementation evidence below is historical; new names/catalog/contract/invoice rules are separate backend extension tasks. The 2026-10-10 amendment governs conflicts with older access, pricing and client requirements.

Status: Approved by project owner on 2026-09-24  
Capability: `core-platform`  
Capability Map: [`CAPABILITY-MAP.md`](./CAPABILITY-MAP.md)  
Cross-module product requirements: [`PRODUCT-REQUIREMENTS.md`](./PRODUCT-REQUIREMENTS.md)<br>
Last updated: 2026-09-26

## 1. Objective

Establish the shared technical foundation for the single-restaurant wedding management system before any business module is implemented. This capability must make four independent repositories buildable, testable, contract-compatible, secure by default, and ready for later modules:

| Repository | Runtime responsibility |
|---|---|
| `wedding-be` | Express REST API, all authoritative business rules, PostgreSQL access, integrations, audit records, and API contract generation |
| `wedding-web` | Next.js public website, read-only Guest invitation views, and Couple Web flows |
| `wedding-manage-web` | Next.js Manager and Staff administration flows |
| `wedding-app` | Expo/React Native Android app for Couple workflows |

The backend is the only authority for validation that affects business state, authorization, booking, payment, refund, invitation delivery, seating, or check-in. Clients may validate for user experience, but must never replace server-side validation or derive their own business rules.

`core-platform` is complete when all four repositories share one API contract, have reproducible toolchains and quality gates, and the backend provides the infrastructure primitives required by every later capability.

## 2. Locked Assumptions

These assumptions are part of this draft and should be corrected before approval if any is wrong.

1. The product serves exactly one restaurant. No `tenantId`, tenant routing, tenant database policy, or tenant-specific configuration is introduced.
2. The repositories remain independent Git repositories; they are not converted into a monorepo and do not share a local npm workspace.
3. All clients call `wedding-be` over versioned JSON REST endpoints. Next.js does not own duplicate business APIs or access PostgreSQL directly.
4. PostgreSQL and Storage are hosted by Supabase, but Supabase Auth and direct client-side database access are not used.
5. API-driven updates use polling every 3–5 seconds only where a later module needs near-real-time data. Supabase Realtime is not part of the required architecture.
6. The system stores instants in UTC and applies `Asia/Ho_Chi_Minh` when interpreting restaurant dates, shifts, deadlines, and displays.
7. Currency is VND. API money fields are integer VND amounts; the database uses `Decimal(18,0)`. Floating-point money calculations are forbidden.
8. UUID strings identify persisted resources. API timestamps use ISO 8601/RFC 3339 strings with an explicit offset, normally UTC `Z`.
9. The first demo deployment may run one backend process. Scaling beyond one process requires a shared rate-limit store and operational review first.
10. UI language, design system, and detailed screen behavior belong to the relevant product-module specs, not this platform spec.

## 3. Scope

### 3.1 Required

- Scaffold and configure all four TypeScript repositories with npm and committed `package-lock.json` files.
- Establish repository responsibilities and dependency direction.
- Provide the Express application lifecycle, configuration loader, graceful shutdown, health/readiness endpoints, and a standard middleware pipeline.
- Configure Prisma ORM and Prisma Migrate for Supabase PostgreSQL.
- Define stable HTTP, validation, error, pagination, date, money, identifier, and idempotency conventions.
- Generate and commit an OpenAPI 3.1 contract from backend Zod schemas.
- Generate typed client schemas in all three client repositories from the committed backend OpenAPI artifact.
- Define provider boundaries and initial adapters for Supabase Storage, Resend, and AI image generation.
- Provide structured logging, request correlation, audit-log infrastructure, baseline RED metrics, and optional OpenTelemetry export.
- Establish secure defaults for CORS, headers, secrets, external calls, uploads, dependency installation, and error disclosure.
- Establish unit, integration, contract, and client smoke-test conventions.
- Configure the Expo project for Android-first development and a later EAS preview build.

### 3.2 Explicitly out of scope

- Accounts, JWT issuance, refresh rotation, password hashing, RBAC policy, and account activation; these belong to `identity-access`.
- Restaurant, hall, shift, menu, booking, payment, invitation, guest planning, seating, staff, notification, and dashboard business behavior.
- VNPay routes or callbacks.
- Email templates and scheduled email/push workflows.
- AI prompt design, invitation editing, or selection of a fixed Gemini model identifier; those belong to `invitation-studio`.
- Production deployment-provider selection, DNS setup, monitoring vendor selection, and the final Android EAS artifact; those are finalized in `release-demo`.
- iOS acceptance, guest mobile application, multi-tenant behavior, and automatic VNPay refunds.

## 4. Architecture and Dependency Rules

```text
┌──────────────────────┐     ┌──────────────────────┐
│ wedding-web          │     │ wedding-manage-web   │
│ Public/Guest/Couple  │     │ Manager/Staff        │
└──────────┬───────────┘     └──────────┬───────────┘
           │ HTTPS REST + generated API types       │
           └─────────────────┬───────────────────────┘
                             │
                    ┌────────▼────────┐
                    │ wedding-be      │
                    │ Express API     │
                    └───────┬─────────┘
                            │ Prisma / provider adapters
          ┌─────────────────┼──────────────────┐
          │                 │                  │
   Supabase Postgres  Supabase Storage       Resend
                                              │
                                      Gemini via provider

                  wedding-app
          Expo Android ──HTTPS REST──────────► wedding-be
```

Rules:

- A client repository may depend on the API contract, never on backend source files.
- `wedding-be` must not import files from any client repository.
- A domain module may depend only on `src/core`, its declared provider contracts, and modules listed as dependencies in the Capability Map.
- Cross-module calls use a provider-owned application interface or a persisted domain event. Importing another module's repository implementation is forbidden.
- Integration SDK objects must not escape `src/integrations`; domain and application services depend on local interfaces.
- No repository may contain a second implementation of booking, payment, authorization, refund, or check-in rules.

## 5. Technology Baseline

The exact resolved dependency graph is committed in each repository's `package-lock.json`. Stable patches may be upgraded after tests pass; major upgrades require a spec change and project-owner approval.

| Area | Baseline | Decision |
|---|---|---|
| Runtime | Node.js `24.21.0` LTS | Pin in `.nvmrc`/`.node-version`; `engines.node` is `>=24.11 <25` |
| Package manager | npm 11.x | One `package-lock.json` per repository; no pnpm/yarn lockfiles |
| Language | TypeScript `5.9.3` | Deliberate compatibility pin across Prisma 7 and Expo 57; strict mode everywhere |
| Public and management web | Next.js `16.3.6`, React/React DOM `19.2.3` | App Router, TypeScript, stable releases only |
| API | Express `5.2.1` | ESM TypeScript service on Node 24 |
| ORM | Prisma CLI and Client `7.10.0`, `@prisma/adapter-pg` `7.10.0` | Prisma 8 is not used while it is a release candidate |
| Mobile | Expo SDK 57, React Native `0.86`, React `19.2.3` | Managed/CNG project, Expo Router, Android acceptance target |
| Android cloud build | EAS CLI `23.2.0` | Pin the CLI used by the project; preview build only until `release-demo` |
| Boundary validation | Zod `4.6.5` | HTTP, environment, and third-party responses |
| API description | OpenAPI `3.1.0`, `zod-openapi` `6.0.2` | Zod route schemas generate the canonical artifact |
| Client API access | `openapi-typescript` + `openapi-fetch` stable compatible releases | Exact versions locked at scaffold time |
| Unit/integration tests | Vitest 5.x | Backend and both Next.js repositories |
| Expo tests | Jest with SDK-57-compatible `jest-expo` | Installed with `npx expo install` when applicable |
| Web end-to-end tests | Playwright stable | Full flows are added by product modules |
| Linting/formatting | ESLint `10.11.x` flat config, Prettier 3.x | No legacy `.eslintrc` |
| Logging | Pino + `pino-http` | Structured JSON in production, readable transport in local development |
| Metrics/tracing | `prom-client`; OpenTelemetry Node SDK when configured | Vendor-neutral telemetry; no required paid vendor |

Version rules:

- Do not use `latest`, `next`, `beta`, `rc`, `canary`, or preview tags in committed manifests.
- Expo-managed packages are installed with `npx expo install`, not manually versioned with `npm install`.
- `prisma` and `@prisma/client` stay on the same 7.x release line.
- A security patch may supersede the patch above before implementation; if so, use the newest stable security patch in the same major/minor line and record it in this file.

## 6. Commands

The following scripts are required outcomes of implementing this spec. They need not exist before implementation begins.

### 6.1 Every repository

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
npm audit
```

CI uses `npm ci`, never `npm install`, and fails if the lockfile is inconsistent. New dependencies are first installed with lifecycle scripts disabled for review; required scripts are then explicitly allowed and a clean install is verified.

### 6.2 `wedding-be`

```bash
npm run dev
npm run build
npm run start
npm run test:unit
npm run test:integration
npm run test:contract
npm run db:generate
npm run db:migrate -- --name <migration_name>
npm run db:migrate:deploy
npm run db:seed
npm run db:studio
npm run api:generate
npm run api:check
```

### 6.3 `wedding-web` and `wedding-manage-web`

```bash
npm run dev
npm run build
npm run start
npm run test:unit
npm run test:e2e
npm run api:generate
npm run api:check
```

### 6.4 `wedding-app`

```bash
npx expo start
npx expo start --android
npx expo-doctor
npm run build
npm run lint
npm run typecheck
npm run test
npm run api:generate
npm run api:check
npx eas-cli@23.2.0 build -p android --profile preview
```

The EAS command is a release verification target, not a required cloud build during `core-platform`; `release-demo` owns the final downloadable Android artifact. EAS services have usage limits and may incur cost.

## 7. Project Structure

### 7.1 `wedding-be`

```text
wedding-be/
├── openapi/
│   └── openapi.json              # generated, committed canonical API artifact
├── prisma/
│   ├── migrations/               # immutable committed migrations
│   ├── schema.prisma
│   └── seed.ts
├── scripts/                      # generation and verification scripts
├── src/
│   ├── app.ts                    # creates/configures Express; no listen side effect
│   ├── server.ts                 # process lifecycle, listen, graceful shutdown
│   ├── config/
│   │   └── env.ts                # parsed immutable configuration
│   ├── core/
│   │   ├── audit/
│   │   ├── errors/
│   │   ├── http/
│   │   ├── idempotency/
│   │   ├── logging/
│   │   ├── observability/
│   │   └── types/
│   ├── integrations/
│   │   ├── ai-image/
│   │   ├── email/
│   │   └── storage/
│   └── modules/
│       └── <module-id>/
│           ├── application/
│           ├── domain/
│           ├── infrastructure/
│           └── http/
└── tests/
    ├── contract/
    ├── fixtures/
    └── integration/
```

Feature tests that need only one source unit are colocated as `*.test.ts`; cross-cutting integration and contract tests live under `tests/`.

### 7.2 `wedding-web`

```text
wedding-web/
├── app/
│   ├── (public)/
│   ├── (guest)/
│   └── (couple)/
├── e2e/
├── public/
└── src/
    ├── components/
    ├── features/
    ├── lib/
    │   ├── api/
    │   │   ├── client.ts
    │   │   └── generated/schema.d.ts
    │   └── env.ts
    └── test/
```

### 7.3 `wedding-manage-web`

```text
wedding-manage-web/
├── app/
│   ├── (auth)/
│   ├── (manager)/
│   └── (staff)/
├── e2e/
├── public/
└── src/
    ├── components/
    ├── features/
    ├── lib/
    │   ├── api/
    │   │   ├── client.ts
    │   │   └── generated/schema.d.ts
    │   └── env.ts
    └── test/
```

Manager and Staff share this administration repository and are separated by routes and server-enforced permissions, not by separate backend APIs or duplicated applications.

### 7.4 `wedding-app`

```text
wedding-app/
├── assets/
├── scripts/
├── src/
│   ├── app/                       # Expo Router route files only
│   │   ├── (auth)/
│   │   ├── (couple)/
│   │   └── _layout.tsx
│   ├── components/
│   ├── features/
│   ├── hooks/
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   └── generated/schema.d.ts
│   │   └── env.ts
│   ├── screens/
│   ├── theme/
│   └── utils/
├── app.config.ts
├── eas.json
└── package.json
```

`src/app` contains routes only. Reusable UI belongs in `components`, feature logic in `features`, and complex screen bodies in `screens`. Android-specific differences use `.android.ts(x)` files while keeping an extension-free default implementation when a shared import requires one.

## 8. Configuration and Environments

Environments are `development`, `test`, `staging`, and `production`. Every repository commits `.env.example` with placeholders and gitignores all real `.env*` files except examples.

### 8.1 Backend configuration

Required or reserved variables:

```text
NODE_ENV
PORT
LOG_LEVEL
RESTAURANT_TIME_ZONE=Asia/Ho_Chi_Minh
CORS_ALLOWED_ORIGINS
DATABASE_URL
MIGRATION_DATABASE_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
RESEND_API_KEY
RESEND_FROM_EMAIL
BREVO_API_KEY
BREVO_FROM_EMAIL
AI_IMAGE_PROVIDER=gemini
GEMINI_API_KEY
GEMINI_IMAGE_MODEL
METRICS_ENABLED
METRICS_TOKEN
OPENAPI_ENABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT
```

Rules:

- Zod validates environment variables once at process startup. Invalid or missing required production configuration terminates the process before the HTTP port opens.
- `SUPABASE_SERVICE_ROLE_KEY`, Brevo, Resend, database, metrics, and Gemini secrets exist only in backend environments.
- Configure one complete email credential group (`BREVO_*` or legacy `RESEND_*`); staging/production requires email, and simultaneous providers are rejected.
- `GEMINI_API_KEY` and model are optional while AI is disabled; enabling the Gemini adapter without them is a startup error.
- `CORS_ALLOWED_ORIGINS` is an explicit comma-separated allowlist for the two web deployments. Wildcard origins are forbidden when credentials are accepted.
- The committed OpenAPI artifact is served outside production. Production serving requires `OPENAPI_ENABLED=true`.
- Frontend variables prefixed `NEXT_PUBLIC_` or `EXPO_PUBLIC_` are public by definition and must never contain a secret.

### 8.2 Client configuration

```text
# Both Next.js repositories
NEXT_PUBLIC_API_BASE_URL

# Expo repository
EXPO_PUBLIC_API_BASE_URL
EXPO_PUBLIC_EAS_PROJECT_ID
```

The production API base URL must be HTTPS. A development-only cleartext URL may be used for a local Android emulator with explicit platform configuration.

## 9. Database and Migration Contract

- Only `wedding-be` owns the database schema and migrations.
- Use a dedicated PostgreSQL role for Prisma rather than the Supabase dashboard's broad default role.
- For a persistent backend, `DATABASE_URL` uses a direct connection when IPv6 is available or Supavisor session mode on port 5432 when it is not.
- `MIGRATION_DATABASE_URL` uses a direct connection when available; session mode is the fallback. Transaction-pooler mode must never run Prisma Migrate.
- TLS is required for database connections.
- `prisma.config.ts` reads `MIGRATION_DATABASE_URL`; the runtime pool uses `DATABASE_URL` through `@prisma/adapter-pg`.
- Development schema changes use `prisma migrate dev`. Staging and production use `prisma migrate deploy` as an explicit release step.
- `prisma db push` is prohibited for shared, staging, demo, and production databases.
- Applied migration files are immutable. Corrections are new forward migrations; history is not rewritten after sharing.
- Destructive migrations require a written expand/migrate/contract plan, backup/restore evidence, and project-owner approval.
- Integration tests run against PostgreSQL, not SQLite, so constraints, transactions, indexes, and concurrency behavior match production.

### 9.1 Core-owned models

`core-platform` owns only infrastructure records. Domain tables are introduced by later module specs.

**`AuditLog`**

- `id`, `occurredAt`, `requestId`
- `actorType`: `SYSTEM`, `USER`, or `GUEST_LINK`
- nullable opaque `actorId`; no dependency on the future identity table
- stable `action`, `entityType`, nullable `entityId`
- redacted JSON `metadata`
- append-only through application code; no update/delete repository methods

Audit metadata must not contain passwords, JWTs, refresh tokens, guest invitation tokens, payment secrets, raw email bodies, or unnecessary PII.

**`IdempotencyRecord`**

- `id`, `namespace`, `idempotencyKey`, `requestHash`
- `status`: `IN_PROGRESS`, `SUCCEEDED`, `FAILED`
- nullable `responseStatus`, redacted `responseBody`, `resourceType`, and `resourceId`
- `lockedAt`, `expiresAt`, `createdAt`, `updatedAt`
- unique constraint on `(namespace, idempotencyKey)`

## 10. REST API Contract

### 10.1 General conventions

- Base path: `/api/v1`.
- Resource paths use plural nouns and kebab-case only when a compound noun is unavoidable.
- JSON field names and query parameters use `camelCase`.
- Enum values use `UPPER_SNAKE_CASE`.
- Request/response `Content-Type` is `application/json`, except explicit file transfers.
- `POST` creates a resource or initiates a named operation that cannot be modeled as CRUD; `PATCH` applies partial updates; `DELETE` is idempotent where supported.
- New response fields are additive and optional to old clients. Removing or changing an existing field requires a new API major version.
- Clients branch on machine-readable codes and fields, never on human message text.

Single-resource success:

```json
{
  "data": {
    "id": "8c195f40-0d10-44c5-a344-1705652ce3dd",
    "createdAt": "2026-09-24T08:30:00.000Z"
  }
}
```

Paginated collection success:

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 0,
    "totalPages": 0
  }
}
```

List endpoints default to `page=1&pageSize=20`, cap `pageSize` at 100, document a deterministic default sort, and add `id` as a final tie-breaker.

### 10.2 Error contract

Every non-2xx application response uses:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": [
      {
        "path": "email",
        "code": "invalid_format",
        "message": "Email must be valid."
      }
    ],
    "requestId": "24dcfaac-4408-4d42-8d66-456ed6ee7ea4"
  }
}
```

Status mapping:

| Status | Meaning |
|---|---|
| `400` | Malformed syntax or unsupported request shape |
| `401` | Missing or invalid authentication |
| `403` | Authenticated actor lacks permission |
| `404` | Resource is absent or intentionally concealed |
| `409` | State/version conflict or duplicate request still in progress |
| `422` | Syntactically valid request fails schema or business validation |
| `429` | Rate limit exceeded; include `Retry-After` |
| `500` | Unexpected internal error with generic public message |
| `502`/`503`/`504` | Explicit upstream failure/unavailability/timeout |

Stack traces, SQL messages, provider payloads, and secret-bearing details never appear in public responses.

### 10.3 Health and internal endpoints

- `GET /health/live`: process liveness only; no dependency calls.
- `GET /health/ready`: bounded PostgreSQL readiness check and configuration status; returns `503` when not ready.
- `GET /api/v1/openapi.json`: serves the exact committed OpenAPI artifact outside production, and may be explicitly enabled in production.
- `GET /internal/metrics`: disabled unless configured; when enabled, protected by network policy or a dedicated bearer secret and excluded from public OpenAPI documentation.

### 10.4 Idempotency

Later module specs mark which state-changing routes require `Idempotency-Key`. At minimum, booking creation, payment creation/recording, refund recording, and notification dispatch must use it.

- Key length is 1–128 printable ASCII characters and identifies one user intent, not one retry attempt.
- Namespace includes actor scope, HTTP method, normalized route, and operation version.
- Actor scope comes only from authenticated or otherwise trusted request context, never from a client-controlled header, query, or body field.
- A missing required header returns `400 IDEMPOTENCY_KEY_REQUIRED`; a malformed key returns `422 INVALID_IDEMPOTENCY_KEY`.
- Before the side effect, atomically insert an `IN_PROGRESS` record; the database unique constraint chooses the winner.
- Store a SHA-256 hash of the canonical request payload. Reusing a key with a different payload returns `422 IDEMPOTENCY_KEY_REUSED`.
- A concurrent duplicate receives `409 REQUEST_IN_PROGRESS` with `Retry-After`; it never executes the side effect.
- A completed duplicate receives the stored status/body or the canonical resource reference.
- Successful `2xx` responses become `SUCCEEDED`; deterministic `4xx` responses become `FAILED` and are replayable. `3xx` and `5xx` responses remain `IN_PROGRESS` because their side-effect outcome is not proven.
- Default retention is 30 days. Payment operations retain records for at least 180 days or longer if the provider's retry/dispute path requires it.
- A timeout after calling an external provider is an unknown outcome, not an automatic failure. Keep enough state for reconciliation before any retry.

## 11. API Contract Distribution Across Four Repositories

Zod schemas in `wedding-be` are the runtime validation source and the source for generated OpenAPI 3.1.

1. `npm run api:generate` in `wedding-be` deterministically produces `openapi/openapi.json`.
2. `npm run api:check` regenerates to a temporary file and fails when the committed artifact differs.
3. Each client repository runs `openapi-typescript` against `OPENAPI_SOURCE`, which defaults locally to `../wedding-be/openapi/openapi.json`, and writes only `src/lib/api/generated/schema.d.ts`.
4. Generated files are committed with a header containing the OpenAPI SHA-256 digest and must never be hand-edited.
5. Each client wraps `openapi-fetch` once in `src/lib/api/client.ts` to set the base URL, authorization strategy, timeout, request ID, and normalized error handling.
6. Client CI receives an artifact from an exact backend commit/release, never a moving branch URL, verifies its digest, and then runs `api:check`.
7. A backend contract change is merged first. Coordinated client pull requests regenerate from the new artifact before using new fields or paths.
8. Contract tests verify that documented examples and actual health/error responses satisfy the artifact.

This avoids a fifth shared-code repository while preserving a single contract authority.

## 12. Provider Boundaries

Provider contracts live in backend-owned application interfaces. Adapters translate and validate external SDK inputs/outputs.

```ts
export interface EmailProvider {
  send(command: SendEmailCommand): Promise<SentEmail>;
}

export interface StorageProvider {
  put(command: PutObjectCommand): Promise<StoredObject>;
  createSignedReadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  delete(objectKey: string): Promise<void>;
}

export interface AiImageProvider {
  generate(command: GenerateImageCommand): Promise<GeneratedImage[]>;
}
```

Conventions demonstrated by the snippet:

- Type/interface names use `PascalCase`; variables and functions use `camelCase`; files use `kebab-case`.
- Commands and return values are explicit types rather than raw SDK payloads.
- No `any`; external `unknown` values are parsed with Zod before use.
- Interfaces describe business-needed capability, not every feature of the vendor SDK.

### 12.1 Supabase Storage

- Backend service credentials are the only privileged Storage credentials.
- Start with separate private buckets by security class rather than one public catch-all bucket. The initial required bucket is `wedding-private`.
- Object keys are server-generated and scoped by purpose/resource UUID; user-provided filenames never become filesystem/object paths.
- Reads use short-lived signed URLs, default 15 minutes. Never persist signed URLs; persist object keys.
- Upload policy allowlists MIME types and extensions, caps byte size, verifies actual content/magic bytes where applicable, and records checksum/size.
- A successful upload is not trusted until the backend finalizes and validates it.
- Deletion requires the caller's resource authorization and an allowlisted key prefix; never accept an arbitrary bucket or path from the client.

### 12.2 Transactional email

- `EmailProvider` supports `BrevoEmailProvider`, the retained `ResendEmailProvider`, and an offline fake. Brevo is the recommended project configuration; setup is documented in `docs/brevo-email.md`.
- Brevo requires an API key and a verified sender configured through `BREVO_FROM_EMAIL`. Brevo temporarily rewrites free sender addresses; an authenticated domain is recommended for long-term delivery. Legacy Resend production/staging uses a verified sending domain and configured `RESEND_FROM_EMAIL`.
- Every retryable email intent uses a deterministic provider idempotency key derived from event type and persisted event/entity ID.
- Provider key retention does not replace the application's durable delivery/audit state. Brevo uses a deterministic UUID v5 and documents a 30-minute deduplication window; duplicate rejections are not successful response replays, and the adapter does not automatically retry.
- Provider timeouts and returned shapes are validated and normalized; raw provider errors remain in redacted server logs.

### 12.3 AI image generation

- The initial adapter target is Gemini, selected through `AI_IMAGE_PROVIDER=gemini`.
- `GEMINI_IMAGE_MODEL` remains configuration so the invitation module can choose a currently supported production model without changing domain code.
- Model prompts never include guest contact data, payment data, authentication data, or other unnecessary PII.
- Model output is untrusted: validate MIME type, dimensions, byte size, and response shape before storing or rendering it.
- The model cannot call tools, write database state, construct SQL, choose storage paths, or authorize an action.
- Provider quota, timeout, safety refusal, and invalid-output failures map to stable internal error codes.

## 13. Security Baseline

### 13.1 Trust boundaries and assets

Untrusted boundaries include public/guest HTTP input, authenticated client input, file uploads, provider callbacks, Resend/Supabase/Gemini responses, environment configuration, and AI output. Protected assets include credentials, user sessions, guest tokens, guest PII, booking state, payment state, audit evidence, and uploaded/generated files.

Required controls:

- Validate request params, query, headers, and bodies before application logic; reject unknown fields on write schemas unless explicitly allowed.
- Use Prisma parameterization. Raw SQL requires parameter binding, a written reason, and a focused test.
- Apply Helmet security headers and explicit CORS origins. Next.js repositories define restrictive CSPs when their external asset requirements are known.
- Bound JSON body size and request duration. Upload endpoints use separate, stricter limits.
- Apply a general rate limit and stricter limits to future authentication, guest-token, payment, and file endpoints.
- The in-memory limiter is permitted only while one backend process is deployed. Horizontal scaling is blocked until a shared limiter store exists.
- Configure outbound provider calls with HTTPS, allowlisted fixed hosts, connect/response timeouts, and bounded retries with jitter.
- Do not fetch arbitrary user-provided URLs. A future requirement to do so needs an SSRF design review.
- Never log request/response bodies by default. Redact `authorization`, cookies, tokens, secrets, email, phone, and payment fields.
- Never store authentication tokens in browser `localStorage`. The exact web-cookie/mobile-secure-store flow is defined in `identity-access`.
- Commit placeholders only. If a secret reaches Git or logs, rotate it before history cleanup.
- Release gates include lockfile-based dependency audit; critical/high findings must be fixed or documented with reachability, mitigation, owner, and review date.

### 13.2 Data minimization and retention

- Every later schema field containing PII must state its purpose and retention rule in that module's spec.
- Logs and metrics contain no names, phone numbers, email addresses, invitation tokens, or message bodies.
- Audit metadata is allowlisted rather than copied from request bodies.
- Backup, export, correction, and deletion behavior is finalized before production launch; a soft-delete flag alone is not treated as erasure.

## 14. Observability and Auditability

Questions the platform must answer without reading source code:

1. Is the API alive and able to reach PostgreSQL?
2. Which request failed, on which normalized route, and because of which stable error/provider code?
3. Are endpoint or provider error rates and p95/p99 latency degrading?
4. Which actor changed a protected business record, and under which request ID?

### 14.1 Application logs

- Production logs are newline-delimited JSON with stable `event` names.
- Every request has a UUID `requestId`; accept only a valid UUID from a trusted upstream, otherwise generate one, return it as `x-request-id`, and propagate it to providers.
- Common fields: `timestamp`, `level`, `service`, `environment`, `event`, `requestId`, `entryPoint`, `module`, `route`, `method`, `statusClass`, `durationMs`, and stable error/provider codes.
- Entry points are explicit: `http`, `scheduler`, `provider_callback`, `replay`, or `cli`.
- `debug` is disabled in production. `error` means action may be required; handled degradation is `warn`; material business events are `info`.

### 14.2 Metrics and tracing

- RED metrics cover HTTP routes and external providers: request count, error count, and duration histogram.
- Metric labels are bounded values such as route template, method, status class, module, and provider. IDs, raw URLs, emails, error messages, and request IDs are forbidden labels.
- Histograms support p50, p95, and p99; averages are not the only latency signal.
- OpenTelemetry auto-instrumentation and OTLP export activate only when an endpoint is configured. The application runs correctly with tracing disabled.
- Product-module specs add business metrics only when they answer a named operational question.

### 14.3 Audit log versus diagnostic log

Audit logs are durable business/security evidence stored in PostgreSQL. Application logs are operational telemetry and may expire. A protected state change is not considered auditable merely because it produced a Pino log line.

## 15. Code Style

- TypeScript `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` are enabled where framework tooling permits.
- Use ESM, named exports for reusable code, and dependency injection at module composition boundaries.
- Route handlers translate HTTP to typed application commands; they do not contain Prisma or vendor SDK calls.
- Services express use cases; repositories persist; provider adapters translate external APIs.
- Prefer immutable values and small pure functions. Do not use non-null assertions to silence unresolved states.
- Use discriminated unions for state variants and branded/opaque types for IDs at domain boundaries where they prevent accidental substitution.
- Comments explain constraints or reasons, not a restatement of code.
- Prettier owns formatting; ESLint owns correctness/import rules. Formatting debates are not settled manually in reviews.

## 16. Testing Strategy

| Level | Purpose | Required evidence |
|---|---|---|
| Unit | Pure errors, serializers, money/time helpers, request hashing, provider mapping | Fast colocated tests; no network |
| Backend integration | Express middleware, Prisma repositories, migrations, transactions, concurrency | Disposable PostgreSQL; Supertest against the app without opening a real port |
| Contract | OpenAPI determinism, examples, common responses, generated client compatibility | `api:check` plus schema/response validation |
| Client unit/component | API wrapper, config, loading/error states, shared components | Vitest/Testing Library on web; Jest/jest-expo on app |
| Web E2E | Cross-repository user journeys | Playwright, added by the module owning the journey |
| Android verification | Native configuration and final demo behavior | `expo-doctor` now; physical/emulator checks and EAS artifact in `release-demo` |

Coverage gates for `core-platform`:

- At least 80% line and branch coverage for newly added core backend files.
- 100% branch coverage for environment validation, error mapping, idempotency claim/replay behavior, and secret-redaction helpers.
- Coverage numbers do not replace required concurrency, migration, contract, and failure-path tests.

Mandatory scenarios:

- Startup refuses invalid environment configuration.
- `health/live` remains independent of PostgreSQL; `health/ready` changes to `503` when PostgreSQL is unavailable.
- All validation failures use the standard error body and request ID.
- Concurrent use of one idempotency key produces one winning execution.
- Reusing a key with a different payload fails with `422`.
- OpenAPI generation is deterministic and all three clients regenerate without a diff.
- Provider adapters normalize timeout, refusal, invalid payload, and transient failure without exposing raw errors.
- Logs and audit metadata pass redaction tests.
- Clean migrations apply successfully to an empty PostgreSQL database.

## 17. Boundaries

### Always do

- Update this spec before changing a locked platform decision.
- Validate every external boundary and third-party response.
- Keep authoritative rules and database access in `wedding-be`.
- Commit migration files, OpenAPI output, generated client schema, and npm lockfiles.
- Add request correlation and meaningful structured telemetry with each new endpoint/provider/job.
- Add audit records for later-module actions that affect authorization, booking, money, guest access, seating, or attendance.
- Run lint, typecheck, relevant tests, build, contract check, and dependency audit before merge.
- Use stable/LTS dependencies and review new dependency ownership, install scripts, and lockfile changes.

### Ask the project owner first

- Add or replace a framework, database, ORM, package manager, auth mechanism, external provider, or repository.
- Add a new category of PII or send PII to a third party, including an AI provider.
- Change CORS, token transport, rate limits, upload policy, retention periods, or audit semantics.
- Make a breaking API change or create `/api/v2`.
- Run a destructive database migration or edit already-applied migration history.
- Make a storage bucket public or expose direct client database access.
- Introduce Redis, a queue, Supabase Realtime, or another paid infrastructure dependency.
- Enable iOS as an acceptance target.

### Never do

- Commit secrets, production data, service-role keys, signing keys, or real `.env` files.
- Put business logic, Prisma, or privileged Supabase access in a Next.js or Expo client.
- Use `prisma db push` against a shared environment.
- Trust client validation, filenames, MIME declarations, callbacks, provider responses, or AI output.
- Concatenate input into SQL, object paths, HTML, shell commands, or log messages.
- Log passwords, tokens, cookies, guest invitation links, full PII, payment secrets, or whole request bodies.
- Store browser auth tokens in `localStorage`, disable security headers for convenience, or use wildcard credentialed CORS.
- Hand-edit generated OpenAPI client files or ignore a contract diff.
- Delete/skip a failing test merely to make a pipeline pass.

## 18. Success Criteria

`core-platform` is accepted only when all of the following are demonstrated:

1. `CAPABILITY-MAP.md` names and correctly separates all four repositories without changing approved module IDs or build order.
2. All four repositories pin the approved runtime/framework baseline, contain exactly one npm lockfile, and pass clean `npm ci`.
3. Lint, typecheck, unit tests, coverage checks, and production builds pass in every repository.
4. `wedding-be` starts and shuts down gracefully; liveness/readiness behavior passes integration tests.
5. Prisma migrations apply to an empty PostgreSQL database and the application connects to Supabase-compatible PostgreSQL using the documented connection mode.
6. Common error, validation, pagination, time, money, identifier, and request-ID contracts are implemented and covered by tests.
7. Idempotency storage and middleware pass concurrent-winner, replay, payload-mismatch, and in-flight-duplicate tests.
8. OpenAPI 3.1 generation is deterministic, the artifact is committed, and all three clients generate matching typed schemas without hand edits.
9. Supabase Storage, Resend, and Gemini are reachable only through provider interfaces; fake adapters allow tests without paid/network calls.
10. Structured logs, audit primitives, RED metrics, redaction, and optional tracing behave as specified under induced success and failure cases.
11. `.env.example` documents every setting, real secrets are ignored, and no critical/high reachable production dependency finding remains unmitigated.
12. `wedding-app` uses the approved Expo structure, passes `expo-doctor`, and has an Android `preview` EAS profile ready for the later release module.

Approval of this spec authorizes Phase 2 planning for `core-platform`; it does not authorize implementation of later capability modules.

## 19. Open Questions and Deferred Inputs

These inputs do not change the architecture and may remain placeholders during local implementation, but must be resolved before the named gate:

| Input | Needed by |
|---|---|
| Production/staging backend and Next.js hosting providers | `release-demo` deployment plan |
| Supabase project references, database credentials, and bucket names | Integration/staging setup |
| Resend verified domain and sender address | First real email test |
| Google AI project/API key and exact production Gemini image model | `invitation-studio` spec/implementation |
| EAS account, project ID, Android application ID, and signing ownership | First EAS preview build |
| Final public/management domains | Production CORS and CSP configuration |
| Telemetry backend, if any | Production launch; local metrics/logging do not depend on it |

## 20. Authoritative Sources

- Node.js production applications should use an Active or Maintenance LTS release: https://nodejs.org/en/about/previous-releases
- Next.js releases and security patch status: https://nextjs.org/blog
- Express 5 API: https://expressjs.com/en/5x/api.html
- Prisma release status and supported Prisma 7 line: https://www.prisma.io/docs/orm/release-status
- Prisma 7 system requirements: https://www.prisma.io/docs/orm/v7/reference/system-requirements
- Supabase Prisma connection guidance: https://supabase.com/docs/guides/database/prisma
- Supabase connection-mode guidance: https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase Storage access control and signed URLs: https://supabase.com/docs/guides/storage/security/access-control and https://supabase.com/docs/guides/storage/serving/downloads
- Expo SDK 57 compatibility matrix: https://docs.expo.dev/versions/latest/
- Expo `src/app` project structure guidance: https://docs.expo.dev/router/reference/src-directory/
- EAS Android build command and profiles: https://docs.expo.dev/build/eas-json/
- OpenAPI 3.1 specification: https://spec.openapis.org/oas/v3.1.0
- Zod 4/OpenAPI generator: https://www.npmjs.com/package/zod-openapi
- Resend idempotency behavior: https://resend.com/changelog/idempotency-keys


## 2026-10-10 Backend Extension

Preserve the completed Core stack, audit/idempotency/UoW rules and applied migrations. Future modules use guest-plan vocabulary and publish backend contracts independently of frontend UI/build gates. Catalog/profile/contract/invoice migrations remain serialized forward changes.

Authority and validation: [commercial specification](./SPEC-commercial-contracts.md),
[confirmed scope](./docs/backend-scope-2026-10-10.md) and
[active backend tasks](./tasks/backend-revision-todo.md). These requirements do not
claim that the pending extension is already mounted in the generated API.
