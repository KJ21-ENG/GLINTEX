# API Contracts - Backend

Base path: `/api` (plus `/api/v2` for performance read endpoints).

## Auth and Session
- `GET /api/auth/status`
- `POST /api/auth/login`
- `POST /api/auth/bootstrap`
- `GET /api/auth/me`
- `POST /api/auth/logout`

## Core Inventory Domain
- Inbound and lot orchestration (`/api/lots`, `/api/inbound*`, `/api/module/*`, `/api/sequence/*`)
- Cutter/Holo/Coning issue flows (`/api/issue_to_cutter_machine`, `/api/issue_to_holo_machine`, `/api/issue_to_coning_machine`)
- Cutter/Holo/Coning receive flows (`/api/receive_from_cutter_machine/*`, `/api/receive_from_holo_machine/*`, `/api/receive_from_coning_machine/*`)
- Opening stock flows (`/api/opening_stock/*`)
- Take-back ledger (`/api/issue_take_backs`, `*/take_back`, `*/reverse`)

## Operations and Support
- Dispatch (`/api/dispatch*`)
- Reports and summaries (`/api/reports/*`, `/api/summary/:stage/:type`, `/api/summary/:stage/:type/send`)
- Box transfer (`/api/box-transfer*`)
- Boiler steaming (`/api/boiler/*`)
- Document send/history (`/api/documents/send`, `/api/documents/history`)
- WhatsApp integration (`/api/whatsapp/*`)
- Backups + disk + Google Drive (`/api/backups*`, `/api/disk-usage`, `/api/google-drive/*`)

## V2 Endpoints (Read/Export)
- Issue tracking: `/api/v2/issue/:process/tracking`, facets/export variants
- Receive history: `/api/v2/receive/:process/history`, facets/export variants
- Opening stock history: `/api/v2/opening-stock/:stage/history`, export
- On-machine: `/api/v2/on-machine/:process`
- Stock: `/api/v2/stock/:process/lots`, `/lot-rows`, `/barcode-lot-keys`
- Rollout parity verification endpoint reference: `/api/v2/admin/projections/verify?processes=<process>`

## v2 Rollout Contract Notes
- v2 exposure is controlled by frontend flags (`VITE_FF_V2_*`).
- Rollout should be staged by process order: cutter -> holo -> coning.
- Rollback path is flag-based (disable affected `VITE_FF_V2_*`).
- See `docs/PERFORMANCE_V2_ROLLOUT.md` and `docs/v2-rollout-status.md`.

## Security Contract
- Route guards use `requireAuth`, `requireRole`, `requirePermission`, `requireEditPermission`, `requireDeletePermission`.
- Permission levels are numeric (`ACCESS_LEVELS`) and process-specific (e.g., `issue.cutter`, `receive.holo`).
