# Deployment Configuration

## Environment Variables
Ensure `.env` contains `DATABASE_URL` linking to the prod DB server.

## Docker
The repo contains `docker-compose.yml` and `docker-compose.prod.yml` orchestrating deployment targets including PostgreSQL and potentially NodeJS application container mappings. 

## Infrastructure
The backend connects directly to PostgreSQL and hosts the Google API OAuth endpoints for Drive Syncing. Port `3000` is default for backend processing while Frontend Vite serves UI static bundles routing internally.

## Notifications
Telegram is the messaging integration. WhatsApp and its Chromium runtime were retired on 2026-10-22.
Existing notification templates and delivery/document history remain in their original database tables.
Legacy template API aliases serve Telegram configuration for existing desktop clients; retired WhatsApp connection and sending controls return HTTP 410.
