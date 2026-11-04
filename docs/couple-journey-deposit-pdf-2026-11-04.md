# Couple journey, deposit information and contract PDF

Date: 2026-11-04. Scope: wedding-web and wedding-be. No automated tests, database writes, payments or deployment performed.

## Current progress

The existing proposal read includes optional `commercialProgress` derived from the current contract, approvals and latest customer selection. The overview and its next action use the current timeline and contract state, rather than stale approval flags from the booking list. Existing timeline/contract/deposit/billing realtime events re-read this authoritative snapshot. Withdrawal or replacement can move the journey back; payment readiness is never inferred solely from a past approval.

## Deposit information

Optional `depositTerms` exposes the active hold's real expiry, unresolved deposit intent, cancellation cutoff calculated using the event's Vietnam-local shift start, and current cancellation/refund processing notices. A hold expiry is not a VNPay transaction deadline. No automatic entitlement, refund percentage or new cancellation policy was invented. Negotiated refund conditions are not present in the existing immutable contract schema and must not be fabricated by the UI.

The additional reads are bounded relations on the existing proposal query: one active slot hold, one latest selection and the current contract approvals. No per-row query loop or database migration is introduced.

## PDF

The payment card opens an authenticated, in-page PDF dialog. Blob URLs are revoked on close; no bearer token enters a public URL. The PDF read accepts optional `layout=retained|readable`, default `retained`. `readable` produces a clearly marked presentation copy from the exact stored revision, with A4 layout, Vietnamese embedded fonts, itemized prices, timeline, approvals and page numbers. It never rewrites retained approved PDF bytes, digests, contract documents or approvals. The original retained PDF remains downloadable for reconciliation. Newly retained PDFs use the improved renderer upon normal approval.

No new environment variable or migration is required. Both BE and wedding-web must be released for the new progress fields, deposit details and readable PDF to be available. The web retains a conservative fallback when a server lacks the new fields.

Validation: scoped ESLint and full TypeScript checks passed for wedding-be and wedding-web. The web OpenAPI artifact check passed. These checks are separate from runtime evidence. A synthetic, local-only PDF was exported and visually inspected; it is not a customer contract or proof of deployed UI behavior. No test suite was run.
