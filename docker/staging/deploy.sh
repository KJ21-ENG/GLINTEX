#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SHA="${1:?expected release SHA is required}"
APP_DIR="${APP_DIR:-/var/www/glintex-staging}"
cd "$APP_DIR"

test -f .env.staging
PREVIOUS_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
COMPOSE=(docker compose --env-file .env.staging -p glintex-staging -f docker-compose.staging.yml)
BACKUP_PATH=""

rollback_source() {
  rc=$?
  if test "$rc" -ne 0 && test -n "$PREVIOUS_SHA"; then
    printf 'deploy_failed_rc=%s previous_sha=%s backup=%s\n' "$rc" "$PREVIOUS_SHA" "$BACKUP_PATH" >&2
    git checkout --force "$PREVIOUS_SHA"
    export GLINTEX_DEPLOY_SHA="$PREVIOUS_SHA"
    ${COMPOSE[@]} build backend frontend || true
    ${COMPOSE[@]} up -d db backend frontend || true
  fi
  exit "$rc"
}
trap rollback_source EXIT

git fetch --prune origin release/dispatch-v2
test "$(git rev-parse FETCH_HEAD)" = "$EXPECTED_SHA"
git checkout --force "$EXPECTED_SHA"
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
export GLINTEX_DEPLOY_SHA="$EXPECTED_SHA"

mkdir -p staging-data/backups staging-data/logs
${COMPOSE[@]} up -d db

EXPECTED_DB="$(sed -n 's/^STAGING_DB_NAME=//p' .env.staging | tail -1)"
IDENTITY="$(${COMPOSE[@]} exec -T db sh -c 'psql -At -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select current_database(),current_user,inet_server_addr(),inet_server_port();"')"
test "${IDENTITY%%|*}" = "$EXPECTED_DB"

BACKUP_PATH="staging-data/backups/pre-deploy-${EXPECTED_SHA}.dump"
${COMPOSE[@]} exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$BACKUP_PATH"
test -s "$BACKUP_PATH"
sha256sum "$BACKUP_PATH" > "${BACKUP_PATH}.sha256"

${COMPOSE[@]} build backend frontend
APP_DIR="$APP_DIR" docker/staging/migrate.sh
${COMPOSE[@]} up -d db backend frontend

for service in db backend frontend; do
  container_id="$(${COMPOSE[@]} ps -q "$service")"
  test -n "$container_id"
  health_status=""
  for _ in $(seq 1 30); do
    health_status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id")"
    if test "$health_status" = healthy; then
      break
    fi
    if test "$health_status" = unhealthy; then
      break
    fi
    sleep 2
  done
  test "$health_status" = healthy
done

HEALTH="$(curl --fail --silent --show-error --retry 20 --retry-delay 3 --retry-connrefused http://127.0.0.1:4102/api/health)"
grep -Fq '"ok":true' <<<"$HEALTH"
test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"

trap - EXIT
printf 'deployed_sha=%s backup=%s database_identity=%s\n' "$EXPECTED_SHA" "$BACKUP_PATH" "$IDENTITY"
