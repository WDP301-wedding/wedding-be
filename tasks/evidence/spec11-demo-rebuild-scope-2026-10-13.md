# SPEC-11 owner-selected synthetic demo recovery

Date: 2026-10-13, Asia/Saigon. This is an additive scope/correction record;
prior immutable manifests and runtime receipts are preserved unchanged.

The project owner explicitly selected:

> tôi chọn phương án **staging/demo hiện tại chỉ chứa dữ liệu thử.** Có thể phục hồi bằng cách dựng lại database từ migration và seed, thay cho yêu cầu giữ backup 30 ngày.

The selected target remains the isolated Railway `spec11-staging` environment and
its dedicated PostgreSQL. Recovery owner: Lê Bá Bách. No real customer, real-money
or shared/production data is included. Transient synthetic data may be lost during
incident recovery. No live database was reset and no retained history was deleted
to apply this amendment.

## Implementation and verification

The release deployment schema accepts an explicit `REBUILD_SYNTHETIC_DEMO` mode
only with `syntheticDataOnly: true`, `recoveryArtifact: MIGRATIONS_AND_SEED`, null
backup retention and false backup/erasure-restore claims. The environment validator
requires staging for that mode; production is rejected. Existing protected backup
plans retain strict 30-day/encryption/erasure requirements. Existing HTTPS, CORS,
auth, provider, worker, migration, exact-source evidence and owner-review gates
remain enforced. No quality threshold or historical evidence was weakened.

Regression proof: the two new tests fail before implementing the scope change,
then all **18 release-policy tests pass**. They verify the explicit demo plan,
legacy protected-plan compatibility, invalid/mixed recovery claims and production
rejection. Configured staging validates with either supported recovery plan.
The production/staging condition was deliberately inverted: the regression suite
failed, then the original source was restored exactly. The release-policy and seed
suite passes **25 tests**, with 100% release-module statement/branch/function/line
coverage. Typecheck, lint, formatting and build pass on the updated candidate;
Linux CI remains the exact-commit quality record.

The manifest now publishes the selected recovery mode and
`releaseScope: SYNTHETIC_STAGING_DEMO` explicitly. It does not convert a demo
decision into production readiness or turn old pending receipts into PASS.

## REL-W3 closure

[Prior staging checkpoint](spec11-staging-checkpoint-2026-10-13.md) and its immutable
[JSON evidence](spec11-staging-checkpoint-2026-10-13.json) prove:

- 60 unchanged migrations from empty and populated upgrade/replay; runtime readiness,
  controlled local DB outage/recovery and graceful restart.
- Dedicated staging deployment and both deterministic native seed journeys through
  contract/deposit, Group seating/PDF, contracted print, Staff journal and invoices.
- Idempotent replay and refusal to overwrite changed facts.
- An additional authenticated encrypted restore/native erasure rehearsal, retained
  ledger and migration readiness. This evidence is preserved, even though ongoing
  backup custody is outside the selected demo scope.

These are separate empty-deployment, local-recovery and persistent-staging journey
observations. They are not presented as a reset/rebuild of the current live demo DB.
The [operator procedure](../../docs/spec11-recovery-operator.md#selected-demo-rebuild-procedure)
requires a new isolated database and new private checkpoint, explicit target fencing,
native migrations/seed, auth/money/privacy/readiness verification and owner review
before reopening. Provider sandbox evidence is retained externally and must not be
fabricated or replayed into new fixture money. The two-email budget is exhausted;
worker and FCM remain off for any rebuild until separately scoped.

**REL-W3 is complete for this owner-approved synthetic staging/demo scope.**
Live FCM remains deferred to app integration as separately approved. RV-21 still
requires review of the exact feature/evidence manifest before sequential REL-W4/5
acceptance. The backup-method choice is no longer an open task or release blocker.
Production/historical-data recovery requires a new protected operational scope.
