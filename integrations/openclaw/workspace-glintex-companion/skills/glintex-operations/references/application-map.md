# Application map

| Area | UI route | `glintex_read` resource | Canonical URL | Availability |
| --- | --- | --- | --- | --- |
| Masters | `/app/masters` | `reference` | `https://app.glintex.in/app/masters` | Live read |
| Issue history | `/app/issue` | `issues` with exact `process` | `https://app.glintex.in/app/issue` | Live bounded read |
| Receive history | `/app/receive` | `receives` with exact `process` | `https://app.glintex.in/app/receive` | Live bounded read |
| On-machine work | `/app/stock` | `on_machine` with exact `process` | `https://app.glintex.in/app/stock` | Live bounded read |
| Finished-stage stock | `/app/stock` | `stock` with `holo` or `coning` | `https://app.glintex.in/app/stock` | Live app-calculated read |
| Production report | `/app/reports` | `production` | `https://app.glintex.in/app/reports` | Live read, max 93 days |
| Barcode lineage | `/app/reports` | `barcode_history` with exact barcode | `https://app.glintex.in/app/reports` | Live exact read |
| Contractor settlements | `/app/contractor-payments` | `contractor_settlements` | `https://app.glintex.in/app/contractor-payments` | Live bounded read |

The phase-one adapter intentionally omits inbound stock detail, dispatch lists,
opening-stock history, settings, documents, PDFs, exports, writes, attachments,
and every admin route. Never claim an omitted or UI-only operation was performed.
