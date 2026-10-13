# Specification: Release Demo

> Current execution scope: backend release verification and API hand-off only, under the [2026-10-10 amendment](./docs/backend-scope-2026-10-10.md). Web/Android builds, client screenshots and client deployment belong to the frontend team; full product release remains a separate joint gate.

- Status: **Backend release tooling/local checkpoint implemented — release acceptance NO_GO; staging/dependencies pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `release-demo` (`SPEC-11`)
- Contract baseline: `WEDDING-CONTRACT-3@3.0.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Sections 22/23 (2026-10-10); historical approvals retained
- Initial owner role: Unassigned (next allocation round)
- Team execution contract: [`docs/team-implementation.md`](./docs/team-implementation.md)
- Requirement ownership: release verification, deployment, demo evidence, and rollback readiness
- Depends on: all preceding modules
- Consumers: project owner and demo reviewers

## 1. Purpose and boundary

This module owns no business state or alternate business rules. It composes accepted
public contracts into deterministic seed scenarios, deployment configuration, demo
script, monitoring/alert checks, evidence, and rollback procedure. It cannot paper over
an unaccepted provider with mocked client behavior.

## 2. Required release contract

A release candidate records:

- exact backend/client commit and generated OpenAPI digest;
- forward migration order and verified backup/rollback posture;
- environment-variable presence checks without secret values;
- deterministic idempotent demo seed keys that never overwrite Manager-managed data;
- Android EAS artifact identity, Web/API URLs, and health-check evidence;
- named owner, timestamp, result, and redacted evidence for each acceptance scenario.

The end-to-end journey must demonstrate consultation invitation, restricted timeline
collaboration, full menu/print/service contract and dual approval, proven 30%-total deposit/access promotion, media/invitation,
Groups/optional named Guests and independent planning headcount, seating
invalidation/reconfirmation, print quote/charge, opt-in one-person Staff check-in/undo,
approved appendices, incidental expenses and locked final invoice,
notifications, and analytics. The generic QR must remain
non-personalized and non-authorizing throughout.

## 3. Deployment, verification, and rollback

Deployment runs forward-only database migrations in the serialized migration lane and
checks health/readiness before client rollout. The release script never runs seed data
automatically in production. A rollback plan distinguishes reversible client/service
deployment from irreversible schema/data migration; it specifies compatible forward fix
or restore point rather than destructive database rollback.

Required proof includes versioned API contract checks in all clients, migration from empty
and prior approved schema, focused security/redaction tests, smoke tests of provider
integrations, Android install/launch, monitoring/log checks, and a documented recovery
owner. No secret, token, raw PII, signed URL, or payment callback body is captured in
demo evidence.

## 4. Acceptance

Release acceptance requires every preceding module's provider and real integration gate,
all cross-module scenarios from the product requirements, no unresolved contract drift,
and an owner-reviewed demo/rollback checklist. Failure of a required provider, migration,
or privacy check blocks release; a visual workaround does not waive the contract.

## 5. Deployment inputs and ownership contract

| Input            | Owner / required proof                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web/API hosts    | Release steward records real HTTPS hosts; Public Web, Management Web, and API are same-site under identity D2.                                                                                   |
| Cookies/CORS     | __Host- refresh cookie is Secure/HttpOnly/SameSite=Lax/Path=/ with no Domain; allowed exact Origins, credentialed cross-origin requests and refresh/logout are tested in both deployed Web apps. |
| Runtime scale    | One backend replica until shared rate-limit/security controls are separately approved and verified. Worker scheduling uses durable claims.                                                       |
| Secrets          | Backend-only database, merchant/signing, Storage, email, AI, push and credential-encryption inputs; client builds contain public API/project identifiers only.                                   |
| Database         | Migration steward records ordered forward migrations, latest compatible app version, restore point and disposable empty/upgrade verification.                                                    |
| Backup retention | Approved deployment requirement: rolling 30-day encrypted backups, restricted access, no forgotten indefinite exports; restore must replay approved erasure tombstones before reopening traffic. |
| Android          | Release owner records EAS project/profile/build ID, package/signing ownership, downloadable APK and install evidence; required target Android only.                                              |
| Evidence         | Module owner produces redacted requirement/race/real-provider evidence; steward composes release manifest without credentials/PII.                                                               |

The 30-day backup requirement is an approved explicit deployment default resolving the
identity-owned deferred backup purge input; actual host support is verified before go-live.
Restore cannot re-enable erased identity/guest data merely because backup is older.
Deployment vendor/host URLs and secrets are environment provisioning inputs, not a reason
to change auth transport or publish a Storage bucket without contract review.

Release manifest DTO contains `releaseId, createdAt, repositoryCommits[repo,sha],
apiContractSha256, migrationNames[], seedScenarioIds[], deploymentTargets[],
androidBuildId, evidenceLinks[], recoveryOwner, goNoGoResult`. No moving branch or
uncommitted schema is recorded as the release artifact. Every client lock points to the
exact backend digest in that manifest.

## 6. Deterministic seed and end-to-end scenario contract

Seeds use stable IDs/keys in the backend demo environment only and are idempotent.
They insert missing scenario data, verify existing matching immutable fixtures, and stop
on conflicting Manager-modified data rather than overwrite it. Provider-owned seed
adapters or approved command ports create each module's records; release does not
invent cross-module SQL mutations.

| Scenario                        | Required observation                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Restricted consultation         | One invitation/account/access; restricted Web timeline works; media/guest/seating/print denied.                                                                                          |
| Timeline/deposit                | Current mutual approval, stale revision rejected, verified sandbox/manual deposit confirms and promotes same identity.                                                                   |
| Private media/public invitation | Original private, approved derived asset public, generic QR without Guest/attendance-write/check-in authority; no names required.                                                        |
| Groups/planning without names   | No Guest list; manual total preserved, Group labels/compatible layout/printing/event completion/final invoice still work. NONE reports not recorded/null.                                |
| Optional Guests/headcount       | Partial named import/archive changes listedGuestCount only; explicit total edit uses ordered sync; no automatic count reset or check-in enable.                                          |
| Seating/print                   | Inclusive capacity, exception audit, invalidation blocks new print, exact printable/quote/charge snapshot, no recipient names.                                                           |
| Optional check-in               | Explicit enable, duplicate names disambiguated, one effective check-in per Guest under concurrent retries, undo/history and mode-lock proof. Partial list is not total event attendance. |
| Notifications                   | Real outbox, duplicate dedup, reminder revision/cancel behavior, credential-safe delivery, completion through booking port.                                                              |
| Analytics                       | Independent planning/list/check-in counts, disabled null versus enabled measured zero; no whole-event turnout inference; money/source/history/freshness proof.                           |
| Frontend hand-off               | Publish exact API digest, DTOs/errors and denial examples; frontend verifies its clients separately.                                                                                     |
| Recovery                        | Migration upgrade, health check, rollback-compatible deployment/restore drill with privacy controls.                                                                                     |

Use fake provider journeys in routine CI; final sandbox/staging journey explicitly records
which real services were used. Fake-only money/access/snapshot/provider checks never
satisfy integrated acceptance. EAS build/deployment occurs only in the actual release
workflow with user-approved environment/cost authority; this documentation does not
invoke or authorize paid cloud operations by itself.

## 7. Go/no-go and proposed parallel slices

No-go when any required module is unaccepted, migrations fail, API digests differ, the
deployed cookie/session flow fails, private data is public, an unresolved money intent is
treated as failed, or the Android artifact does not install. Monitor health/readiness,
outbox backlog, unknown payment/delivery outcomes, auth denial, and job failure using
bounded redacted metrics. The demo release has a named incident/recovery owner.

Rollback sequence: stop new money/print writes when required, restore last compatible
service/client artifacts, verify schema compatibility and outbox reconciliation, then
reopen writes. Never edit applied migrations or blindly replay payment callbacks/notification
intents. Database restoration requires controlled downtime, privacy tombstone replay and
dedup evidence reconciliation before reopening.

| Slice                                                  | Can overlap                                          | Hard prerequisite                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Deployment config validators/checklists/manifest tools | All module isolated implementation                   | Stable platform/auth contract.                                                        |
| Seed scenario adapters and CI fake journey             | Each source module becomes PROVIDER_READY            | No seed overwrite/direct cross-module repository bypass.                              |
| Staging migration and actual end-to-end seed           | Limited deployment checks may run per ready provider | Accepted migration sequence and real provider wiring.                                 |
| Backend release hand-off                               | Runs after backend integration                       | Accepted backend 03–10/extensions; exact API, migration and health/recovery evidence. |

Proposed waves: deployment/auth/config validation; deterministic seed/journey;
staging migration/monitoring; backend API/manifest and frontend hand-off; recovery/evidence/
owner go-no-go (five). Independent scaffolding does not declare an unfinished provider
accepted. SPEC/plan approval order remains after approved 09/10 contracts; release
execution waits accepted implementations.

## 8. Verification record required at acceptance

Record command, immutable commit, environment label, UTC timestamp, pass/fail,
redacted output location, and responsible owner. Quality gates are the exact existing
scripts in the team/cross-repository guides; include browser runtime evidence for
deployed cookies/refresh/CORS and Android install/session restoration. A skipped check
is marked incomplete, with the dependent release step blocked.

## 9. Separate Backend and Product Release Gates

Backend acceptance runs backend tests/migrations/real API scenarios only. Preserve
client/Web/Android requirements above as the joint frontend product-release checklist,
not tasks assigned to this backend team. The manifest records backendStatus and
frontendIntegrationStatus separately. A pending frontend cannot make a tested API
fail backend acceptance, and backend acceptance cannot imply completed Android/Web
release. Extend deterministic backend fixtures with services, several menu combos,
30% whole-contract deposit, appendix delta and zero/nonzero-expense final invoices.
