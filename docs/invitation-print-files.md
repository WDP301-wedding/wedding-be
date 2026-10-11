# Accepted print file contract (RV-17)

Owner approval on 2026-10-12: two-sided portrait A5 PDF, trim 148 × 210 mm,
3 mm bleed, embedded Vietnamese fonts, raster images at least 300 dpi at their
placed size, generic QR at least 25 mm including its four-module quiet zone.
Media/BleedBox is 154 × 216 mm; TrimBox is inset 3 mm. No crop marks or seating
content in this version. Seating remains RV-19.

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

Limits: eight retained PNG assets, 16 MiB total image bytes, 40 million pixels
per image, 12 MiB PDF, maximum generic QR payload 512 characters. Images use their
immutable derived rows and object checksums; no external URL fetch. QR is vector.
409 PRINT_SEATING_NOT_SUPPORTED / PRINTABLE_DIGEST_CONFLICT;
422 PRINT_CONTENT_OVERFLOW / PRINT_ASSET_LIMIT;
502/503 provider failure/unavailability for unavailable or corrupt retained images.
The canonical API describes the mounted runtime route; deployment and actual-file
evidence are recorded separately from configuration and offline verification.
