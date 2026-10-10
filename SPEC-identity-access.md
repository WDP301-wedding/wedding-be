# Specification: Identity and Access

> Current amendment: [confirmed backend scope](./docs/backend-scope-2026-10-10.md) and [commercial extensions](./SPEC-commercial-contracts.md). Completed implementation evidence below is historical; new names/catalog/contract/invoice rules are separate backend extension tasks. The 2026-10-10 amendment governs conflicts with older access, pricing and client requirements.

Status: **Approved by project owner on 2026-10-03**
Module ID: `identity-access`
Requirement ownership: ACC-002 through ACC-007
Depends on: `core-platform`
Consumers: `venue-catalog`, `booking-lifecycle`, `payments-billing`, `invitation-studio`, `guest-management`, `seating-plan`, `staff-operations`, `notifications-automation`, `analytics-dashboard`

## 1. Objective

Deliver the authoritative account, authentication, session, role, restricted-workspace,
and Couple-access-promotion boundary for the single-restaurant system.

The module must let an invited prospective couple establish an authenticated Web
session without turning the invitation token into a permanent credential. Before a
successful deposit, that identity receives only consultation proposal and timeline
collaboration access. A successful deposit promotes the same account and consultation
access grant to full Couple access without copying the account or consultation data.

The same identity boundary authenticates Manager and Staff users for the Management
Web and full Couple users for Public Web and Android. All authorization remains
backend-enforced from current account, session, role, and resource state.

## 2. Requirement Trace

| Requirement | Owned outcome                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ACC-002     | An expiring, single-use workspace invitation bootstraps a real session; its raw token is never a durable bearer credential.                               |
| ACC-003     | A `RESTRICTED` consultation access grant permits proposal read and timeline collaboration only for its consultation.                                      |
| ACC-004     | Restricted prospects are denied media, invitation, guest, seating, print, and event-operation capabilities by the backend.                                |
| ACC-005     | A successful deposit promotes the existing consultation access grant to `FULL` without creating another account or consultation.                          |
| ACC-006     | Expired, revoked, superseded, or consumed invitations cannot create another session; invitation revocation does not delete consultation or audit history. |
| ACC-007     | Authentication and authorization use current backend state; client route visibility is never an authorization boundary.                                   |

ACC-001 remains owned by `booking-lifecycle`. That module asks the identity provider
contract to issue or revoke a workspace invitation after it creates a consultation.
Payment truth remains outside this module; a successful payment path calls the
idempotent access-promotion contract.

## 3. Scope

### 3.1 Included

- Email/password accounts for Manager, Staff, Prospective Couple, and Couple actors.
- Password hashing, login, logout, password reset, and session inventory/revocation.
- Short-lived access credentials and rotating refresh credentials.
- Management roles and consultation-scoped Couple access grants.
- Workspace invitation issue, reissue, expiry, revocation, and atomic acceptance.
- Idempotent `RESTRICTED` to `FULL` promotion after a successful deposit.
- Backend authentication middleware and deny-by-default authorization helpers.
- OpenAPI contracts and generated clients for Web, Management Web, and Android.
- Minimal login, invitation acceptance, password reset, session restore, and logout UX.
- Durable audit events and redacted operational telemetry for security-sensitive actions.

### 3.2 Excluded

- Consultation creation, timeline data, booking state, or payment processing.
- Staff event assignment and staff operational permissions beyond base authentication.
- Staff account business provisioning; `staff-operations` owns that lifecycle and may
  call an identity-owned account/role port after its own specification is approved.
- Guest personalized-link authentication; Guests continue to use guest-link contracts.
- Social login, SSO, passkeys, MFA, phone/SMS login, or biometric identity.
- Multiple restaurants, organizations, or tenant switching.
- Production email templates, campaigns, reminders, and delivery automation beyond the
  identity notification port.
- Production domain, DNS, and final cross-site cookie configuration; `release-demo`
  validates those deployment inputs against the approved transport decision.

## 4. Inherited Decisions

