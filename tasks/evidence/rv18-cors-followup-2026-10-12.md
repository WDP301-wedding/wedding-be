# RV-18 final browser-header hand-off

Final source `7a39a7ec398801b68b33edf228680ba729e17ffa` adds explicit
Access-Control-Expose-Headers for the authenticated PDF route, so approved browser
origins can read Content-Disposition, X-Content-SHA256, X-Printable-Content-Digest
and X-Renderer-Version, while retaining request-ID/Retry-After exposure. The origin
allowlist, authorization and renderer are unchanged. This is backend protocol
verification, not a frontend/browser UI acceptance claim.

[CI 38169417246](https://github.com/WDP301-wedding/wedding-be/actions/runs/38169417246)
passed all static/build/OpenAPI/audit checks, empty migration deployment, 382
PostgreSQL integration tests and 1,652 full-suite tests in 214 files. Overall
branch coverage is 93.56%, line coverage 97.33%, with per-file 80% thresholds.
The focused native PDF test verifies permitted-origin metadata and forbidden-origin
denial. Its first extended fixture returned 500 because CORS preceded the fixture's
request context; matching production's context-before-CORS order fixed the fixture
without changing Core CORS/error behavior.

The immutable Git archive was deployed to the same owner-authorized developer-only
Railway target, deployment `8ca52ed5-afef-4bc3-88cf-db91a1d50752`. Thirteen compiled
or font artifact hashes match the built source, including logging/error and CORS
policy artifacts. OpenAPI SHA-256 is
`55c15733cdc25a9151c724e311cb5753f9b41124a15c879cf73cc3c90c108b9e`
(144 paths), PostgreSQL reports TLSv1.3 and 44 applied migrations, and both health
routes return 200. [Deployment proof](rv18-cors-deployment-2026-10-12.json).

Actual allowed-origin inline and attachment GETs returned 200 with the exact
metadata exposure list and matching allowed-origin/credentials headers. An
unapproved origin returned 403 CORS_ORIGIN_DENIED without an allow-origin header.
All three request IDs matched current deployment HTTP logs. The existing approved
image PDF remains 27,401 bytes with SHA-256
`96ca898707e8992738a2a7af10961f1c9119a82af4ab07265696fcd37743b5da`.
Billing remains revision 6, charges/paid 8,122,002 VND and zero
outstanding/credit/refunded totals. No new payment or paid generation occurred.
[Native HTTP/runtime proof](rv18-cors-runtime-2026-10-12.json).

The one follow-up Manager session was revoked through its native API and then
returned 401. The additional task SSH key was revoked and its local files removed.
Other sessions, financial and print history remain untouched.
[Follow-up cleanup](rv18-cors-cleanup-2026-10-12.json).

Earlier RV-14/15 and RV-17/18/20 receipts remain historical at their recorded source
and deployment. This follow-up supersedes the final active deployment/API digest
and adds browser-readable file metadata; it preserves their accepted file,
financial and observability results. Metrics/OTLP remain optional disabled and
production readiness remains outside this verification.
