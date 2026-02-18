# Comprehensive Analysis - Frontend

- Type: web SPA
- Primary path: `apps/frontend/src`
- Entry: `src/main.jsx`, routed via `src/app/router.jsx`
- Permissions enforced at route level using `PermissionGate` and permission keys aligned to backend.
- API surface consumed from `src/api/client.js` and `src/api/v2.js`.
- Context-driven state orchestration (`AuthContext`, `InventoryContext`).
- Feature-flag support through Vite env vars (V2 stock/issue/receive/opening/on-machine toggles).

