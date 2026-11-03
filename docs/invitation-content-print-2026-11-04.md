# Content-tab PDF and Seating download correction

The owner's support IDs `066ede92-daf6-43fe-9c2c-b38c2dd68e9b` and
`8c6e7376-9667-491d-9b5f-12d3fca51c7e` identify HTTP 422
`PRINT_CONTENT_OVERFLOW`, not a storage outage or HTTP 500. The old renderer put
the approved timeline and Seating into the remaining area on the second A5 face.
Its PDFKit layout also differed from the Content tab.

Owner-approved replacement: print each reading page from Nội dung thiệp; give
Seating its own A5 page. The backend uses the web's exact component/CSS artifact
offline, including the cover, theme, photos, text and public Group/table SVG. It
never loads a current guest publication as a substitute for retained content.
No live frontend request, bearer token, external image URL or browser JavaScript
is needed to render. Both HTTP reads reauthorize the caller before returning bytes.

New captures retain `renderer: {version: "invitation-content-v1", digest}` inside
their immutable JSON/content digest. Old snapshots without that marker keep their
existing PDFKit behavior. Existing consent, costs, appendices and order history are
not rewritten. An outstanding old preview must be regenerated from saved designs;
reading a file never creates consent, an order or an extra charge.

`assets/invitation-print/source.lock.json` pins the source web commit and manifest.
Each artifact directory is named by its JavaScript/CSS hash. `npm run print:check`
checks those bytes and the locked browser/PDF runtime versions. Keep released hash
directories and version-specific rendering paths when updating either UI or runtime.
New rendering uses the locked Playwright Chromium revision installed by Docker/CI;
PDF metadata/ID derive from captured identity and date for reproducible bytes.

Limits remain eight validated retained PNGs/16 MiB image bytes/12 MiB PDF, with at
most 40 megapixels of decoded images combined for the browser path, and at
most 24 A5 pages. A single browser render runs at a time, with a bounded queue and
wait deadline; capacity exhaustion returns `PRINT_RENDERER_BUSY` (503). Background
network access and JavaScript are disabled. Published snapshots retain their generic
QR; unpublished designs have none. No schema/data migration is required.

The frontend also blocks preview for a selected design with unsaved edits and
preserves the server's error code/message instead of replacing it with a generic
Vietnamese download error. The Manager continues to receive the same frozen PDF
through the existing authorized endpoint.
