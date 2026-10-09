# ADR-009: Preserve client billing intents and authoritative status

## Status

Technical implementation of SPEC-04 and PB-W7, 2026-10-09. The published W6 API,
monetary policies and active baseline remain unchanged. Android runtime review is
deferred by the project owner's explicit choice; owner acceptance remains W8.

## Context

A request may lose its response after money was committed. Reloading billing can
then return a different revision or timeline, or zero outstanding. A new UUID or
the newly loaded revision would identify a different command. Persisting the whole
manual/refund draft would retain receipt and reason text unnecessarily.

Returning from VNPay, opening Android Custom Tabs, or reading URL response codes
does not prove settlement. An attempt remembered through route parameters must
be checked before another collection is enabled.

## Decision

- Use the generated DTOs pinned to W6 source and digest. Every operation passes
  through the existing identity session and generated HTTP client. Clients display
  returned amounts; approval, eligibility and arithmetic stay with backend owners.
- Journal the actor/scope and flat public body as SHA-256 hashes plus a UUID key.
  Preserve only technical replay metadata: original billing revision or timeline
  revision UUID. Web uses sessionStorage; Android uses existing SecureStore and
  expo-crypto. Never store access tokens, amounts, receipt text or reasons in this
  journal. An unreadable/corrupt journal fails closed before a money request.
- Reconstruct the original public body using that metadata, then verify its hash
  before submission. Manual/refund users re-enter the identical evidence after
  reload. A changed draft cannot replace an unresolved command. Account identity,
  operation and booking isolate command scopes independently of token rotation.
- Keep the key across network/timeout/malformed responses, 5xx and canonical
  REQUEST_IN_PROGRESS. Success or a definitive 4xx releases it. No automatic
  monetary retries or client-side approval decisions are introduced.
- Recover a checkout command even after the current outstanding becomes zero.
  Hide the unavailable original amount instead of substituting the fresh amount;
  read the saved attempt's authoritative status to obtain its amount and outcome.
- Restore only booking/attempt IDs from navigation. Ignore provider return fields.
  A failed status read blocks further collection until a successful authorized read.
  UNKNOWN stays unresolved after expiry; it hides the provider continuation link.
  Verified settlement and downstream application completion remain separate.
- Preserve per-booking privacy on refresh and denial. Public Web permits the
  contract-authorized restricted deposit flow. Android retains baseline Section
  8.3's FULL grant plus CONFIRMED/COMPLETED booking gate and refers prospects to Web.
  Keep history reads at the returned billing revision; Android holds one page.

## Consequences and proof

The web journal survives reload within its tab session, not a closed tab or cleared
browser storage. SecureStore persists across ordinary app restarts. These are client
conveniences; durable claims, source uniqueness and unresolved attempts remain
backend protections. Concurrent tabs/processes still depend on those owner checks.

SHA-256 body/scope privacy, stable-key replay, account separation, changed-body
rejection, corrupt storage, post-commit revision recovery, zero-outstanding recovery,
restored-attempt status failures, denied access and pagination are tested.
Temporarily reversing original/current metadata precedence causes the expected
recovery test to fail; original bytes are restored before final gates.

[W7 evidence](../../tasks/evidence/payments-billing.md#w7-generated-clients-and-billing-experiences)
records all client gates and browser inspection. It explicitly separates controlled
HTTP fixtures from W8 real-owner/provider/database acceptance and records the
remaining Android runtime review.
