# Invitation image jobs release: dependency audit repair

PR #82 merged as `68184b5c40c68748913729d8ac5e88d500c51c0a`. Its main-branch
CI run `39529391734` reported a newly available high-severity Vite advisory
(`1242662`, `GHSA-587h-7wmj-h5pm`), blocking Railway's existing Wait for CI gate.

Pin the Vitest peer dependency Vite to `8.3.3`, the smallest patched release.
The regenerated lockfile also updates its required Rolldown dependency and
platform bindings from `1.2.10` to `1.2.14`, and the associated Oxc types from
`0.151.0` to `0.154.0`. All changed packages are development dependencies;
production dependencies, application behavior, migrations, audit policy and
coverage thresholds remain unchanged.

Review compared the complete old/new lockfile graph: only Vite and its required
development dependency subgraph changed. The selected version satisfies Vitest's
existing peer range and the repository's Node 24 engine. No new condition or
application logic was introduced. A clean locked install reports zero
vulnerabilities, and the existing dependency audit policy passes without an
exception. Changed-file formatting and Prisma client generation also pass.

Local unit tests pass (1,482). The first local contract run passed 98/99; the
Swagger asset-serving test exceeded its unchanged five-second timeout under
concurrent Windows execution. The serial rerun passes all 99 contract tests
with the same assertions and timeout. Required Linux CI repeats both suites
before release, together with PostgreSQL integration and full coverage.

Upstream evidence:

- [Maintainer advisory](https://github.com/vitejs/launch-editor/security/advisories/GHSA-587h-7wmj-h5pm)
- [Vite 8.3.3 release](https://github.com/vitejs/vite/releases/tag/v8.3.3)

The release continues through the existing pull-request and main-branch CI gates
before Railway deploys it. No local PostgreSQL process or paid image generation
is required for this dependency repair.
