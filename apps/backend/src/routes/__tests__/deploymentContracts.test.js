import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(dirname, '../../../../..');
const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/deploy-production.yml'), 'utf8');
const override = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.override.yml'), 'utf8');
const productionCompose = fs.readFileSync(path.join(repositoryRoot, 'docker-compose.prod.yml'), 'utf8');
const backendDockerfile = fs.readFileSync(path.join(repositoryRoot, 'apps/backend/Dockerfile'), 'utf8');
const frontendNginx = fs.readFileSync(
  path.join(repositoryRoot, 'apps/frontend/docker/nginx.conf'),
  'utf8',
);
const holoWastageMigration = fs.readFileSync(
  path.join(
    repositoryRoot,
    'apps/backend/prisma/migrations/20260828193000_add_holo_receive_wastage_classification/migration.sql',
  ),
  'utf8',
);
const holoWastageCleanupMigration = fs.readFileSync(
  path.join(
    repositoryRoot,
    'apps/backend/prisma/migrations/20260828212000_remove_holo_wastage_compatibility_trigger/migration.sql',
  ),
  'utf8',
);

test('production deployment selects only the reviewed base plus production Compose model', () => {
  assert.match(workflow, /compose=\(docker compose -f docker-compose\.yml -f docker-compose\.prod\.yml\)/);
  const bareCommands = workflow.split('\n').filter((line) => /docker compose (?!-f )/.test(line));
  assert.deepEqual(bareCommands, []);
  assert.match(override, /\.\/apps\/backend:\/app\/apps\/backend/);
  assert.doesNotMatch(override, /\.\/apps\/backend:\/app\s*$/m);
  assert.match(productionCompose, /ports: !override\s+\- "127\.0\.0\.1:4002:4000"/);
  assert.match(productionCompose, /ports: !override \[\]/);
});

test('production deployment restores and health-checks the prior SHA on failure', () => {
  assert.match(workflow, /previous_sha=\$\(git rev-parse HEAD\)/);
  assert.match(workflow, /trap 'rollback \$\?' ERR/);
  assert.match(workflow, /trap 'rollback 129' HUP/);
  assert.match(workflow, /trap 'rollback 130' INT/);
  assert.match(workflow, /trap 'rollback 143' TERM/);
  assert.match(workflow, /trap 'rollback \$\?' EXIT/);
  assert.match(workflow, /deployment_started=0[\s\S]*trap - ERR HUP INT TERM EXIT/);
  assert.match(workflow, /git checkout --detach "\$previous_sha"/);
  const rollbackIndex = workflow.indexOf('Deployment failed. Restoring $previous_sha');
  const rollbackStopIndex = workflow.indexOf('stop frontend agent-api || true', rollbackIndex);
  const rollbackCheckoutIndex = workflow.indexOf('git checkout --detach "$previous_sha"', rollbackIndex);
  assert.ok(rollbackStopIndex > rollbackIndex);
  assert.ok(rollbackCheckoutIndex > rollbackStopIndex);
  assert.match(workflow, /build backend frontend agent-api/);
  assert.match(workflow, /up -d --no-deps --wait backend frontend agent-api/);
  assert.match(workflow, /exec -T agent-api node -e/);
  assert.match(workflow, /Rollback to \$previous_sha passed health checks/);
});

test('production deployment keeps external writers quiesced until every replacement service passes', () => {
  const migrationIndex = workflow.indexOf('--profile migration run --rm migrate');
  const stopWritersIndex = workflow.indexOf('stop frontend agent-api', migrationIndex);
  const backendIndex = workflow.indexOf('up -d --no-deps --wait backend', stopWritersIndex);
  const frontendPreflightIndex = workflow.indexOf('run --rm --no-deps frontend sh -ec', backendIndex);
  const agentPreflightIndex = workflow.indexOf('run --rm --no-deps agent-api node --input-type=module', frontendPreflightIndex);
  const frontendIndex = workflow.indexOf('up -d --no-deps --wait frontend', agentPreflightIndex);
  const agentIndex = workflow.indexOf('up -d --no-deps --wait agent-api', frontendIndex);
  assert.ok(migrationIndex > 0);
  assert.ok(stopWritersIndex > migrationIndex);
  assert.ok(backendIndex > stopWritersIndex);
  assert.ok(frontendPreflightIndex > backendIndex);
  assert.ok(agentPreflightIndex > frontendPreflightIndex);
  assert.ok(frontendIndex > agentPreflightIndex);
  assert.ok(agentIndex > frontendIndex);
});

test('production deployment verifies database identity and a fresh dump before changing source or running migrations', () => {
  assert.match(workflow, /SELECT current_database\(\), current_user, system_identifier FROM pg_control_system\(\)/);
  assert.match(workflow, /expected_db_identity=/);
  assert.match(workflow, /actual_db_identity=/);
  assert.match(workflow, /if \[ "\$actual_db_identity" != "\$expected_db_identity" \]/);
  assert.match(workflow, /Production database identity mismatch; refusing deployment/);
  assert.match(workflow, /pg_dump --format=custom --no-owner --no-privileges/);
  assert.match(workflow, /test -s "\$backup_path"/);
  assert.match(workflow, /pg_restore --list >\/dev\/null/);
  const backupIndex = workflow.indexOf('Verified pre-deployment backup:');
  const checkoutIndex = workflow.indexOf('git checkout --detach "$deploy_sha"');
  const migrationIndex = workflow.indexOf('--profile migration run --rm migrate');
  assert.ok(backupIndex > 0);
  assert.ok(checkoutIndex > backupIndex);
  assert.ok(migrationIndex > checkoutIndex);
});

test('backend image resolves pinned Prisma tooling without network fallback', () => {
  assert.match(
    backendDockerfile,
    /npx --no-install prisma generate --schema apps\/backend\/prisma\/schema\.prisma/,
  );
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.equal(rootPackage.devDependencies?.prisma, '4.16.2');
  assert.match(
    backendDockerfile,
    /COPY --from=production-deps \/app\/apps\/backend\/node_modules \.\/apps\/backend\/node_modules/,
  );
});

test('production frontend proxies same-origin API calls and preserves SSE streaming', () => {
  assert.match(frontendNginx, /client_max_body_size 20m;/);
  assert.match(frontendNginx, /location \/api\/ \{[\s\S]*proxy_pass http:\/\/backend:4000;/);
  assert.match(
    frontendNginx,
    /location = \/api\/whatsapp\/events \{[\s\S]*proxy_buffering off;[\s\S]*proxy_read_timeout 1h;/,
  );
});

test('Holo receive migration preserves legacy totals while enabling explicit new-row buckets', () => {
  assert.match(holoWastageMigration, /ADD COLUMN IF NOT EXISTS "isWastage" BOOLEAN/);
  assert.doesNotMatch(holoWastageMigration, /UPDATE "ReceiveFromHoloMachineRow"/);
  assert.doesNotMatch(holoWastageMigration, /CREATE TRIGGER/);
  assert.match(holoWastageMigration, /writes from the previous backend stay NULL/);
  assert.match(holoWastageCleanupMigration, /DROP TRIGGER IF EXISTS classify_holo_receive_wastage_bucket/);
  assert.match(holoWastageCleanupMigration, /DROP FUNCTION IF EXISTS classify_holo_receive_wastage_bucket/);
});
