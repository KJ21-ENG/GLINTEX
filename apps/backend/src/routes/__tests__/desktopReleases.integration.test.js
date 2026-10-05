import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { fixture, login } from './helpers/desktopAuthFixture.js';
import { createDesktopReleaseRouter } from '../desktopReleases.js';
const prefix = '/api/desktop/releases/windows-x64';
const bytes = Buffer.from('private fixture bytes');
const release = { schemaVersion: 1, product: 'GLINTEX', platform: 'win32', arch: 'x64', channel: 'stable', version: '1.1.0', sourceCommit: 'a'.repeat(40), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), signing: 'unsigned-test-installer', notes: 'test', publishedAt: '2026-10-05T00:00:00Z' };
async function setup(t, configured = true) {
  const f = await fixture(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glintex-private-releases-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  f.app.use('/api/desktop/releases', createDesktopReleaseRouter({ authenticate: f.authenticate, getDirectory: () => configured ? directory : undefined }));
  const cookie = await login(f.app);
  const publish = async () => { await fs.mkdir(path.join(directory, release.version)); await fs.writeFile(path.join(directory, 'latest.json'), JSON.stringify({ version: release.version })); await fs.writeFile(path.join(directory, release.version, 'manifest.json'), JSON.stringify(release)); await fs.writeFile(path.join(directory, release.version, `GLINTEX-${release.version}-x64-Setup.exe`), bytes); };
  return { ...f, directory, cookie, publish };
}
test('release routes reuse real HttpOnly login and protect manifest and bytes from absent, expired and revoked sessions', async t => {
  const f = await setup(t); await f.publish();
  await request(f.app).get(prefix + '/latest').expect(401);
  const meta = await request(f.app).get(prefix + '/latest').set('Cookie', f.cookie).expect(200);
  assert.deepEqual(meta.body, release); assert.equal(meta.headers['cache-control'], 'private, no-store');
  const file = await request(f.app).get(prefix + '/1.1.0/setup').set('Cookie', f.cookie).expect(200);
  assert.equal(createHash('sha256').update(file.body).digest('hex'), release.sha256);
  f.sessions[0].revokedAt = new Date();
  await request(f.app).get(prefix + '/latest').set('Cookie', f.cookie).expect(401);
  await request(f.app).get(prefix + '/1.1.0/setup').set('Cookie', f.cookie).expect(401);
  f.sessions[0].revokedAt = null; f.sessions[0].expiresAt = new Date(0);
  await request(f.app).get(prefix + '/latest').set('Cookie', f.cookie).expect(401);
});
test('disabled user cannot obtain private release metadata', async t => { const f = await setup(t); await f.publish(); f.users[0].isActive = false; await request(f.app).get(prefix + '/latest').set('Cookie', f.cookie).expect(403); });
test('unconfigured hosting and empty directory are explicit states, with no public fallback', async t => {
  const absent = await setup(t, false); await request(absent.app).get(prefix + '/latest').set('Cookie', absent.cookie).expect(503);
  const empty = await setup(t); await request(empty.app).get(prefix + '/latest').set('Cookie', empty.cookie).expect(204);
});
test('corrupt bytes, invalid versions and files outside the private directory are refused', async t => {
  const f = await setup(t); await f.publish();
  await request(f.app).get(prefix + '/evil/setup').set('Cookie', f.cookie).expect(404);
  const file = path.join(f.directory, '1.1.0', 'GLINTEX-1.1.0-x64-Setup.exe');
  await fs.writeFile(file, Buffer.alloc(bytes.length)); await request(f.app).get(prefix + '/1.1.0/setup').set('Cookie', f.cookie).expect(503);
  await fs.writeFile(path.join(f.directory, 'latest.json'), '{"version":"../../escape"}'); await request(f.app).get(prefix + '/latest').set('Cookie', f.cookie).expect(503);
  await fs.rm(file); const outside = path.join(os.tmpdir(), `glintex-outside-${Date.now()}`); await fs.writeFile(outside, bytes); t.after(() => fs.rm(outside, { force: true })); await fs.symlink(outside, file);
  await request(f.app).get(prefix + '/1.1.0/setup').set('Cookie', f.cookie).expect(503);
});
