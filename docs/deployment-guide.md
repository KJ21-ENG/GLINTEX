# Deployment Guide

## Web + API + DB Stack
1. Configure environment variables (`.env` and compose overrides as needed)
2. Start services: `docker compose up -d`
3. Verify backend migrations and readiness: `docker compose logs -f backend`
4. Frontend served via Nginx image on mapped port.

## Data Safety
- Backups are available through backend backup routes and backup folder mount.
- Reset database only when intended: `docker compose down -v`.

## Desktop Print Path
- Local print service runs on workstation host (`9090`).
- Print client distributed as Tauri desktop build (release workflow).