- The backend is the only authorization authority.
- PostgreSQL/Prisma owns all durable identity state; clients never query it directly.
- Zod validates external boundaries and generates OpenAPI 3.1 contracts.
- Errors use the core `{ error: { code, message, details?, requestId } }` envelope.
- All identifiers are UUIDs, timestamps are UTC, and business-time presentation uses
  `Asia/Ho_Chi_Minh`.
- Real secrets live only in backend environment variables or approved device-secure
  storage. No auth token may enter logs, audit metadata, URLs, analytics, or browser
  `localStorage`/`sessionStorage`.
- The initial backend remains one replica. Horizontal scaling is blocked until auth
  rate limiting and other process-local controls use an approved shared store.
- Email delivery stays behind a local interface and is testable through fakes.

## 5. Approved Decisions

The project owner approved the following architecture decisions at Checkpoint H1 on
2026-10-03.

| ID  | Recommended decision                                                                                                                                                                                                                                                                                                                                                                              | Reason / consequence                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | First-party PostgreSQL auth with Node `crypto.scrypt`; random opaque access and refresh credentials stored only as hashes.                                                                                                                                                                                                                                                                        | Avoids a new auth provider and JWT key lifecycle; the single backend already needs a current-state database read for immediate revocation and ACC-007.                                                                                                                                                                                 |
| D2  | Web keeps the short-lived access credential in memory and the rotating refresh credential in an `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` cookie with `Path=/` and no `Domain`. Android keeps only the refresh credential in Expo SecureStore and the access credential in memory.                                                                                                          | Prevents durable JavaScript-readable tokens while supporting Android. Unsafe cookie-authenticated requests also require an allowed `Origin`; `release-demo` must confirm the deployed Web/API hosts remain same-site.                                                                                                                  |
| D3  | Access lifetime 10 minutes; refresh idle lifetime 30 days; refresh absolute lifetime 90 days; password-reset lifetime 30 minutes.                                                                                                                                                                                                                                                                 | Limits stolen-token value while allowing practical session restoration. Refresh reuse revokes the whole session family.                                                                                                                                                                                                                |
| D4  | Workspace invitation lifetime 72 hours; only one active invitation per consultation/email; reissue atomically supersedes the prior token; at most 3 reissues per rolling 24 hours.                                                                                                                                                                                                                | Resolves the deferred invitation lifetime/reissue policy and bounds email/token abuse.                                                                                                                                                                                                                                                 |
| D5  | Passwords are 12–128 characters with no composition rule; compare only through scrypt and constant-time equality. Separate fail-closed buckets apply per resolved client IP and normalized subject/token fingerprint: login and token consumption allow 10 attempts per 15 minutes, reset request allows 3 per hour, and refresh allows 60 per 15 minutes. There is no permanent account lockout. | Long passwords and layered throttling resist credential stuffing, distributed account targeting, token-endpoint abuse, and attacker-triggered permanent denial of service. Scrypt parameters must be benchmarked on the deployment runtime during IA-02; proxy-derived IPs are trusted only under an explicit deployment proxy policy. |
| D6  | Terminal invitation metadata is retained for 180 days; terminal password-reset metadata for 30 days; expired/revoked session metadata for 90 days. Disabled account PII is retained for 365 days after its last linked consultation/booking reaches a terminal state, then deleted or anonymized unless an active legal/financial hold applies.                                                   | Provides abuse/audit evidence while bounding identity PII. Raw credentials are never retained; backup purge timing remains a deployment-policy input for `release-demo`.                                                                                                                                                               |
| D7  | Accepting an invitation always requires a password. For a new account it sets the first credential; for an existing matching account it verifies the existing credential and never overwrites it.                                                                                                                                                                                                 | Preserves one identity per normalized email and prevents an invitation from silently resetting an existing password.                                                                                                                                                                                                                   |

Any change to D1, D2, D5, D6, roles, CORS, or rate limiting requires explicit
project-owner approval because it changes authentication, token transport, PII
retention, or security policy.

## 6. Architecture and Dependency Direction

