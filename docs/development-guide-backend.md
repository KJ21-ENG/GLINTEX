# Development Guide - Backend

## Start
- `npm run dev:backend` (from repository root)

## Build/Run
- `npm run build:backend`
- `npm run start:backend`

## Environment
- `DATABASE_URL`, `SHADOW_DATABASE_URL`, `PORT`, `BARCODE_MATERIAL_CODE`
- Optional integrations: Google Drive and WhatsApp env vars

## DB and Migrations
- Prisma schema in `apps/backend/prisma/schema.prisma`
- Container startup runs `prisma migrate deploy`

