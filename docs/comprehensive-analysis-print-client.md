# Comprehensive Analysis - Print Client

- Type: desktop control client (Tauri)
- UI: React app polling local print service on `localhost:9090`
- Native actions: invoke Tauri commands (`stop_server`, `force_start_service`, `stop_service_app`)
- Packaging: cross-platform release via GitHub Actions + tauri-action
- Purpose: operational desktop companion for print service uptime and visibility

