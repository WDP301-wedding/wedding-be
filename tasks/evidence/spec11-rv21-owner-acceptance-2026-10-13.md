# RV-21 owner acceptance of the synthetic demo NO_GO hand-off

Date: 2026-10-13, Asia/Saigon. This is an additive acceptance record; earlier
review packages, manifests and runtime/provider receipts remain unchanged.

After receiving the Vietnamese summary of the exact
[RV-21 review package](spec11-release-review-demo-rebuild-2026-10-13.md), the
project owner explicitly replied in the current task:

> tôi duyệt, hãy làm tiếp

The preceding summary stated the current **NO_GO** decision, the stopped email
worker, runtime/provider receipts from an earlier commit, synthetic-only demo
rebuild and deferred app-device FCM acceptance. It requested acceptance of that
hand-off before RV-21 → REL-W4 → REL-W5. This reply accepts those stated boundaries
and authorizes completing the two subsequent documentation/decision tasks.

Reviewed executable candidate: `d0001d93e52dd392d7b2b5873ebbbf664084958d`.
API SHA-256: `6a8be82541ca2d8ce274f9817d10bcd300c91de2f5e734055cf9108b23db0915`.
The [immutable reviewed manifest](spec11-release-manifest-demo-rebuild-2026-10-13.json)
identifies 218 API routes and 60 unchanged migrations. The later evidence-only
publication commit `a760622` does not replace the reviewed executable identity.
Historical runtime/provider evidence keeps its original source
`e8e7945548ac40d8308a5e4841fc0314c2d40276`.

**RV-21 is complete as owner review of this truthful NO_GO hand-off.** This is
neither another provider test nor production readiness. No configuration/runtime,
money, migration, provider receipt or quality gate is changed by accepting it.
The approval does not merge PR #40 or supply the independent team-member review
required by CONTRIBUTING.md.

Scope remains backend-only synthetic Railway staging/demo. Recovery uses a new
isolated database, immutable migrations and native deterministic seed; Lê Bá Bách
is the recovery owner. No ongoing 30-day backup requirement applies to this demo.
Email worker stays off after the two approved emails; FCM device configuration,
test and acceptance stay with the app team. Shared/production reset, additional
emails, paid generation and real-money payments are outside this acceptance.

Next authorized steps: finalize the immutable API/provider hand-off and frontend
integration checklist (REL-W4), then publish the backend NO_GO decision and recovery
hand-off (REL-W5). These tasks can complete while actual release readiness remains
NO_GO and frontend delivery remains separately owned.
