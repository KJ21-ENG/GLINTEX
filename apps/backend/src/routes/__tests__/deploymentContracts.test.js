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
  assert.match(workflow, /trap rollback ERR/);
  assert.match(workflow, /git checkout --detach "\$previous_sha"/);
  assert.match(workflow, /Rollback to \$previous_sha passed health checks/);
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
