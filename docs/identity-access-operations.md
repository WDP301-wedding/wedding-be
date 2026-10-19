# Identity and access operations

This document is the operator contract for the approved identity and access boundary. Runtime
implementation must consume the typed values from `src/config/env.ts`; it must not duplicate or
silently override them.

## Security policy

- The web refresh credential uses the exact cookie name `__Host-wedding-refresh` with
  `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no `Domain` attribute.
- Access credentials live for 30 minutes. Refresh sessions expire after 30 idle days or 90 days
  absolutely, whichever comes first. Password-reset credentials live for 30 minutes.
- Workspace invitations live for 72 hours. At most three issues or reissues are allowed for one
  consultation/email pair in 24 hours.
- Passwords contain 12–128 Unicode characters and at most 512 UTF-8 bytes. The approved scrypt
  parameters are `N=131072`, `r=8`, `p=1`, a 64-byte derived key, and 256 MiB `maxmem`.
- Opaque access, refresh, invitation, and reset credentials use 32 random bytes before base64url
  encoding. Only purpose-separated deterministic hashes may cross the credential boundary into
  persistence, logs, errors, or snapshots.
- Login and one-time-token consumption allow 10 attempts per 15 minutes. Reset requests allow
  three per hour. Refresh allows 60 per 15 minutes. These are separate fail-closed buckets; no
  permanent account lockout is allowed.
- Invitation, password-reset, and expired/revoked session records are retained for 180, 30, and
  90 days. Disabled-account PII becomes eligible for deletion after 365 days only when terminal
  linked-record facts permit it. Legal and financial holds take precedence.

Staging and production must explicitly set every `AUTH_*` value shown in `.env.example`. The
parser accepts only the approved values. Development and test receive the same policy defaults;
only trusted-proxy hops default to zero. Set `AUTH_TRUST_PROXY_HOPS=1` only when exactly one
controlled reverse proxy sits between the application and every client. Any other topology needs
a reviewed configuration change before deployment.

Owner-approved update on 2026-10-19: access lifetime increased from 600 to 1800 seconds.
Deploy the code together with `AUTH_ACCESS_TOKEN_TTL_SECONDS=1800` and restart the backend;
the parser rejects the previous value. The new lifetime applies to access credentials issued
by login, invitation acceptance, and refresh after the update. Existing credentials retain
their persisted expiry.

## Initial Manager bootstrap

Manager creation is an operator-only deployment operation. There is no public registration route
and no generic role-assignment endpoint.

The IA-04 bootstrap command must enforce this sequence:

1. An authorized operator opens an audited shell in the target deployment and confirms the exact
   database and environment.
2. The operator supplies the normalized Manager email and display data as command options. The
   password is read from an interactive hidden prompt or an approved secret-file descriptor—never
   from command-line arguments, logs, shell history, or a checked-in environment file.
3. The command starts one database transaction, refuses to run if any Manager role already exists,
   creates the account/password verifier/Manager role, and emits an audit record identifying the
   operator and deployment request.
4. The operator verifies a successful audit event, removes any one-time secret material, and closes
   the audited shell. Re-running the command must fail closed.

Routine Manager or Staff lifecycle changes must use explicit privileged workflows with audit
events. Customer invitation acceptance may add only the `COUPLE` role scoped through consultation
access and can never grant `MANAGER` or `STAFF`.

## Identity retention execution

The identity retention command is operator-only and has no HTTP route. It processes one bounded
batch, rechecks D6 eligibility in PostgreSQL, anonymizes due disabled-account PII, revokes remaining
authentication material, and deletes terminal invitation, password-reset, and session metadata
after 180, 30, and 90 days respectively.

Both retention commands are operator-only. The project deployment operator owns
the daily 02:00 Asia/Ho_Chi_Minh review window: inspect the approved target, review
legal/financial holds and missing terminal facts, run at most ten batches of 100,
record the run IDs/counts, and defer remaining work to the next window. A zero
batch ends that command's run. This is an operator procedure, not an installed
automatic job. Production/shared-data execution still needs explicit environment
authorization; RV-06 rehearsal uses only populated disposable local PostgreSQL.

Before every execution, inspect `DATABASE_URL` through the read-only command.
Run these source CLIs from an approved operator checkout matching the deployed
release, with locked dependencies and the generated Prisma client (`npm ci`,
`npm run db:generate`). Supply its explicitly authorized database connection through
the operator's protected environment. The current HTTP Docker image does not
package these source scripts; this procedure does not claim a container scheduler.
Inspection prints host/port/database/schema and their SHA-256 fingerprint without username,
password or connection options, and opens no database connection. Then supply that
exact fingerprint and an opaque operator identifier (no personal contact data):

```powershell
npm run retention:identity -- --inspect-target
npm run retention:identity -- --confirm-retention --target-fingerprint=<sha256> --operator=<operator-id> --batch-size=100
npm run retention:consultation -- --inspect-target
npm run retention:consultation -- --confirm-retention --target-fingerprint=<sha256> --operator=<operator-id> --batch-size=100
```

The URL must specify its host, port and database explicitly. Destination overrides
in query parameters (including `host` and `port`) and socket-host encodings are
rejected before inspection or execution; driver/environment defaults cannot choose
a different destination from the confirmed target.

Commands refuse mismatched/missing fingerprints, missing operators, unknown or
duplicate arguments and invalid batches before connecting. Batch sizes are 1–1,000.
Successful completion emits an audit-correlated request ID, operator and counts;
the owner transaction records completion including zero batches. A crash/nonzero
exit is not completion: inspect the audit by run ID before retrying with the same
target. These commands are retry-safe. Never relax holds or manufacture missing
terminal facts to make a batch pass. Identity concurrent workers use PostgreSQL row locks with
`SKIP LOCKED`, so one account is anonymized at most once. Never point a development retention run
at the shared Supabase `public` schema.

An anonymized account retains its UUID only as a pseudonymous business/audit reference. Its login
and display emails move to the reserved `identity.invalid` domain, its password verifier is deleted,
active sessions and one-time credentials are revoked, invitation recipient email is scrubbed, and
`piiAnonymizedAt` records completion. Legal/financial holds and missing terminality facts fail
closed.

Intake keeps the existing 180-day policy: delete old unconverted requests; scrub
PII (including separate bride/groom names) on converted requests and preserve their
consultation reference. Converted business/audit/financial records are retained.
Intake does not invent an account hold policy for its separate lead records.
Its conditional updates/deletes make retries/concurrent batches safe. No deployed
shared-data cleanup or paid provider operation is part of the RV-06 audit.

## Scrypt benchmark evidence

On 2026-10-03, the approved parameters were measured on the Windows development host under Node
24 with three sequential hashes: 388 ms, 346 ms, and 317 ms (350 ms mean). The configured `maxmem`
ceiling is 256 MiB and the scrypt working-set estimate is approximately 128 MiB per concurrent
hash. Deployment sizing must therefore bound concurrent password work and repeat this benchmark on
the production compute class before launch; changing the cost requires a reviewed policy revision
and causes successful verification of older records to request rehash.
