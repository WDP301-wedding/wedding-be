# Specification: Release Demo

- Status: **Approved specification — module plan and implementation acceptance pending**
- Approved: 2026-10-06 by the project owner (approval record: baseline Section 21.9)
- Module ID: `release-demo` (`SPEC-11`)
- Contract baseline: `WEDDING-CONTRACT-1@1.1.0`
- Inherited baseline: `WEDDING-CONTRACT-1@1.0.0` (historical contract)
- Accepted amendment: baseline Section 21
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
collaboration, mutual approval, proven deposit/access promotion, media/invitation,
households/RSVP, seating invalidation/reconfirmation, print quote/charge, staff
multi-arrival check-in, notifications, and analytics. The generic QR must remain
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

| Scenario                        | Required observation                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Restricted consultation         | One invitation/account/access; restricted Web timeline works; media/guest/seating/print denied.                                |
| Timeline/deposit                | Current mutual approval, stale revision rejected, verified sandbox/manual deposit confirms and promotes same identity.         |
| Private media/public invitation | Original private, approved derived asset public, one generic QR without household/RSVP/check-in scope.                         |
| Guests/headcount                | Default/custom stable groups, import/RSVP, higher then lower plan sequence; no headcount rollback.                             |
| Seating/print                   | Inclusive capacity, exception audit, invalidation blocks new print, exact printable/quote/charge snapshot, no recipient names. |
| Attendance                      | Duplicate names disambiguated, separate arrivals accumulate, over-expected succeeds, correction history preserved.             |
| Notifications                   | Real outbox, duplicate dedup, deadline revision/cancel behavior, credential-safe delivery, completion through booking port.    |
| Analytics                       | Known expected/actual, payments/refunds/credit, quotes excluded, historical hall/menu facts and source freshness.              |
| Cross-client                    | Couple Web/App and Manager/Staff Web use the same implemented API digest and backend denial semantics.                         |
| Recovery                        | Migration upgrade, health check, rollback-compatible deployment/restore drill with privacy controls.                           |

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

| Slice                                                  | Can overlap                                          | Hard prerequisite                                                              |
| ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Deployment config validators/checklists/manifest tools | All module isolated implementation                   | Stable platform/auth contract.                                                 |
| Seed scenario adapters and CI fake journey             | Each source module becomes PROVIDER_READY            | No seed overwrite/direct cross-module repository bypass.                       |
| Staging migration and actual end-to-end seed           | Limited deployment checks may run per ready provider | Accepted migration sequence and real provider wiring.                          |
| Complete Android/demo release/go-live                  | Runs last                                            | Accepted 03–10, actual cookies/health/recovery, approved artifact/environment. |

Proposed waves: deployment/auth/config validation; deterministic seed/journey;
staging migration/monitoring; Android artifact/cross-client checks; recovery/evidence/
owner go-no-go (five). Independent scaffolding does not declare an unfinished provider
accepted. SPEC/plan approval order remains after approved 09/10 contracts; release
execution waits accepted implementations.

## 8. Verification record required at acceptance

Record command, immutable commit, environment label, UTC timestamp, pass/fail,
redacted output location, and responsible owner. Quality gates are the exact existing
scripts in the team/cross-repository guides; include browser runtime evidence for
deployed cookies/refresh/CORS and Android install/session restoration. A skipped check
is marked incomplete, with the dependent release step blocked.
