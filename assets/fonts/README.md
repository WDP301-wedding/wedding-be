# Contract PDF fonts

Full static Be Vietnam Pro fonts are bundled for offline backend PDF rendering,
including Latin and Vietnamese glyphs in one font. Do not substitute subset web
fonts or fetch fonts during a request.

Source: [Google Fonts Be Vietnam Pro](https://github.com/google/fonts/tree/main/ofl/bevietnampro).
License: [OFL.txt](./OFL.txt), retained with both font files.

Downloaded 2026-10-11. The checked-in bytes are pinned by Git and these SHA-256 values:

| File                      | SHA-256                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| BeVietnamPro-Regular.ttf  | cd1ef6e9d7db28ad5cdb88a65ccbe693870e60d340b791f349d248342b4fe4c3 |
| BeVietnamPro-SemiBold.ttf | bd8e27eb02720b9d91e59e4f10a90878643219f25ce6a8d9a4f06a8a88d3bb71 |

PDFKit supports embedded TTF and pagination:
[fonts/text](https://pdfkit.org/docs/text.html),
[buffered pages](https://pdfkit.org/docs/getting_started.html).
