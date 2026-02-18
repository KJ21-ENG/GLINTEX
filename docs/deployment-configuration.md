# Deployment Configuration

## Containers and Services
- PostgreSQL (`postgres:17-alpine`) with seed/init SQL mount
- Backend container (`apps/backend/Dockerfile`) with Chromium + Prisma migrate on startup
- Frontend container (`apps/frontend/Dockerfile`) built and served by Nginx

## Compose Variants
- `docker-compose.yml`: default local stack
- `docker-compose.override.yml`: frontend-dev and backend bind mounts
- `docker-compose.prod.yml`: production overrides

## CI/CD
- GitHub workflow `.github/workflows/release.yml` builds Tauri print-client releases for macOS and Windows.

