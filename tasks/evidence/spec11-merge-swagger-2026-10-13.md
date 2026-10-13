# SPEC-11 merge and Swagger verification

Date: 2026-10-13, Asia/Saigon. This record supersedes only the earlier unmerged-PR
state. The immutable release/provider manifests and NO_GO decision remain unchanged.

## Merge authorization and result

The owner explicitly asked to merge PR #40. Its final head
`c74dc2591b9356fe1bfa20b4eca363b297c0412d` had no review approvals. After the exact
CONTRIBUTING.md independent-review requirement was presented, the human owner
selected:

> Cho phép ngoại lệ review và merge PR #40

This is a one-off exception for PR #40, not another team member's approval or a
general waiver for later PRs. [Exact final-head CI](https://github.com/WDP301-wedding/wedding-be/actions/runs/38341202949)
had both jobs successful, no unresolved review thread and no merge conflict.
Focused review checked the strict release gates, local/dedicated target fencing,
non-overwriting seed behavior, bounded recovery operations, immutable receipt
publication, privacy and native money/planning regression assertions. No unresolved
critical/required finding was identified. No test, audit or coverage gate was waived.

[PR #40](https://github.com/WDP301-wedding/wedding-be/pull/40) was verified merged at
2026-10-13T03:35:33Z, with merge commit
`d257be8507dd83e9da73ac69605646a8fbcc7209` on `main`. The guarded GitHub merge used
the exact approved head and merge-commit method. The reviewed executable commit
`d0001d93e52dd392d7b2b5873ebbbf664084958d` remains an ancestor, preserving evidence
references. The exception is also recorded in the merge commit message.

## Swagger/OpenAPI checks

- `npm run api:generate` and `npm run api:check`: PASS; generation is byte-identical
  to the committed artifact, so no schema/digest rewrite was required.
- `npm run test:contract -- --maxWorkers=2`: **45 tests / 17 files PASS**. This includes
  canonical deterministic generation, session/API contracts, Swagger assets/security
  and deployed-path adaptation. It is not a new live provider test.
- `npm run api:check` on the new branch based on merged `main`: PASS.
- Canonical contract: **OpenAPI 3.1.0, 218 operations**, SHA-256
  `6a8be82541ca2d8ce274f9817d10bcd300c91de2f5e734055cf9108b23db0915`.

Read-only host checks:

| Target | Observed time (UTC) | Result |
| --- | --- | --- |
| Dedicated `spec11-staging` | 2026-10-13T03:31:44.270Z | Readiness, `/docs/`, canonical JSON, adapted Swagger JSON, initializer, JS bundle and CSS all 200; canonical digest matches; adapted paths match exactly, with health at root and business routes under `/api/v1`. |
| Existing developer target `wedding-be-production-e1dc` | 2026-10-13T03:42:22.512Z | Readiness, `/docs/` and canonical JSON 200; the same digest and 218 operations. The hostname is not a production-readiness claim. |

An actual in-app browser rendered the dedicated Swagger title, OpenAPI 3.1 metadata,
Authorize/schema controls and the searched Guest-management operations. No browser
warning/error was captured during this check. No Try-it-out mutation, credentials,
provider request, dispatch, database reset or deployment was executed for verification.

## Frontend document

[Vietnamese screen/Stitch brief](../../docs/frontend-stitch-design-brief-vi.md) contains
23 role-specific screen groups, public/Manager/Couple/Staff/Guest boundaries,
Web-versus-Android invitation behavior, money/planning/check-in rules, state handling,
verified API references and a copyable prompt. Screen/channel composition is a design
proposal within the implemented contract, not a new approved backend feature.
No sibling frontend source, build, UI or app configuration was modified.

Merge and successful schema checks do not change **NO_GO**: remaining runtime/provider/
worker evidence, separately owned frontend delivery and deferred FCM device acceptance
are preserved. Later documentation publication does not claim new provider/runtime
acceptance or a general independent-review exception.