```text
Public Web / Management Web / Android
                 |
                 | HTTPS + generated OpenAPI types
                 v
        identity-access HTTP boundary
                 |
        services + policy contracts
          /          |          \
 PostgreSQL      AuditService    IdentityNotificationPort
                                      |
                                  EmailProvider

booking-lifecycle ----> WorkspaceInvitationIssuer (owned here)
payments-billing  ----> CoupleAccessPromoter (owned here)
future modules    ----> AuthenticatedActor + ConsultationAccessReader
booking-lifecycle ----> AccountRetentionEligibilityRecorder (owned here)
```

Dependency arrows always point from later modules to `identity-access`. This module
stores opaque `consultationId`, `bookingId`, and `sourcePaymentId` UUID references but
does not import later modules or query their tables. Later migrations may add database
foreign keys after the owning tables exist without moving policy ownership.

## 7. Trust Boundaries and Threat Model

### 7.1 Assets

- Password verifiers, access/refresh credentials, invitation/reset credentials.
- Account email and profile identity.
- Manager/Staff roles and consultation access level.
- Active sessions, revocation state, and security audit evidence.
- The promotion boundary that unlocks post-deposit Couple capabilities.

### 7.2 Untrusted inputs

- Login, reset, invitation, and refresh requests.
- Cookie, authorization header, origin, IP/proxy metadata, and client-kind claims.
- Email links and Android deep links.
- Forwarded-IP headers and deployment proxy metadata.
- Calls from later module services to invitation and promotion ports.
- Email-provider responses and any delivery identifiers.

### 7.3 Required abuse cases

| Threat                  | Required behavior                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Credential stuffing     | Generic login errors, strict throttling, no account enumeration, audited failure aggregates without email/token logs.               |
| Stolen invitation       | High-entropy single-use token, short expiry, stored hash only, password requirement, atomic consume.                                |
| Reissue/accept race     | Exactly one of reissue or acceptance wins; a superseded token cannot create a session.                                              |
| Refresh replay          | One rotation wins; reuse revokes the session family and emits a security audit event.                                               |
| Session theft           | Short access lifetime, refresh rotation, immediate server-side revocation, no durable browser-readable credential.                  |
| IDOR / role forgery     | Every resource call uses the authenticated account plus consultation-scoped access read from PostgreSQL; request roles are ignored. |
| Premature Couple access | Only the promotion port can move `RESTRICTED` to `FULL`; clients cannot submit access level or payment state.                       |
| Account enumeration     | Login and reset request responses are indistinguishable for unknown, disabled, and known emails where practical.                    |
| Token leakage           | Tokens are prohibited from URL query strings, logs, metrics, audit metadata, response errors, and persisted plaintext.              |
| Privilege escalation    | Role assignment and access promotion are separate audited operations with allowlisted callers and no generic “set role” endpoint.   |

## 8. Domain Model

### 8.1 Account and roles

- `Account`: normalized unique email, display email, status, timestamps.
- `PasswordCredential`: one current scrypt verifier and parameter/version metadata.
- `AccountRole`: unique `(accountId, role)` where role is `MANAGER`, `STAFF`, or
  `COUPLE`. `PROSPECT` is not a global role; it is a consultation access level.
- A restricted prospect does not gain `COUPLE` solely by accepting an invitation.
  Promotion of any consultation to `FULL` atomically upserts the account's `COUPLE`
  role; the account keeps that role while another authorized business record may
  still require it.
- Account status is `ACTIVE`, `SUSPENDED`, or `DISABLED`. Only `ACTIVE` accounts may
  create or refresh sessions.
- A deployment/bootstrap procedure creates the first Manager. No public registration
  endpoint exists.

### 8.2 Consultation access

- `ConsultationAccess` uniquely links one account and consultation.
- Access level is `RESTRICTED` or `FULL`.
- `RESTRICTED` permits only consultation proposal read and timeline collaboration
  contracts supplied by `booking-lifecycle`.
- `FULL` is monotonic and records `promotedAt` and `sourcePaymentId`.
- Promotion never changes the account ID, email, password, session family, or
  consultation ID.

### 8.3 Invitations and sessions

- `WorkspaceInvitation` stores consultation, normalized recipient email, optional
  resolved account, issuer, sequence, token hash, status, expiry, and terminal times.
