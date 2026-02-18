# State Management Patterns - Print Client

## Pattern Summary
- Single-screen local state via React `useState`.
- Polling-based sync (`setInterval`) for service status and queue.
- No global store; no persisted state beyond OS-level autostart setting controlled via Tauri plugin.

## Key State Fields
- `serverStatus`, `autostart`, `printers`, `queue`, `errorMsg`, `isLoading`

