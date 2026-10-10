# Windows label printing contract

`buildPrintableArtifact` in the shared frontend produces a version 2 artifact: self-contained
HTML pages laid out in millimetres, the stylesheet they use, and the font files they need as
data URIs. The designer preview, the print preview and the hidden print window all render
the same page markup; nothing is re-laid out after the artifact is built. Text is emitted as
explicitly positioned lines (the layout engine measures with the same font faces), barcodes
and QR codes are inline SVG rectangles whose module width is a whole number of printer dots.

Columns repeat one transaction across a row by default (`columnMode: repeat`), or fill with
consecutive labels (`sequence`). Copies repeat the row; a batch advances to a new row for each
transaction. The driver receives copies=1 because all pages are materialised. Page height is
label length plus the top margin; the vertical die-cut gap is a printer/media feed setting
recorded in the snapshot, not extra height.

`validateArtifact` accepts version 2 (inline HTML pages, inline CSS, woff2 data-URI fonts;
no scripts, frames, forms, external references or event handlers; 2 MB per page, 20 MB per
job, 100 pages) and still accepts version 1 PNG artifacts so retained jobs from older builds
can be reprinted. `buildDocument` assembles the final document for either version.

The hidden print window loads the document through the private `glintex-print://` scheme on
the print partition (an in-memory response with a strict Content-Security-Policy header),
waits for fonts and images, then calls `webContents.print` with microns page size, zero
margins, 100 % scale, the explicit device name and the profile dpi. `printToPDF` uses inches.

Templates are stored per stage under `v2:<stage>`; a desktop build that still runs the
previous renderer keeps reading the untouched legacy `<stage>` rows.

## Durable job semantics

Unchanged: queue records are atomically replaced and synced before entering `submitting`;
crash recovery never submits automatically; driver success means submitted to Windows, not
paper printed; reprint creates a new job referencing the previous one with identical pages.
Retention limits: 100 records, 100 MB; uncertain records are never pruned.

## Software validation

`node --test apps/desktop/test/print*.test.cjs` covers geometry, validation (including
rejected active content), the driver contract with mocked windows, durable queue semantics
and legacy acceptance. `electron apps/desktop/scripts/print-integration.cjs <dir>` runs every
stage design through the real printer module in Chromium with the Windows submission replaced
by printToPDF and a page capture. `electron apps/desktop/scripts/visual-runner.cjs` renders the
designer and workstation panel. Physical alignment on TSC TE244 media is an operator step.
