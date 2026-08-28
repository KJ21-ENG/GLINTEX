import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(dirname, '../../../../..');
const workflow = fs.readFileSync(path.join(repositoryRoot, '.github/workflows/deploy-production.yml'), 'utf8');
const deploymentScript = fs.readFileSync(
  path.join(repositoryRoot, '.github/scripts/deploy-production.sh'),
  'utf8',
);
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
  assert.match(deploymentScript, /compose=\(docker compose -f docker-compose\.yml -f docker-compose\.prod\.yml\)/);
  const bareCommands = deploymentScript.split('\n').filter((line) => /docker compose (?!-f )/.test(line));
  assert.deepEqual(bareCommands, []);
  assert.match(override, /\.\/apps\/backend:\/app\/apps\/backend/);
  assert.doesNotMatch(override, /\.\/apps\/backend:\/app\s*$/m);
  assert.match(productionCompose, /ports: !override\s+\- "127\.0\.0\.1:4002:4000"/);
  assert.match(productionCompose, /ports: !override \[\]/);
});

test('production deployment restores and health-checks the prior SHA on failure', () => {
  assert.match(deploymentScript, /previous_sha=\$\(git rev-parse HEAD\)/);
  assert.match(deploymentScript, /trap 'rollback \$\?' ERR/);
  assert.match(deploymentScript, /trap 'rollback 129' HUP/);
  assert.match(deploymentScript, /trap 'rollback 130' INT/);
  assert.match(deploymentScript, /trap 'rollback 143' TERM/);
  assert.match(deploymentScript, /trap 'rollback \$\?' EXIT/);
  assert.match(deploymentScript, /deployment_started=0[\s\S]*trap - ERR HUP INT TERM EXIT/);
  assert.match(deploymentScript, /git checkout --detach "\$previous_sha"/);
  const rollbackIndex = deploymentScript.indexOf('Deployment failed. Restoring $previous_sha');
  const rollbackStopIndex = deploymentScript.indexOf('stop frontend agent-api || true', rollbackIndex);
  const rollbackCheckoutIndex = deploymentScript.indexOf('git checkout --detach "$previous_sha"', rollbackIndex);
  assert.ok(rollbackStopIndex > rollbackIndex);
  assert.ok(rollbackCheckoutIndex > rollbackStopIndex);
  assert.match(deploymentScript, /build backend frontend agent-api/);
  assert.match(deploymentScript, /up -d --no-deps --wait backend frontend agent-api/);
  assert.match(deploymentScript, /exec -T agent-api node -e/);
  assert.match(deploymentScript, /Rollback to \$previous_sha passed health checks/);
});

test('production deployment keeps external writers quiesced until every replacement service passes', () => {
  const migrationIndex = deploymentScript.indexOf('--profile migration run --rm migrate');
  const stopWritersIndex = deploymentScript.indexOf('stop frontend agent-api', migrationIndex);
  const backendIndex = deploymentScript.indexOf('up -d --no-deps --wait backend', stopWritersIndex);
  const frontendPreflightIndex = deploymentScript.indexOf('run --rm --no-deps frontend sh -ec', backendIndex);
  const agentPreflightIndex = deploymentScript.indexOf('run --rm --no-deps agent-api node --input-type=module', frontendPreflightIndex);
  const writerCutoverIndex = deploymentScript.indexOf('up -d --no-deps --wait frontend agent-api', agentPreflightIndex);
  assert.ok(migrationIndex > 0);
  assert.ok(stopWritersIndex > migrationIndex);
  assert.ok(backendIndex > stopWritersIndex);
  assert.ok(frontendPreflightIndex > backendIndex);
  assert.ok(agentPreflightIndex > frontendPreflightIndex);
  assert.ok(writerCutoverIndex > agentPreflightIndex);
  assert.equal(deploymentScript.indexOf('up -d --no-deps --wait frontend\n'), -1);
  assert.equal(deploymentScript.indexOf('up -d --no-deps --wait agent-api\n'), -1);
});

test('production deployment verifies database identity and a fresh dump before changing source or running migrations', () => {
  assert.match(deploymentScript, /SELECT current_database\(\), current_user, system_identifier FROM pg_control_system\(\)/);
  assert.match(deploymentScript, /expected_db_identity=/);
  assert.match(deploymentScript, /actual_db_identity=/);
  assert.match(deploymentScript, /if \[ "\$actual_db_identity" != "\$expected_db_identity" \]/);
  assert.match(deploymentScript, /Production database identity mismatch; refusing deployment/);
  assert.match(deploymentScript, /pg_dump --format=custom --no-owner --no-privileges/);
  assert.match(deploymentScript, /test -s "\$backup_path"/);
  assert.match(deploymentScript, /pg_restore --list >\/dev\/null/);
  const backupIndex = deploymentScript.indexOf('Verified pre-deployment backup:');
  const checkoutIndex = deploymentScript.indexOf('git checkout --detach "$deploy_sha"');
  const migrationIndex = deploymentScript.indexOf('--profile migration run --rm migrate');
  assert.ok(backupIndex > 0);
  assert.ok(checkoutIndex > backupIndex);
  assert.ok(migrationIndex > checkoutIndex);
});

test('production workflow uploads and executes the checked-in deployment script as a file', () => {
  assert.match(workflow, /uses: actions\/checkout@v4/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /test -s \.github\/scripts\/deploy-production\.sh/);
  assert.match(workflow, /bash -n \.github\/scripts\/deploy-production\.sh/);
  assert.match(workflow, /\[\[ "\$DEPLOY_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]/);
  assert.match(workflow, /scp -q -i ~\/\.ssh\/production_deploy_key/);
  assert.match(workflow, /remote_script="\/tmp\/glintex-deploy-\$\{DEPLOY_SHA\}\.sh"/);
  assert.match(workflow, /trap 'rm -f \$remote_script_q' EXIT/);
  assert.match(workflow, /bash \$remote_script_q \$app_dir_q \$deploy_sha_q/);
  assert.doesNotMatch(workflow, /< \.github\/scripts\/deploy-production\.sh/);
  assert.doesNotMatch(workflow, /<<['"]?REMOTE_SCRIPT/);
  assert.match(deploymentScript, /Starting production deployment for \$deploy_sha/);
  assert.match(deploymentScript, /Production deployment completed for \$deploy_sha/);
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
