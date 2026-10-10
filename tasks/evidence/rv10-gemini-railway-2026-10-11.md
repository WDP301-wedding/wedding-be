# RV-10 Gemini Railway provider test: 2026-10-11

Status: configuration and Google transport verified; the single authorized live
generation returned JPEG and failed the deployed PNG-only adapter. RV-10 and RV-11
remain open. No full Booking, Storage asset or design revision acceptance is claimed.

## Authorization and target

The owner authorized exactly one generation call with a maximum budget of USD 0.10,
no private data in the prompt and no retry after a timeout. Read-only preflight found
no accounts/roles or Bookings in the target database. The test therefore exercised
the production provider adapter inside the actual Railway container, without
creating a synthetic confirmed Booking or payment settlement.

- Railway service: `0f70d648-8c59-48bd-84f3-29a86d2e2d38` (`wedding-be`).
- Environment: `08a2899c-b0d6-4200-a505-604965a4b3fc` (`production`, owner-confirmed developer test environment).
- Deployment: `54652932-a203-4af1-b092-316b3c348c7a`, status `SUCCESS`.
- Source: `25dcbabedfeaad55480e9d9d3023fea77d226e9f`, merged PR #23.
- Provider/model: Gemini / `gemini-3.1-flash-lite-image`.
- SDK: locked `@google/genai@2.24.0`; Node 24 runtime.
- Test correlation: `b2a963f3-a731-49cd-8866-c82a453efe7b`.
- Request: generic ivory/pink watercolor flowers, no people, text or personal data;
  aspect ratio `3:4`, one candidate, IMAGE only, minimal thinking, no thought output.
- Controls: 3,000 maximum output tokens, 10-second transport timeout, one SDK attempt,
  local/remote one-shot guards, no automatic retries.

Only `AI_IMAGE_PROVIDER`, `GEMINI_API_KEY` and `GEMINI_IMAGE_MODEL` were added to the
existing Railway variables. Other runtime settings and Storage credentials were
preserved. Model metadata and `countTokens` worked from Railway; the private
`wedding-media` bucket was accessible. Temporary SSH access was removed after the
test; no credentials, raw images or private response bodies are committed here.

## Actual provider result

At `2026-10-10T20:33:41.256Z` (2026-10-11 in Asia/Saigon), Google responded in
3,172 ms with one candidate, finish reason `STOP`, and one non-thought image part
whose MIME type was **`image/jpeg`**. Response ID: `JaHKat6tJcvp-8YPuty1mQs`.
The deployed `GeminiAiImageProvider` rejected that format with
`AiImageInvalidOutputError`, code `AI_IMAGE_INVALID_OUTPUT`, status 502. The response
arrived; this attempt does not have an unknown provider effect. Generation was not
called again. No image was uploaded and no database records were written.

Reported usage: 32 input tokens, 1,479 candidate output tokens, 1,511 total tokens;
the IMAGE token detail was 1,120. Using USD 0.25/million input tokens and conservatively
USD 30/million for all output tokens gives USD **0.044378**. The preflight token
upper bound was USD 0.090008 at the same rates. These are token-price estimates,
not a Google billing receipt. See [Google's pricing](https://ai.google.dev/gemini-api/docs/pricing).

The injected client added budget/thinking controls for this explicitly authorized
provider-only test; these are not a claim that production business requests already
have an equivalent monetary cap.

## Offline remediation and remaining acceptance

The pinned SDK does not expose the new image response format on its
`GenerateContentConfig`; `ImageConfig.outputMimeType` is explicitly unsupported
for Gemini API in [the SDK reference](https://googleapis.github.io/js-genai/release_docs/interfaces/types.ImageConfig.html).
The adapter now accepts a bounded, decoder-verified JPEG and converts it to PNG
using existing `sharp@0.35.5`. It preserves the PNG application/Storage contract,
rejects unsupported formats and MIME mismatches, uses warning-sensitive full
decoding, caps dimensions/pixels/time, strips metadata and checks the byte cap again
after PNG encoding. Existing PNG validation and downstream full decoding remain.

Offline regression uses locally generated JPEG bytes, not the live image (which was
not retained). It covers readable headers with truncated pixels, MIME spoofing,
dimension/pixel overflow, PNG expansion beyond the byte cap and one provider call.
No paid request verifies the corrected adapter yet.

Remaining work requires a separate bounded authorization for any new paid call:
real eligible test account/Booking, application endpoint/idempotency, private Storage
upload and signed read, usable design revision, and operator recovery rehearsal.
Configuration, HTTP health and this provider-only response cannot close RV-10/11.
