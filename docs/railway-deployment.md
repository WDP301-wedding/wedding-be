# Railway backend deployment

The backend runs in the `production` environment of Railway project `wedđing`,
service `wedding-be`. This is the shared early-deployment and production
environment; it uses the existing Supabase PostgreSQL database, Supabase Storage
bucket, and Brevo configuration. AI image generation is disabled.

- API base URL: `https://wedding-be-production-e1dc.up.railway.app/api/v1`
- Swagger UI: `https://wedding-be-production-e1dc.up.railway.app/docs`
- OpenAPI: `https://wedding-be-production-e1dc.up.railway.app/api/v1/openapi.json`
- Liveness: `https://wedding-be-production-e1dc.up.railway.app/health/live`
- Readiness: `https://wedding-be-production-e1dc.up.railway.app/health/ready`
- Project ID: `1c56721d-021a-442c-9e01-bb91abe73adb`
- Environment ID: `08a2899c-b0d6-4200-a505-604965a4b3fc`
- Service ID: `0f70d648-8c59-48bd-84f3-29a86d2e2d38`

## Build and deployment settings

`Dockerfile` pins Node 24.21.0 and installs locked dependencies. The build
generates Prisma before compiling TypeScript. The runtime runs as the `node`
user. Prisma CLI remains available for the release migration step.

`.railway/railway.ts` manages only the backend through the `wedding-be` partial.
Other services in the project are outside this partial. Railway owns the secret
values; the IaC variable policy is unmanaged. It configures one replica,
outbound IPv6, `npm run db:migrate:deploy` before startup, `/health/ready`, and
three restarts on failure. A failed migration stops the release.

Use a native Railway CLI executable on PATH on Windows so the TypeScript SDK
can invoke `railway --version`. The first deployment used CLI 5.64.1.

```powershell
railway login
railway link --project 1c56721d-021a-442c-9e01-bb91abe73adb --environment production --service wedding-be
npm ci
railway config plan --environment production
railway config apply --environment production
railway up --service wedding-be --environment production
```

Review the plan before applying it. IaC changes and source uploads are separate
operations: `config apply` updates service settings; `up` uploads local source.
The first deployment used CLI uploads. The production service is connected to
`WDP301-wedding/wedding-be`, branch `main`, with automatic deployments and
**Wait for CI** enabled. Railway deploys only after GitHub checks succeed,
including PostgreSQL migration/integration coverage. Keep these gates enabled.
Redeploy the current release from the service's Deployments menu when needed;
use a new reviewed `main` commit for source changes. Never apply unrelated
project-wide staged changes while updating this service.

`.railwayignore` excludes environment files, generated output, private local
tooling and credentials from upload. `.dockerignore` also excludes them from
the image build context. Do not use `--no-gitignore`.

## Runtime variables and TLS

Copy the backend variables from `.env.example` into Railway's variables UI or
a secret-safe import process. Use the existing `.env` values for Supabase and
Brevo, with these deployment-specific settings:

| Variable                | Deployment value                                  |
| ----------------------- | ------------------------------------------------- |
| `NODE_ENV`              | `production`                                      |
| `PORT`                  | `3001` (the generated domain targets this port)   |
| `AUTH_TRUST_PROXY_HOPS` | `1`                                               |
| `BACKEND_REPLICA_COUNT` | `1`                                               |
| `OPENAPI_ENABLED`       | `true` (Swagger UI and OpenAPI exposed)           |
| `AUTH_OTP_HASH_KEY`     | Independent random secret, stable across restarts |
| `CORS_ALLOWED_ORIGINS`  | Exact HTTPS browser origins; public web first     |

Do not configure `TEST_MIGRATION_DATABASE_URL` in the deployed service. Keep
the AI and legacy Resend groups blank when using Brevo with AI disabled.

Swagger UI's **Try it out** targets this production service and executes real
requests, including writes. Normal API authentication and role checks still
apply. Use **Authorize** with an access token; web login/refresh cookies are
managed by the browser on this origin, which must remain in the CORS allowlist.
Tokens are not persisted by Swagger UI. `/docs/openapi.json` adapts route prefixes
for the browser; `/api/v1/openapi.json` remains the exact canonical client artifact.

Both database URLs use `sslmode=verify-full` and
`sslrootcert=/app/certs/supabase-root-ca.crt`. The local `.env` contains a Windows
certificate path, which must be replaced for the Linux container without
changing database credentials. `certs/supabase-root-ca.crt` is the public
Supabase Root 2021 CA certificate, not a private key. Its SHA-256 fingerprint is
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`;
it expires on 26 April 2031. Review replacement certificates before rebuilding.

The direct Supabase endpoint is IPv6-only. Outbound IPv6 must remain enabled.
Alternatively, use Supabase session pooler connections if the deployment
network cannot reach IPv6. Migration connections must not use transaction mode.

The first deployment generated an OTP hash secret on Railway and saved a local
copy in gitignored `.env.railway`. Preserve it; replacing it can invalidate
outstanding OTP challenges. The original local `.env` remains unchanged.

## Verification and recovery

After every release, verify both health endpoints and real database reads:

```powershell
Invoke-RestMethod https://wedding-be-production-e1dc.up.railway.app/health/live
Invoke-RestMethod https://wedding-be-production-e1dc.up.railway.app/health/ready
Invoke-RestMethod https://wedding-be-production-e1dc.up.railway.app/api/v1/catalog/halls
Invoke-RestMethod https://wedding-be-production-e1dc.up.railway.app/api/v1/catalog/dishes
```

Readiness currently checks application lifecycle readiness, so a successful
health response alone does not prove a database query succeeds. Check release
logs for successful migration completion and inspect API errors.

The bucket and Brevo sender were verified with read-only provider requests.
Email delivery must be tested separately through a real authorized workflow.

For an application rollback, select a previous deployment only after checking
schema compatibility. Preserve migration history and use forward corrections
as described in `database-migrations.md`.

The current CORS allowlist is
`https://wedding-web-silk.vercel.app,https://wedding-manage-web.vercel.app,https://wedding-be-production-e1dc.up.railway.app`.
The public web origin comes first because it also determines email credential
links. Both Vercel applications proxy `/api/v1/*` to this backend so refresh
cookies stay on the browser application's origin. Verify actual login and
email delivery through an authorized account workflow separately.
