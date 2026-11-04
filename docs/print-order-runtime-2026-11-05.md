# Retained printing after event completion

Owner report: Manager cannot start production or open retained prints for
`HY-000030` (cuong / cuong); print queue lacks couple, date and hall context.

Read-only production investigation reproduced PDF 404 for COMPLETED bookings
while the same Manager could read the existing orders. The standard media guard
requires CONFIRMED. Printing now uses a separately composed guard accepting
CONFIRMED or COMPLETED, retaining current session/role, own FULL Couple access,
verified deposit and approved event context. Only retained PDF/order reads and
existing approved-order fulfilment use it. Design/media changes, new purchases,
appendix consent and billing rules retain their original guards. No migration,
payment, order revision, original PDF, contract or invoice is rewritten.

Manager order lists/details add optional `bookingSummary`: bookingCode,
brideName/groomName (nullable explicit fields), ISO eventDate and nullable hallName
from the saved proposal. A Booking-owned batched reader uses one bounded joined
query for the entire page. Names are never inferred by splitting legacy text.
The strict response schema and generated OpenAPI include this additive field.

Production logs also show health requests returning RATE_LIMITED immediately
before instance restart at 2026-11-04T17:57:18Z. Health routes now run before the
general application limiter; CORS/security headers/deadline/readiness still run.
API rate limiting remains enforced. This prevents an exhausted API quota from
making an otherwise ready instance fail its platform probe; it is not a claim
that every possible upstream 502 has the same cause.

Verification:
- Reproduced new health regression as 429 before the fix, then green; HTTP health,
  security and explicit guard tests: 24 passed.
- Disposable PostgreSQL: retained PDF access after completion, denied design edit,
  existing appendix-order production, money invariance, authorization/revocation,
  and page context: 12 passed. Query overhead stays exactly one for 1/3/20 orders.
- Existing print-read-performance assertions were updated only for the additive
  response field; their old absolute query limits remain unchanged. This older
  suite reports budget failures because the existing authority/purchase reads
  already exceed its old caps. The new paired baseline/context test proves the
  added context incurs one fixed query, not a query for each order.
- An unrelated guest-completion case selected during the initial broad focused
  run fails while creating its old contract fixture (404 before completion).
  It is outside the required appendix-print acceptance filter and was not changed.
- Production evidence and exact release commits are recorded separately after
  deployment; local tests alone do not certify the live provider or deployment.