- `Session` stores account, client kind, status, refresh-family identity, idle and
  absolute expiry, last-seen time, and revocation reason.
- Access and refresh credential records contain hashes, expiries, status, and rotation
  linkage. The raw values exist only at issuance/transport boundaries.
- `PasswordResetCredential` stores only account, token hash, expiry, status, and
  terminal timestamps.

## 9. State Machines and Concurrency

### 9.1 Workspace invitation

```text
ACTIVE ──accept──> ACCEPTED
   ├────revoke──> REVOKED
   ├───reissue──> SUPERSEDED + new ACTIVE invitation
   └────expiry──> EXPIRED
```

- Accept is a conditional update from `ACTIVE` where `expiresAt > now`.
- A unique partial-equivalent policy is enforced transactionally so only one active
  invitation exists per consultation and normalized email.
- Acceptance atomically creates/reuses the account, verifies/sets the password,
  creates the `RESTRICTED` consultation access, consumes the invitation, and creates a
  Web session.
- Revocation and reissue never delete consultation or durable audit records.

### 9.2 Session and refresh rotation

```text
ACTIVE ──logout/admin revoke──> REVOKED
   ├────idle/absolute time────> EXPIRED
   └────refresh reuse─────────> COMPROMISED (family revoked)
```

- Access credential lookup requires an active account and session on every request.
- Refresh rotation atomically consumes the presented credential and creates its
  successor. Concurrent reuse cannot produce two successors.
- A consumed refresh credential presented again is treated as possible theft and
  revokes the family, including the winner's successor.
- Password reset completion revokes all sessions for the account.
- Retention eligibility is accepted only through the internal typed port, is audited,
  and never bypasses the 365-day wait or an active legal/financial hold.

### 9.3 Couple access promotion

```text
RESTRICTED ──successful-deposit evidence──> FULL
FULL ──duplicate promotion evidence───────> FULL (idempotent replay)
```

- The input contains account, consultation, and source payment identifiers; it never
  contains a caller-selected target level.
- A transaction/unique constraint chooses the winner under concurrent callbacks.
- A different account or consultation for an already-used payment identifier fails
  with conflict and emits an audit event.
- There is no demotion transition in this module. Refund/cancellation consequences
  must be specified by their owning future module before changing this rule.

## 10. Authorization Contract

Authentication produces this internal, immutable shape:

```typescript
type AuthenticatedActor = Readonly<{
  accountId: string;
  sessionId: string;
  roles: readonly ('MANAGER' | 'STAFF' | 'COUPLE')[];
}>;
```

The shape is created only from current database state. Handlers never accept account,
session, role, or access-level claims from a request body or query.

The provider API exposes:

```typescript
interface ConsultationAccessReader {
  requireAccess(
    input: Readonly<{
      accountId: string;
      consultationId: string;
      minimum: 'RESTRICTED' | 'FULL';
    }>,
  ): Promise<Readonly<{ level: 'RESTRICTED' | 'FULL' }>>;
}

interface WorkspaceInvitationIssuer {
  issue(input: IssueWorkspaceInvitationInput): Promise<IssuedWorkspaceInvitation>;
  reissue(input: ReissueWorkspaceInvitationInput): Promise<IssuedWorkspaceInvitation>;
  revoke(input: RevokeWorkspaceInvitationInput): Promise<void>;
}

interface CoupleAccessPromoter {
  promote(
    input: Readonly<{
      accountId: string;
      consultationId: string;
      sourcePaymentId: string;
    }>,
  ): Promise<Readonly<{ level: 'FULL'; replayed: boolean }>>;
}

interface AccountRetentionEligibilityRecorder {
  record(
    input: Readonly<{
      accountId: string;
      eligibleAfter: Date;
      sourceBusinessRecordId: string;
    }>,
  ): Promise<void>;
}
```

Later modules combine the actor and access reader with the current resource state that
they own. `identity-access` never calls `booking-lifecycle` or `payments-billing` to
discover that state, preventing a dependency cycle. Because identity does not own
consultation/booking terminality, the owning business module records an audited
retention-eligibility fact after every linked business record is terminal. Identity
requires a fact for every consultation access currently linked to the account, so a
new invitation/link automatically blocks erasure. Identity still enforces D6's waiting
period and legal/financial holds before erasure or anonymization.

