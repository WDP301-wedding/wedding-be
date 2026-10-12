# Accepted print file contract (RV-17)

Owner approval on 2026-10-12: two-sided portrait A5 PDF, trim 148 × 210 mm,
3 mm bleed, embedded Vietnamese fonts, raster images at least 300 dpi at their
placed size, generic QR at least 25 mm including its four-module quiet zone.
Media/BleedBox is 154 × 216 mm; TrimBox is inset 3 mm. No crop marks or seating
content in this original RV-17/RV-18 version. The RV-19 backend extension is
documented below; the original acceptance record remains unchanged.

The backend supplies a standard semantic layout, not client template geometry:
front: title, greeting, bride/groom fields and retained images; back: message,
frozen venue/date/shift/timeline, footer and the frozen generic invitation QR.
All supplied text fields and every retained image are rendered. Content that
cannot fit these two pages fails explicitly; it is never truncated or paginated
into extra sides. Colors are RGB; this approval does not specify CMYK/PDF-X or
a particular printer color profile.

Implemented endpoint: `GET /api/v1/bookings/{bookingId}/printable-revisions/{printableRevisionId}/file?disposition=inline|attachment`.
Default inline previews the same PDF bytes that attachment downloads. UUID
parameters and query are strict; no body/options/current-design fallback.
Bearer authentication requires Manager or owning FULL Couple with a confirmed
booking, using the existing Invitation access policy. Other actors receive
401/404; unknown/cross-booking revisions receive 404. The immutable revision is
captured only inside accepted print approval. Later design, timeline, publication,
source media or price changes do not alter it. Historical captured revisions
remain readable while that booking's existing access policy permits access.

Version `invitation-a5-v1` embeds packaged Be Vietnam Pro fonts and uses the
revision creation time for PDF metadata. Headers identify file SHA-256, printable
content digest and renderer version. Cache-Control is private/no-store. A renderer
upgrade must introduce a new version and preserve reproducibility expectations.
No signed object URL, original upload, private guest token or new charge is created.
Allowed CORS origins can read Content-Disposition, file/content digests and renderer
version through the explicit Access-Control-Expose-Headers response. This preserves
the existing origin allowlist and request-ID/Retry-After exposure; unapproved origins
are still rejected. Frontend owners can fetch the authenticated blob and inspect
these metadata headers without any frontend source changes in this repository.

Limits: eight retained PNG assets, 16 MiB total image bytes, 40 million pixels
per image, 12 MiB PDF, maximum generic QR payload 512 characters. Images use their
immutable derived rows and object checksums; no external URL fetch. QR is vector.
409 PRINT_SEATING_NOT_SUPPORTED / PRINTABLE_DIGEST_CONFLICT;
422 PRINT_CONTENT_OVERFLOW / PRINT_ASSET_LIMIT;
502/503 provider failure/unavailability for unavailable or corrupt retained images.
The canonical API describes the mounted runtime route; deployment and actual-file
evidence are recorded separately from configuration and offline verification.

## RV-19 extension — 2026-10-12

`invitation-a5-v2-seating` now renders the accepted real SPEC-07 snapshot: fixed
vector geometry/rotation, table labels, Group colors and a textual Vietnamese Group
legend. No named Guest list or check-in is required. Existing Seating-free files
continue to use `invitation-a5-v1` and reproduce their retained bytes.
Malformed/missing Seating content is 422. Illegible geometry or overflowing legends
are `PRINT_CONTENT_OVERFLOW` (422); tables are never rearranged. Current layout
retirement/headcount/exception eligibility is rechecked at print approval, while old
accepted files remain immutable. Rendering and download create no additional charge.

The historical `PRINT_SEATING_NOT_SUPPORTED` denial above applied to v1 before this
extension. The mounted endpoint now identifies the actual renderer in
`X-Renderer-Version`. See [SPEC-07 hand-off](seating-plan-w1-w5.md) and
[native/file evidence](../tasks/evidence/seating-plan-rv19-2026-10-12.md).
