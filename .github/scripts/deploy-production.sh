#!/usr/bin/env bash
set -Eeuo pipefail

readonly app_dir=${1:?production app directory is required}
readonly deploy_sha=${2:?exact deployment SHA is required}
readonly expected_host_sha=${3:?exact currently deployed SHA is required}
readonly server_override_sha=9dff653e26fba0f5c914eb6e1d3e460aba996efc0ef7cbe2d09e08ce22f1bd6e

[[ "$app_dir" = /* ]]
[[ "$deploy_sha" =~ ^[0-9a-f]{40}$ ]]
[[ "$expected_host_sha" =~ ^[0-9a-f]{40}$ ]]

exec 9>/var/lock/glintex-production-deploy.lock
if ! flock -n 9; then
  printf 'Another GLINTEX production deployment is running.\n' >&2
  exit 75
fi

cd "$app_dir"
test -f .env
test -f docker-compose.server.yml
test ! -L docker-compose.server.yml
test "$(sha256sum docker-compose.server.yml | cut -d' ' -f1)" = "$server_override_sha"
test -z "$(git status --porcelain --untracked-files=no)"

export GIT_TERMINAL_PROMPT=0
git fetch --no-tags origin refs/heads/main
test "$(git rev-parse FETCH_HEAD)" = "$deploy_sha"
git cat-file -e "${deploy_sha}^{commit}"
git cat-file -e "${expected_host_sha}^{commit}"
git merge-base --is-ancestor "$expected_host_sha" "$deploy_sha"
if git cat-file -e "${deploy_sha}:docker-compose.server.yml" 2>/dev/null; then
  printf 'The production server override must remain host-only.\n' >&2
  exit 1
fi

previous_sha=$(git rev-parse HEAD)
readonly previous_sha
test "$previous_sha" = "$expected_host_sha"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
readonly stamp
readonly state_dir="/var/backups/glintex/release-${stamp}-${deploy_sha:0:12}"
source_dir=$(mktemp -d "/var/tmp/glintex-${deploy_sha:0:12}.XXXXXX")
readonly source_dir
install -d -m 700 "$state_dir"

live_compose=(
  env -u COMPOSE_FILE -u COMPOSE_PROFILES docker compose
  --project-name glintex-app
  --project-directory "$app_dir"
  --env-file "$app_dir/.env"
  -f "$app_dir/docker-compose.yml"
  -f "$app_dir/docker-compose.prod.yml"
  -f "$app_dir/docker-compose.server.yml"
)

build_compose=(
  env -u COMPOSE_FILE -u COMPOSE_PROFILES docker compose
  --project-name glintex-app
  --project-directory "$source_dir"
  --env-file "$app_dir/.env"
  -f "$source_dir/docker-compose.yml"
  -f "$source_dir/docker-compose.prod.yml"
  -f "$app_dir/docker-compose.server.yml"
)

cutover_started=0

cleanup() {
  if [[ -n "${source_dir:-}" && "$source_dir" == /var/tmp/glintex-* ]]; then
    rm -rf -- "$source_dir"
  fi
}

fail_closed() {
  local rc=${1:-1}
  trap - ERR EXIT HUP INT TERM
  set +e
  if ((cutover_started)); then
    "${live_compose[@]}" stop frontend agent-api backend </dev/null
    printf 'Deployment stopped after cutover began. External writers remain stopped; use the retained rollback images and predeploy manifest for recovery.\n' >&2
  fi
  cleanup
  exit "$rc"
}

trap 'fail_closed $?' ERR
trap 'fail_closed $?' EXIT
trap 'fail_closed 129' HUP
trap 'fail_closed 130' INT
trap 'fail_closed 143' TERM

wait_url() {
  local url=$1
  local attempt
  for ((attempt = 1; attempt <= 30; attempt += 1)); do
    if curl -fsS --max-time 3 "$url" >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

verify_migration_history() {
  local require_complete=${1:-false}
  local applied_count=0
  local expected_applied_count=0
  local migration_name
  local recorded_checksum
  local recorded_total
  local migration_file
  local source_checksum
  local source_count
  local legacy_drift_key
  local migration_rows

  migration_rows=$("${live_compose[@]}" exec -T backend sh -lc \
    'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -AtF "|" -c "SELECT migration_name, checksum, count(*) OVER () FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;"' \
    </dev/null)

  while IFS='|' read -r migration_name recorded_checksum recorded_total; do
    [[ -n "$migration_name" && -n "$recorded_checksum" ]]
    [[ "$migration_name" =~ ^[A-Za-z0-9_]+$ ]]
    [[ "$recorded_checksum" =~ ^[0-9a-f]{64}$ ]]
    [[ "$recorded_total" =~ ^[0-9]+$ ]]
    if ((expected_applied_count == 0)); then
      expected_applied_count=$recorded_total
    fi
    test "$recorded_total" -eq "$expected_applied_count"
    migration_file="$source_dir/apps/backend/prisma/migrations/$migration_name/migration.sql"
    test -f "$migration_file"
    source_checksum=$(sha256sum "$migration_file" | cut -d' ' -f1)
    if [[ "$source_checksum" != "$recorded_checksum" ]]; then
      legacy_drift_key="${migration_name}|${recorded_checksum}|${source_checksum}"
      case "$legacy_drift_key" in
        '20260211120000_add_issue_takeback_ledger|5a207f7ab6b2d4ff3b45436d8a5c52a63916e17f403b5ddf4a86b7ad789c8da0|3be9255d4f055f43025376f5dd7f0c16626ba920b101b257c2d47ebd57ec63a4' | \
        '20260506b_statement_timeout|5028a745255d931d705a09585ea7193c72628196a9a1174b31776b79bcbc616e|d1af09876ed5a911412800bc76009042232cb43658f9669206e61cded4d294b5')
          printf 'Accepted pinned legacy migration checksum pair: %s\n' "$migration_name" >&2
          ;;
        *)
          printf 'Unexpected migration checksum drift: %s\n' "$migration_name" >&2
          return 1
          ;;
      esac
    fi
    applied_count=$((applied_count + 1))
  done <<<"$migration_rows"

  source_count=$(find "$source_dir/apps/backend/prisma/migrations" \
    -mindepth 2 -maxdepth 2 -type f -name migration.sql | wc -l)
  test "$applied_count" -ge 41
  test "$applied_count" -eq "$expected_applied_count"
  test "$source_count" -ge "$applied_count"
  if [[ "$require_complete" = true ]]; then
    test "$source_count" -eq "$applied_count"
  fi
}

old_backend_cid=$("${live_compose[@]}" ps -q backend)
old_frontend_cid=$("${live_compose[@]}" ps -q frontend)
old_agent_cid=$("${live_compose[@]}" ps -q agent-api)
test -n "$old_backend_cid"
test -n "$old_frontend_cid"
test -n "$old_agent_cid"

old_backend_image=$(docker inspect --format '{{.Image}}' "$old_backend_cid")
old_frontend_image=$(docker inspect --format '{{.Image}}' "$old_frontend_cid")
old_agent_image=$(docker inspect --format '{{.Image}}' "$old_agent_cid")
rollback_tag="rollback-${stamp}-${previous_sha:0:12}"
docker image tag "$old_backend_image" "glintex-app-backend:$rollback_tag"
docker image tag "$old_frontend_image" "glintex-app-frontend:$rollback_tag"
docker image tag "$old_agent_image" "glintex-app-agent-api:$rollback_tag"

identity_query='SELECT current_database(), current_user, system_identifier FROM pg_control_system();'
expected_identity=$("${live_compose[@]}" exec -T db sh -lc \
  'psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -AtF "|" -c "$1"' \
  sh "$identity_query" </dev/null)
actual_identity=$("${live_compose[@]}" exec -T backend sh -lc \
  'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -AtF "|" -c "$1"' \
  sh "$identity_query" </dev/null)
test -n "$expected_identity"
test "$actual_identity" = "$expected_identity"

dump="$state_dir/predeploy.dump"
"${live_compose[@]}" exec -T backend sh -lc \
  'pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL"' \
  </dev/null >"$dump"
chmod 600 "$dump"
test -s "$dump"
"${live_compose[@]}" exec -T backend sh -lc 'pg_restore --list >/dev/null' \
  <"$dump"
sha256sum "$dump" >"$dump.sha256"
chmod 600 "$dump.sha256"

{
  printf 'candidate=%s\n' "$deploy_sha"
  printf 'previous=%s\n' "$previous_sha"
  printf 'database_identity=%s\n' "$actual_identity"
  printf 'rollback_backend_image=%s\n' "$old_backend_image"
  printf 'rollback_frontend_image=%s\n' "$old_frontend_image"
  printf 'rollback_agent_image=%s\n' "$old_agent_image"
  printf 'rollback_tag=%s\n' "$rollback_tag"
  printf 'dump_sha256=%s\n' "$(cut -d' ' -f1 "$dump.sha256")"
} >"$state_dir/predeploy-manifest.txt"
chmod 600 "$state_dir/predeploy-manifest.txt"

test -z "$(git ls-tree -r --name-only "$deploy_sha" -- \
  apps/backend/backups apps/backend/scripts/backups)"
git archive "$deploy_sha" | tar -xf - -C "$source_dir"
test -z "$(find "$source_dir" -type f \( -name '*.dump' -o -name '*.backup' \) \
  -print -quit)"
install -d -m 700 "$source_dir/apps/backend/backups"
printf 'Committed-only deployment context. No production backup data.\n' \
  >"$source_dir/apps/backend/backups/.release-context"

source_real=$(realpath "$source_dir")
rendered_compose=$("${build_compose[@]}" config --format json)
jq -e --arg source "$source_real" '
  ((.services | keys | sort) == ["agent-api", "backend", "db", "frontend"])
  and ((.services | has("migrate")) | not)
  and (((.services.db.ports // []) | length) == 0)
  and (.services.backend.build.context == ($source + "/apps/backend"))
  and (.services.frontend.build.context == ($source + "/apps/frontend"))
  and (.services["agent-api"].build.context == $source)
  and ([.services[] | .ports[]?
        | select((.host_ip // "") != "127.0.0.1")] | length == 0)
' <<<"$rendered_compose" >/dev/null
verify_migration_history false

export GLINTEX_DEPLOY_SHA="$deploy_sha"
"${build_compose[@]}" build backend frontend agent-api </dev/null

candidate_backend_image=$(docker image inspect --format '{{.Id}}' glintex-app-backend:latest)
candidate_frontend_image=$(docker image inspect --format '{{.Id}}' glintex-app-frontend:latest)
candidate_agent_image=$(docker image inspect --format '{{.Id}}' glintex-app-agent-api:latest)
release_tag="release-${deploy_sha:0:12}"
docker image tag "$candidate_backend_image" "glintex-app-backend:$release_tag"
docker image tag "$candidate_frontend_image" "glintex-app-frontend:$release_tag"
docker image tag "$candidate_agent_image" "glintex-app-agent-api:$release_tag"

docker run --rm --entrypoint sh "$candidate_backend_image" -ec \
  'test -f /app/backups/.release-context; test "$(find /app/backups -mindepth 1 -type f | wc -l)" -eq 1' \
  </dev/null
"${build_compose[@]}" run --rm --no-deps -T backend \
  npx prisma validate </dev/null
"${build_compose[@]}" run --rm --no-deps -T backend \
  npx prisma migrate status </dev/null
docker run --rm --entrypoint sh "$candidate_frontend_image" -ec \
  'nginx -t; nginx; wget -qO- http://127.0.0.1/ >/dev/null; nginx -s quit' \
  </dev/null
"${build_compose[@]}" run --rm --no-deps -T agent-api \
  node --input-type=module -e \
  "import {createAgentApp} from './src/agentApp.js'; const app=createAgentApp(); const server=app.listen(0,'127.0.0.1',async()=>{try{const port=server.address().port;const response=await fetch('http://127.0.0.1:'+port+'/healthz');if(!response.ok)process.exitCode=1;}catch(error){console.error(error);process.exitCode=1;}finally{server.close();}});" \
  </dev/null

git checkout --detach "$deploy_sha"
test "$(git rev-parse HEAD)" = "$deploy_sha"

cutover_started=1
"${live_compose[@]}" stop frontend agent-api </dev/null
"${live_compose[@]}" up -d --no-deps --no-build --force-recreate backend </dev/null
wait_url http://127.0.0.1:4002/api/health

if "${live_compose[@]}" exec -T backend test -f \
  /app/prisma/manual/apply_process_pagination_indexes.sql </dev/null; then
  "${live_compose[@]}" exec -T backend sh -lc \
    'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /app/prisma/manual/apply_process_pagination_indexes.sql' \
    </dev/null
fi
verify_migration_history true
"${live_compose[@]}" exec -T backend npx prisma migrate status </dev/null

"${live_compose[@]}" up -d --no-deps --no-build --force-recreate frontend agent-api \
  </dev/null
wait_url http://127.0.0.1:4173/
wait_url http://127.0.0.1:4003/healthz
wait_url https://app.glintex.in/api/health
wait_url https://app.glintex.in/

backend_cid=$("${live_compose[@]}" ps -q backend)
frontend_cid=$("${live_compose[@]}" ps -q frontend)
agent_cid=$("${live_compose[@]}" ps -q agent-api)
test "$(docker inspect --format '{{.Image}}' "$backend_cid")" = "$candidate_backend_image"
test "$(docker inspect --format '{{.Image}}' "$frontend_cid")" = "$candidate_frontend_image"
test "$(docker inspect --format '{{.Image}}' "$agent_cid")" = "$candidate_agent_image"
test "$(docker port "$backend_cid" 4000/tcp)" = 127.0.0.1:4002
test "$(docker port "$frontend_cid" 80/tcp)" = 127.0.0.1:4173
test "$(docker port "$agent_cid" 4003/tcp)" = 127.0.0.1:4003

actual_deploy_sha=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' \
  "$agent_cid" | sed -n 's/^GLINTEX_DEPLOY_SHA=//p')
test "$actual_deploy_sha" = "$deploy_sha"

{
  printf 'candidate=%s\n' "$deploy_sha"
  printf 'previous=%s\n' "$previous_sha"
  printf 'database_identity=%s\n' "$actual_identity"
  printf 'backend_image=%s\n' "$candidate_backend_image"
  printf 'frontend_image=%s\n' "$candidate_frontend_image"
  printf 'agent_image=%s\n' "$candidate_agent_image"
  printf 'dump_sha256=%s\n' "$(cut -d' ' -f1 "$dump.sha256")"
} >"$state_dir/postdeploy-manifest.txt"
chmod 600 "$state_dir/postdeploy-manifest.txt"

cutover_started=0
cleanup
trap - ERR EXIT HUP INT TERM
printf 'Production deployment completed for exact SHA %s.\n' "$deploy_sha"
printf 'Backup and rollback metadata: %s\n' "$state_dir"