## 11. Draft HTTP Contract

All routes live under `/api/v1`, use strict Zod schemas, the common error envelope,
`Cache-Control: no-store`, and the existing request ID. Secret-bearing inputs must not
be echoed.

| Method and path                          | Authentication                   | Contract summary                                                                                               |
| ---------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `POST /auth/web-sessions`                | Public                           | Email/password login; returns short-lived access credential and account summary, sets rotating refresh cookie. |
| `POST /auth/android-sessions`            | Public                           | Email/password login; returns access and refresh credentials once.                                             |
| `POST /auth/web-session-refreshes`       | Refresh cookie + allowed Origin  | Atomically rotates refresh cookie and returns a new access credential.                                         |
| `POST /auth/android-session-refreshes`   | Refresh credential body          | Atomically rotates and returns both credentials.                                                               |
| `DELETE /auth/sessions/current`          | Access credential                | Revokes the current session and clears a Web refresh cookie when present.                                      |
| `GET /auth/me`                           | Access credential                | Returns current account ID, roles, session ID, and safe profile fields; no credential or password metadata.    |
| `POST /auth/password-reset-requests`     | Public                           | Always returns the same accepted response; sends a reset intent only for eligible accounts.                    |
| `POST /auth/password-reset-completions`  | Reset credential in POST body    | Atomically consumes the credential, changes the password, and revokes all sessions.                            |
| `POST /workspace-invitation-acceptances` | Invitation credential + password | Atomically accepts an invitation and creates a restricted Web session.                                         |
| `GET /auth/sessions`                     | Access credential                | Returns a bounded cursor page of the caller's active sessions without token material.                          |
| `DELETE /auth/sessions/{sessionId}`      | Access credential                | Revokes one session owned by the caller.                                                                       |

Unauthorized and forbidden resources may return `404 NOT_FOUND` where concealing
existence prevents enumeration. Authentication failures use stable machine codes such
as `INVALID_CREDENTIALS`, `INVALID_OR_EXPIRED_TOKEN`, `SESSION_REVOKED`, and
`FORBIDDEN`; messages never distinguish unknown emails from incorrect passwords.

Invitation and password-reset email links place the raw token in the URL fragment, not
the query string. Public Web reads the fragment, replaces the URL before rendering or
telemetry, and submits the token in a POST body over HTTPS.

OpenAPI documents retry behavior for every state-changing route. Logout and owned
session revocation are idempotent. Clients serialize refresh, invitation acceptance,
and reset completion and do not automatically replay them after an unknown outcome;
refresh ambiguity falls back to login, while a consumed invitation/reset flow directs
the user to normal login with the password they just established. Secret-issuing
responses are never persisted in the core idempotency store merely to make replay
possible.

## 12. Notification Boundary

Identity owns credential state and message intent, not provider details or future
scheduling. It exposes an `IdentityNotificationPort` for workspace invitation and
password-reset delivery. The initial adapter validates and sends through the existing
`EmailProvider`; tests use a fake. `notifications-automation` may later implement the
same port asynchronously without moving token or account ownership.

Email idempotency keys derive from the invitation/reset record ID and message purpose.
Raw tokens may appear only in the outbound provider command created at the last
possible moment. Provider responses are validated and never copied into client errors.

## 13. Configuration

After D1–D5 approval, backend configuration adds allowlisted values for credential
lifetimes, password-cost parameters, auth rate limits, and cookie policy. Defaults are
allowed only in development/test; staging/production must fail fast if required secret
or origin settings are absent.

No auth secret is public. `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` remain limited to API
base URLs and non-secret identifiers. Android secure storage requires the approved Expo
module and must never fall back to AsyncStorage.

## 14. Project Structure

