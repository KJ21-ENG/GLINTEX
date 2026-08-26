#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/glintex-staging}"
cd "$APP_DIR"

COMPOSE=(docker compose --env-file .env.staging -p glintex-staging -f docker-compose.staging.yml)
EXPECTED_DB="$(sed -n 's/^STAGING_DB_NAME=//p' .env.staging | tail -1)"
test -n "$EXPECTED_DB"

IDENTITY="$(${COMPOSE[@]} exec -T db sh -c 'psql -At -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select current_database(),current_user,inet_server_addr(),inet_server_port();"')"
ACTUAL_DB="${IDENTITY%%|*}"
test "$ACTUAL_DB" = "$EXPECTED_DB"
printf 'pre_migration_identity=%s\n' "$IDENTITY"

${COMPOSE[@]} run --rm --no-deps backend npx prisma migrate deploy --schema prisma/schema.prisma

IDENTITY_AFTER="$(${COMPOSE[@]} exec -T db sh -c 'psql -At -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select current_database(),current_user,inet_server_addr(),inet_server_port();"')"
test "${IDENTITY_AFTER%%|*}" = "$EXPECTED_DB"
printf 'post_migration_identity=%s\n' "$IDENTITY_AFTER"
