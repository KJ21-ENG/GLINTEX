# API Contracts - Frontend (Consumer Surface)

Frontend does not expose server APIs. It consumes backend APIs via `src/api/client.js` and `src/api/v2.js`.

## Base URL Resolution
- `VITE_API_BASE` env override.
- Fallback: `http(s)://<window.hostname>:4000`.

## Consumed Endpoint Groups
- Auth: `/api/auth/*`
- Admin Users/Roles: `/api/admin/*`
- Masters: `/api/items`, `/api/yarns`, `/api/cuts`, `/api/twists`, `/api/firms`, `/api/suppliers`, `/api/machines`, `/api/operators`, `/api/bobbins`, `/api/roll_types`, `/api/cone_types`, `/api/wrappers`, `/api/boxes`
- Inbound/Issue/Receive/Open Stock: `/api/module/*`, `/api/issue_*`, `/api/receive_*`, `/api/opening_stock/*`
- Dispatch/Reports/Box Transfer/Boiler/Documents: `/api/dispatch*`, `/api/reports/*`, `/api/box-transfer*`, `/api/boiler/*`, `/api/documents/*`
- Performance V2 read APIs: `/api/v2/issue/*`, `/api/v2/receive/*`, `/api/v2/opening-stock/*`, `/api/v2/on-machine/*`, `/api/v2/stock/*`

## Auth Contract Behavior
- Requests send credentials (`credentials: include`).
- On HTTP 401, app dispatches browser event: `glintex:auth:unauthorized`.

