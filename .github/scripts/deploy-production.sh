#!/usr/bin/env bash

set -Eeuo pipefail

app_dir=${1:?production app directory is required}
deploy_sha=${2:?exact deployment SHA is required}
cd "$app_dir"

echo "Starting production deployment for $deploy_sha"

previous_sha=$(git rev-parse HEAD)
deployment_started=0
compose=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$app_dir/apps/backend/backups"
backup_path="$backup_dir/${backup_stamp}_predeploy_${deploy_sha:0:12}.dump"
mkdir -p "$backup_dir"
identity_query='SELECT current_database(), current_user, system_identifier FROM pg_control_system();'
expected_db_identity=$("${compose[@]}" exec -T db sh -lc \
  'psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -AtF "|" -c "$1"' sh "$identity_query")
actual_db_identity=$("${compose[@]}" exec -T backend sh -lc \
  'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -AtF "|" -c "$1"' sh "$identity_query")
test -n "$expected_db_identity"
if [ "$actual_db_identity" != "$expected_db_identity" ]; then
  echo "Production database identity mismatch; refusing deployment" >&2
  exit 1
fi
echo "Verified production database identity: $actual_db_identity"
"${compose[@]}" exec -T backend sh -lc \
  'pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL"' > "$backup_path"
test -s "$backup_path"
chmod 600 "$backup_path"
"${compose[@]}" exec -T backend sh -lc 'pg_restore --list >/dev/null' < "$backup_path"
echo "Verified pre-deployment backup: $backup_path ($(wc -c < "$backup_path") bytes)"

rollback() {
  result=${1:-1}
  trap - ERR HUP INT TERM EXIT
  if [ "$deployment_started" -eq 1 ]; then
    echo "Deployment failed. Restoring $previous_sha"
    # Quiesce both external write paths before the previous backend is rebuilt
    # or restarted. A failed candidate must never keep writing records that the
    # rollback backend cannot interpret.
    "${compose[@]}" stop frontend agent-api || true
    export GLINTEX_DEPLOY_SHA="$previous_sha"
    git checkout --detach "$previous_sha"
    "${compose[@]}" build backend frontend agent-api
    "${compose[@]}" up -d --no-deps --wait backend frontend agent-api
    "${compose[@]}" exec -T backend wget -qO- http://127.0.0.1:4000/api/health >/dev/null
    "${compose[@]}" exec -T frontend wget -qO- http://127.0.0.1/ >/dev/null
    "${compose[@]}" exec -T agent-api node -e \
      "fetch('http://127.0.0.1:4003/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
    echo "Rollback to $previous_sha passed health checks"
  fi
  exit "$result"
}
trap 'rollback $?' ERR
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM
trap 'rollback $?' EXIT

git fetch origin "$deploy_sha"
git checkout --detach "$deploy_sha"
test "$(git rev-parse HEAD)" = "$deploy_sha"
export GLINTEX_DEPLOY_SHA="$deploy_sha"
deployment_started=1

"${compose[@]}" up -d db
"${compose[@]}" build backend frontend agent-api
"${compose[@]}" --profile migration run --rm migrate
# Keep every external writer offline until the complete candidate has passed
# its backend, agent, and frontend preflight checks. This makes rollback safe
# even when the new backend introduces additive write semantics that the
# previous backend does not understand yet.
"${compose[@]}" stop frontend agent-api
"${compose[@]}" up -d --no-deps --wait backend
"${compose[@]}" exec -T backend wget -qO- http://127.0.0.1:4000/api/health >/dev/null
# Exercise the frontend and agent images in unpublished one-off containers. The
# production writer containers stay stopped until every candidate component has
# passed its preflight.
"${compose[@]}" run --rm --no-deps frontend sh -ec \
  'nginx -t; nginx; wget -qO- http://127.0.0.1/ >/dev/null; nginx -s quit'
"${compose[@]}" run --rm --no-deps agent-api node --input-type=module -e \
  "import { createAgentApp } from './src/agentApp.js'; const app=createAgentApp(); const server=app.listen(0,'127.0.0.1',async()=>{try{const port=server.address().port;const response=await fetch('http://127.0.0.1:'+port+'/healthz');if(!response.ok)process.exitCode=1}catch(error){console.error(error);process.exitCode=1}finally{server.close()}})"
# Publish both external paths through one health-gated cutover. Neither
# candidate is intentionally made available while the other is still waiting
# on a separate production start command.
"${compose[@]}" up -d --no-deps --wait frontend agent-api
"${compose[@]}" exec -T frontend wget -qO- http://127.0.0.1/ >/dev/null
"${compose[@]}" exec -T agent-api node -e \
  "fetch('http://127.0.0.1:4003/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

deployment_started=0
trap - ERR HUP INT TERM EXIT
echo "Production deployment completed for $deploy_sha"
