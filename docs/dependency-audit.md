# Dependency audit gate

CI runs `npm run audit:ci`, which executes npm's lockfile-based audit at the
`high` threshold. The gate fails closed when npm returns malformed data, when a
new high/critical advisory is not documented, or when a matching exception has
reached its `reviewBy` date.

Temporary exceptions live in `dependency-audit-exceptions.json`. Each entry
records the advisory identity, affected package, reachability, mitigation,
owner, and mandatory review date. An exception does not change package
resolution and is not a general severity waiver. Remove it as soon as the
committed dependency graph no longer reports the advisory.

Do not use `npm audit fix --force`: it may cross the approved Prisma dependency
line. Review a compatible upstream release, update the exact pins and lockfile,
then run the complete quality and PostgreSQL integration gates before removing
an exception.
