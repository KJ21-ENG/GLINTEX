# Printing (Label Designer)

GLINTEX does **silent printing** by calling a small **local** HTTP service running on the operator PC:

- Default URL: `http://localhost:9090`
- Endpoints: `GET /printers`, `POST /print`, `GET /health`, `GET /queue`
- Implementation: `apps/local-print-service/server.js`
- Desktop helper: `apps/print-client` (Tauri) can start/monitor the service.

## Common “No printers detected” causes

1. **Print service not running on the same PC as the browser**
   - The web app runs in the browser, so `localhost` means “this PC”.
   - Start the print client/service on every PC that needs to print.

2. **Browser blocks public-site → localhost (Chrome/Edge Private Network Access)**
   - If you open the app from a public host (example: `http://72.x.x.x:4174`) Chrome/Edge may block calls to `http://localhost:9090`.
   - Fix: serve the web app over **HTTPS** (recommended) and keep the local service running on `http://localhost:9090`.

## Quick checks

- Open `http://localhost:9090/health` in the same browser on the same PC.
- Open `http://localhost:9090/printers` and confirm you see a non-empty `printers` array.
- In Label Designer, use the refresh button next to “Target printer” and watch the status line.

## Configuration

- Frontend can override the service base URL via `VITE_PRINT_SERVICE_URL` (default stays `http://localhost:9090`).

