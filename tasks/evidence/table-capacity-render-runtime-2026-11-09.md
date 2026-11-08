# Table capacity release and Render pagination correction — 2026-11-09

The owner authorized push, PR merge and deployment of backend and both Web clients,
plus merge only for PRM-app. Backend PR #115, Manager Web #54, Couple Web #48 and
PRM-app #13 were merged after their applicable gates. Both Web production workflows
passed. Render deployment `dep-dbocs4c9v7es73etmobg` serves backend merge
`e7757d7a991f302382ae008301600522e9d38de0`.

Authenticated post-deploy verification exposed a PostgreSQL JIT cost missed by
the local Windows database: the effective-table sorting query timed out at the
existing transaction deadline (P2028); the ordinary recency page returned 200.
No data reset was applied while diagnosing this failure.

Read-only EXPLAIN ANALYZE against the same production data measured:

- JIT on: execution 7,595.739 ms, including 7,200.714 ms compilation, 70 functions.
- JIT off: execution 0.228 ms; estimated query cost 856,187.28; one matching row.

The correction sets `jit=off` locally inside the existing table-sort transaction.
It leaves the transaction timeout, database defaults, connection settings and
commercial rules intact. The setting is reset by PostgreSQL when the transaction
ends. Official behavior: https://www.postgresql.org/docs/17/jit-decision.html.

The native PostgreSQL regression first failed because compilation remained on.
After the correction all **8/8 capacity regressions passed** with one threads
worker. An earlier Windows fork worker aborted with native exit 3221226505; it is
not counted as passing verification. Changed-file ESLint passed. The complete
capacity suite is also added to the existing PostgreSQL CI acceptance step.

The owner's separate account-reset request is scoped to one Couple account and
its four bookings. Only redacted counts and confirmation belong in tracked
evidence. Private backups and account identifiers remain outside Git.