```text
wedding-be/
├── prisma/                         # identity schema and forward migrations
├── src/modules/identity-access/
│   ├── account/                    # account, credential, and role services
│   ├── session/                    # access/refresh issuance and rotation
│   ├── workspace-invitation/       # invitation state and acceptance
│   ├── authorization/              # actor and consultation-access contracts
│   ├── password-reset/             # reset lifecycle
│   ├── identity.router.ts          # HTTP composition only
│   └── identity.schemas.ts         # Zod/OpenAPI boundaries
└── tests/integration/identity-access/

wedding-web/
├── app/(auth)/                     # login, invitation acceptance, reset
├── app/(couple)/                   # restricted/full shells only
└── src/features/identity-access/   # session store and auth UI

wedding-manage-web/
├── app/(auth)/                     # Manager/Staff login and reset
└── src/features/identity-access/   # session store and route guards

wedding-app/
├── src/app/(auth)/                 # Couple login/reset routes
└── src/features/identity-access/   # SecureStore session adapter
```

Route files remain thin; UI bodies live outside router directories. Domain code does
not import Express, Prisma-generated input types, Next.js, or Expo.

## 15. Code and Contract Style

- Strict TypeScript, ESM, kebab-case filenames, PascalCase types, camelCase values.
- Inputs and outputs are separate types; IDs for different concepts are not silently
  interchangeable.
- Schemas are strict and reject undocumented fields.
- State transitions are explicit functions and conditional database writes, not
  arbitrary enum assignment.
- Public API schemas are registered once and generated into OpenAPI/client types.
- New API fields are additive; breaking changes require a separately approved version
  plan.

## 16. Testing Strategy

### 16.1 Unit and mutation-sensitive tests

- Token generation/hashing never persists or logs raw values.
- Password verification covers correct, incorrect, malformed, and parameter-version
  paths with deterministic test doubles around costly crypto where appropriate.
- Policy tables exhaustively cover role and access-level allow/deny outcomes.
- Invitation, refresh, reset, and promotion transition guards cover every terminal
  state and invalid transition.
- Tests must fail when an authorization condition is inverted or removed.

### 16.2 PostgreSQL integration and concurrency tests

- Concurrent invitation acceptance has exactly one winner/session.
- Reissue racing acceptance produces either accepted-old or superseded-old, never both.
- Concurrent refresh has one rotation winner; replay revokes the family.
- Concurrent promotion stores one `FULL` transition and one audit fact.
- Promotion atomically upserts the `COUPLE` role without duplicating the account or
  consultation access record.
- Password reset completion is single-use and revokes every active session.
- Account-retention tests cover premature eligibility, multiple linked business
  records, active holds, idempotent facts, and due anonymization/erasure.
- Unique normalized email, invitation, role, session, and payment-source constraints are
  exercised against real PostgreSQL.

### 16.3 Contract and client tests

- OpenAPI covers success, validation, authentication, authorization, throttling, and
  generic enumeration-safe errors.
- Generated client schemas remain identical across all three clients.
- Public Web verifies fragment removal, memory-only access credentials, refresh-cookie
  behavior, restricted/full route presentation, and logout.
- Management Web verifies Manager/Staff route presentation but still expects backend
  denials for forged roles.
- Android verifies SecureStore-only refresh persistence, process restore, rotation, and
  logout deletion.
- Cross-module contract fixtures prove `RESTRICTED` is denied from every ACC-004
  capability and `FULL` alone is insufficient without resource ownership.

### 16.4 Requirement-to-test matrix

| Requirement | Planned automated evidence                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| ACC-002     | Invitation expiry/hash/consume unit tests; atomic acceptance integration test; Web fragment/token-leak test.             |
| ACC-003     | Consultation access policy table; restricted timeline/proposal contract fixture; cross-consultation IDOR denial.         |
| ACC-004     | Deny matrix for media, invitation, guest, seating, print, and operations capability contracts.                           |
| ACC-005     | Concurrent idempotent promotion integration test; same account/access IDs before and after promotion.                    |
| ACC-006     | Expired/revoked/superseded/consumed invitation tests; audit and consultation reference preservation.                     |
| ACC-007     | Middleware tests against forged client roles, revoked sessions, stale access, wrong consultation, and disabled accounts. |

## 17. Privacy, Retention, and Audit

