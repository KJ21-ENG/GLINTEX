# State Management Patterns - Frontend

## Global State Containers
- `AuthContext` for auth/session and permission hydration.
- `InventoryContext` for bootstrap/module-loaded datasets and UI config state.

## Pattern Summary
- Context + hooks (`useAuth`, `useInventory`) over Redux-like external store.
- Data refresh model: bootstrap load + per-module lazy loading + targeted refresh functions.
- Local component state for transient view concerns.
- Unauthorized flow coordinated via browser event `glintex:auth:unauthorized`.

