# Development Instructions

## Prerequisites
- Node.js 20+
- npm
- Docker + Docker Compose (for Postgres and service stack)

## Common Commands (Workspace Root)
- Install dependencies: `npm install`
- Backend dev: `npm run dev:backend`
- Frontend dev: `npm run dev:frontend`
- Build frontend: `npm run build:frontend`
- Build backend: `npm run build:backend`

## Infrastructure
- Start stack: `docker compose up -d`
- Follow backend logs: `docker compose logs -f backend`
- Reset DB volumes: `docker compose down -v`

## Tauri Print Client
- From `apps/print-client`: `npm install`, `npm run dev`, `npm run tauri`

