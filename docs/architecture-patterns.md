# Architecture Patterns

## frontend (web)
- Pattern: SPA with route-level feature pages and centralized app shell.
- Key shape: `router -> ProtectedAppLayout -> page modules -> reusable components`.
- State: Context-based (`AuthContext`, `InventoryContext`) and API-driven data refresh.

## backend (backend)
- Pattern: Modular monolithic Express API.
- Key shape: `server -> app middleware -> routes/index + routes/v2 -> Prisma -> Postgres`.
- Characteristics: permission-gated endpoints, process-specific inventory domain flows, WhatsApp + PDF + backup side capabilities.

## local-print-service (backend helper)
- Pattern: Edge print gateway microservice.
- Key shape: `HTTP JSON API -> queued print jobs -> OS print commands`.
- Characteristics: printer discovery, print queue throttling, no persistent DB.

## print-client (desktop)
- Pattern: Tauri desktop supervisor UI.
- Key shape: `React UI -> localhost:9090 health/queue/printers -> Tauri invoke commands`.
- Characteristics: desktop control plane for local print service lifecycle.