| Data                          | Classification              | Purpose                                     | Approved retention                                                                                                                                 |
| ----------------------------- | --------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email/display name            | PII                         | Login, invitation delivery, account support | Active account lifetime; for disabled accounts, 365 days after the last linked business record becomes terminal, then delete/anonymize unless held |
| IP/user-agent/device label    | PII                         | Abuse defense and session recognition       | Session lifetime plus 90 days                                                                                                                      |
| Password verifier             | Sensitive credential        | Authentication                              | Until replacement/account erasure; never export                                                                                                    |
| Token hash                    | Sensitive security metadata | Single-use/replay detection                 | Per D6 terminal retention                                                                                                                          |
| Raw token/password            | Secret                      | One request/provider handoff only           | Never persist or log                                                                                                                               |
| Role/access/promotion history | Security/audit data         | Authorization and dispute evidence          | Pseudonymize account references when D6 account erasure runs; keep the minimum non-PII evidence required by the owning business record             |

Audit actions include login success/failure aggregate, logout, session revoke, refresh
reuse, password reset completion, invitation issue/reissue/revoke/accept, account status
change, role change, and Couple access promotion. Metadata is allowlisted and excludes
email, IP, user-agent, token hashes, raw provider responses, and message bodies unless a
later privacy review explicitly approves a pseudonymous field.

## 18. Observability

- Counters cover login outcomes, invitation outcomes, refresh outcomes, authorization
  denials by stable reason, and password-reset requests/completions.
- Metrics contain no account ID, consultation ID, email, IP, session ID, or token.
- Logs use event names and request IDs; the existing redactor remains defense in depth,
  not permission to log bodies.
- Alerts/operational thresholds are finalized in `release-demo`; this module supplies
  the stable low-cardinality signals.

## 19. Commands and Verification

Backend focused commands:

```powershell
npm run db:generate
npm run db:migrate:deploy
npm run test:unit -- identity-access
npm run test:integration -- identity-access
npm run test:contract
npm run api:check
npm run test:coverage
npm run lint
npm run typecheck
npm run build
npm run audit:ci
```

Client commands in each affected repository:

