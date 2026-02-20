# Deployment Configuration

## Environment Variables
Ensure `.env` contains `DATABASE_URL` linking to the prod DB server.

## Docker
The repo contains `docker-compose.yml` and `docker-compose.prod.yml` orchestrating deployment targets including PostgreSQL and potentially NodeJS application container mappings. 

## Infrastructure
The backend connects directly to PostgreSQL and hosts the Google API OAuth endpoints for Drive Syncing. Port `3000` is default for backend processing while Frontend Vite serves UI static bundles routing internally.

## Web JS 
Whatsapp-web.js maintains session tokens locally. Directory `.wwebjs_auth` must not be cleared unexpectedly. 
