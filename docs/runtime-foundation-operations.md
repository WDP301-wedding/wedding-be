# Runtime foundation: RV-01–03

Separate configuration, repository tests, live evidence and production readiness.
The developer environment uses Railway's environment named `production`; that
platform label does not establish production acceptance.

## Feature manifest

`npm run runtime:manifest` prints an allowlisted matrix, Git revision and dirty
flag. Startup emits `runtime_feature_manifest`, using `RAILWAY_GIT_COMMIT_SHA`
when available. Missing revision is `null`. No database URLs, mailboxes, provider
credentials or collector addresses are printed.

Features start with `offlineVerification: not-evaluated` and live evidence pending.
Attach actual test results and named-target evidence separately. Configuration
is not email delivery, stored objects, generated images or settled payments.
Missing required integrations remain release gates.

Development/test without email uses an in-memory fake for workspace invitations;
it never delivers mail. Password OTP requests reject missing email configuration.
Catalog Storage has a development fake; Invitation Storage fails unavailable.
Deployed configuration requires real email and Storage. Missing Gemini, VNPay or
public origin disables those features; no fake generation/settlement is introduced.
VNPay is sandbox-only. Workers are downstream pending, print-file rendering is
missing, and unselected metrics/OTLP are optional disabled.

## Database readiness

Deployed composition owns a separate PostgreSQL pool: one connection, 4-second
acquisition timeout, 700-ms client/server query timeout, 10-second idle expiry,
and a 5-second HTTP deadline. Concurrent requests share an in-flight probe.
Abort/failure destroys the checked-out connection. Idle errors do not terminate
the process. Shutdown closes this pool and owner databases; app/server/lifecycle
construction failures also clean supplied resources.

The probe reads the target schema's `_prisma_migrations`. Every shipped migration
must have its matching SHA-256 checksum and a completed, non-rolled-back record.
Unresolved failed migrations deny readiness. Additional completed forward
migrations are permitted. This checks migration compatibility, not arbitrary
manual schema drift. Health requests perform no schema writes. The deployment
pre-step remains `npm run db:migrate:deploy`.

`/health/live` is independent of DB availability. `/health/ready` uses the existing
concealed `503 SERVICE_UNAVAILABLE` envelope for timeout, outage or incompatible
history and recovers after recovery. HTTP/OpenAPI schemas are unchanged.

Use direct PostgreSQL or Supabase session pooler connections. Direct Supabase
requires IPv6; session mode on port 5432 is the IPv4 alternative. Never use
transaction pooling for migrations. Keep `sslmode=verify-full` and the reviewed
CA certificate. Railway uses `/app/certs/supabase-root-ca.crt`; local clients use
the local certificate path. Never disable TLS verification to fix connectivity.
See [Supabase connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres).

A developer-only fault rehearsal can hold an exclusive migration-ledger lock in
a bounded transaction, request both health routes, roll back and verify recovery.
This demonstrates controlled query unavailability, not a complete network/provider
outage. A full outage requires an isolated target; do not stop/reconfigure a shared
Supabase project solely to obtain evidence.

## Operator-only Manager bootstrap

The CLI has no HTTP endpoint. Docker contains the compiled entry point. Build, then:

```text
npm run manager:bootstrap -- --inspect-target
npm run manager:bootstrap -- --environment=<environment> --operator=<operator-reference> --target=<fingerprint> --email=<authorized-email> --confirm-bootstrap
```

For source development use `manager:bootstrap:dev` with identical arguments.
Inspection performs no connection/mutation; it returns the environment and target
SHA-256 fingerprint of host/port/database/user/schema. Confirm it against the
intended project. Password and CA paths are excluded, so local/container access
to the same target agree.

Default input is a hidden terminal prompt with state restored after Enter,
cancellation, EOF, error or timeout. An approved secret source may supply an
inherited readable descriptor via `--password-fd=<number>` (stdin pipe is 0).
Every terminal descriptor is rejected in descriptor mode to prevent echo.
Input is one password bounded to 512 UTF-8 bytes; current Identity policy applies.
Never put passwords in argv, environment variables, demo seeds, logs, committed
files or shell history.

Exact environment, target, operator and confirmation are required before reading
the secret. Unknown/duplicate arguments, invalid email and mismatched target refuse
execution. The existing service normalizes email and hashes with approved scrypt.
Account, role, credential and audit commit in one transaction. An advisory lock
serializes first Manager creation. Any existing Manager role, even disabled,
refuses another bootstrap. Audit failure rolls the entire transaction back.

Success prints account/request IDs, target fingerprint, environment and operator.
Failure prints a static message and exits nonzero; inspect persisted bootstrap
audit before retrying an uncertain result. No email is sent. Audit metadata holds
only environment and operator. Later role provisioning and password recovery
remain the existing Identity flows.

Test a disposable local database first. Hosted rehearsal uses an owned isolated
schema, retains redacted evidence, then drops only that schema. The first Manager
in the public application schema is an explicit operator action with the intended
Manager's email and unique secret; this runbook does not seed that account.
