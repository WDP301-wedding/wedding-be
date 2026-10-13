# Local frontend CORS and Railway FCM configuration

Date: 2026-10-13 (Asia/Saigon). Target: Railway production `wedding-be`.
Owner requested localhost ports 3000, 3001 and 3002, OpenAPI enabled and FCM
enabled; explicitly confirmed that the FCM change targets Railway.

## Change

The deployed baseline is `d257be8507dd83e9da73ac69605646a8fbcc7209`.
Its configuration rejects HTTP loopback origins in staging/production. Permit
only explicitly configured HTTP loopback origins while preserving exact-origin
matching, credential handling and rejection of non-loopback HTTP origins.
There is no wildcard or automatically granted localhost access.

Preserve all existing Railway HTTPS origins and append
`http://localhost:3000,http://localhost:3001,http://localhost:3002`.
Keep `OPENAPI_ENABLED=true` and change `NOTIFICATIONS_FCM_ENABLED` from false to
true. Preserve worker settings, recipient/booking fences, keys and service account.
Configuration is validated using the deployed version's parser without sending
provider requests. No FCM delivery evidence is claimed.

Local `.env`, `.env.demo`, `.env.example` and the demo configuration generator
also include the three local ports and `OPENAPI_ENABLED=true`.

## Verification

- Regression first: staging and production loopback configuration tests failed
  on the original guard, then passed after the change.
- Focused configuration/FCM/notification/security unit tests: 127 passed.
- New production HTTP preflight tests: all three ports passed; port 3003 denied.
- Typecheck, lint and production build passed.
- Contract suite: 45 passed; OpenAPI generation and drift check passed unchanged.
- Full offline suite: 1433 passed, 448 skipped, 1 failed test and 2 failed suites.
  The bootstrap fixture does not mock Guest runtime or provide DATABASE_URL.
  Two Invitation suites attempt their unavailable `127.0.0.1:1` database in hooks.
  These setup limitations do not constitute a passing full integration suite.
- Selected Railway variables were read back after updating with deploys skipped;
  before/after values are in `local-cors-fcm-config-2026-10-13.json`.
- No schema or migration changes; no paid generation, payment or provider smoke send.

## Railway rollout

Deployment `b9c90845-1798-4310-8d06-c6fc7db52b62` succeeded with source commit
`11af3c6`. Before rollout, all three localhost origins returned 403 with no
allow-origin header. After rollout, all three returned 204 preflight responses
with the exact requested origin and credential support. Existing public and
management Vercel origins still returned 204. Port 3003 and an unapproved HTTPS
origin returned 403 `CORS_ORIGIN_DENIED` with no allow-origin header.

`/health/ready`, `/docs` and `/api/v1/openapi.json` returned 200. The deployed
OpenAPI SHA-256 matched the unchanged local artifact:
`6a8be82541ca2d8ce274f9817d10bcd300c91de2f5e734055cf9108b23db0915`.
Both selected flags read back as true. FCM device delivery remains untested.
See `local-cors-before-deployment-2026-10-13.json` and
`local-cors-fcm-runtime-2026-10-13.json`.

Source changes are preserved in draft PR #42; production currently uses the
uploaded source. Merge the source fix before a later GitHub deployment so it
continues to accept the newly configured loopback origins. Existing runtime/
provider acceptance records and RV checklists remain unchanged.