```powershell
npm run api:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Expo additionally runs `npx expo-doctor` and `npm run audit:ci`. Every dependency
change begins with script-disabled review and ends with a clean `npm ci`.

## 20. Boundaries

### Always

- Validate every external auth input and verify authorization for every protected
  resource.
- Store only password/token hashes and use constant-time comparison.
- Make invitation, reset, refresh, and promotion transitions atomic and auditable.
- Use generic public errors and `Cache-Control: no-store` on auth responses.
- Revoke sessions on password reset, account disable, and refresh reuse.
- Derive rate-limit IPs from the direct socket unless an explicit trusted-proxy policy
  has been validated for the deployment topology.
- Test actual denials, concurrency, expiry boundaries, and token redaction.

### Ask first

- Change auth mechanism/provider, password policy, token transport, lifetimes, cookie
  flags, CORS, role grants, rate limits, or PII retention.
- Add a public registration flow, MFA, social identity, Redis/queue infrastructure, or
  another external provider.
- Permit more than one backend replica before shared security controls exist.
- Add a new PII field or send identity data to a third party.

### Never

- Trust role, account, consultation, payment, or access-level claims from a client.
- Store a raw password, invitation, reset, access, or refresh credential.
- Put credentials in URL queries, logs, metrics, audit metadata, browser storage, Git,
  or error responses.
- Treat hidden UI, decoded token fields, email possession after bootstrap, or a
  successful historical payment as sufficient current authorization.
- Create a second Couple account or consultation during promotion.

## 21. Success Criteria

1. ACC-002 through ACC-007 each map to explicit automated evidence.
2. Invitation acceptance is atomic, single-use, expiry-aware, and establishes a real
   revocable session without persisting the raw token.
3. Access and refresh credentials rotate/revoke as specified; refresh replay is
   detected and contained.
4. Passwords and reset credentials follow the approved cryptographic, throttling, and
   enumeration-safe policy.
5. Manager, Staff, restricted prospect, and full Couple access are backend-enforced
   from current state with cross-resource IDOR tests.
6. Deposit promotion is idempotent, monotonic, audited, and preserves the existing
   account and consultation access identity.
7. The OpenAPI contract and three generated clients remain deterministic and current.
8. Public Web, Management Web, and Android implement only presentation/session
   transport; they cannot grant a role or access level.
9. Auth logs, metrics, audit records, URLs, and client persistence contain no raw
   credential or unapproved PII.
10. All repository quality, PostgreSQL, contract, browser, Expo, and dependency-audit
    gates pass before implementation approval.

## 22. Approval Record

Checkpoint H1 approved D1 through D7 as written on 2026-10-03:

1. Approve first-party opaque-token auth, or choose an external auth provider/JWT.
2. Approve the Web cookie/in-memory and Android SecureStore transport split.
3. Approve the 10-minute / 30-day idle / 90-day absolute session policy.
4. Approve the 72-hour invitation and 3-reissues-per-24-hours policy.
5. Approve password length, scrypt, and throttling recommendations.
6. Approve the draft metadata periods and the 365-day disabled-account
   deletion/anonymization rule; `release-demo` must still fix backup purge timing and
   the legal/financial hold operator procedure.
7. Approve the existing-account invitation behavior requiring the existing password.

The approval authorizes the ordered IA-01 through IA-17 implementation plan. Any change
to the approved decisions or stop conditions still requires project-owner review.

## 23. Account Settings and Current Password OTP

These existing backend requirements are consolidated from the archived
[post-Booking scope](./docs/archive/post-booking-experience-2026-10-08.md) and the
current runtime. Preserve [post-Booking evidence](./tasks/evidence/post-spec03-experience.md)
and [OTP evidence](./tasks/evidence/password-otp-local-demo.md). This documentation
change does not add endpoints or close live mailbox/transport gates RV-04/05.

- `GET /auth/profile` returns the current actor's account label/email and profile
  revision. `PATCH /auth/profile` changes only normalized displayName (1–120
  characters) using expectedRevision, active-session recheck and an atomic audit.
  Email/roles are not writable; stale revisions conflict. Account displayName is not
  booking-owned brideName/groomName and cannot be split to infer either role.
- Password recovery uses `POST /auth/password-otp-requests` and
  `POST /auth/password-otp-completions`. Authenticated password change first uses
  `POST /auth/password-change-otp-requests` with the current password, then
  `POST /auth/password-changes` with its challenge/code/new password.
- Current challenge delivery/expiry, attempts, hash-only storage, enumeration-safe
  responses, actor binding, transactional revocation and password policy follow the
  [OTP application](./src/modules/identity-access/password-otp/password-otp.service.ts)
  and [strict schemas](./src/modules/identity-access/password-otp/password-otp.schemas.ts).
  Successful completion clears the refresh cookie, revokes authentication material
  as implemented and requires a fresh login. Never store/log raw passwords or OTPs.
- Legacy `/auth/password-reset-requests` and `/auth/password-reset-completions`
  return `410 PASSWORD_OTP_REQUIRED` in the mounted runtime. Older reset-link
  descriptions/checkpoints are historical, not an active integration instruction.
  Staging/production require stable AUTH_OTP_HASH_KEY; credential presence alone does
  not prove real mailbox delivery or deployed recovery.
- Account profile PII follows account erasure. Existing retention/holds and operator
  rules remain unchanged. Client screens/credential transport are the frontend team's
  responsibility; backend requirements here are authorization and HTTP contracts.

All paths above are relative to `/api/v1`; consume the [committed OpenAPI](./openapi/openapi.json),
not the retired mixed-client specification as a route authority.

## 2026-10-10 Backend Extension

The restricted prospect guard must allow booking-owned profile and commercial selection/approval/PDF operations before deposit; still deny media/editor/send/guest/seating/print production. Full access remains based only on verified deposit. Update guard contract/conformance within BE-02/07/09 without changing account displayName semantics.

Authority and validation: [commercial specification](./SPEC-commercial-contracts.md),
[confirmed scope](./docs/backend-scope-2026-10-10.md) and
[active backend tasks](./tasks/backend-revision-todo.md). These requirements do not
claim that the pending extension is already mounted in the generated API.
