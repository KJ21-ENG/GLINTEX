const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { UpdateController, launchCommand } = require('../src/updates/controller.cjs');
const { validateRelease, compareVersions } = require('../src/updates/protocol.cjs');
const { updateBlockReason } = require('../src/updates/safety.cjs');
const bytes = Buffer.from('disposable Windows installer fixture');
const release = { schemaVersion: 1, product: 'GLINTEX', platform: 'win32', arch: 'x64', channel: 'stable', version: '1.1.1', sourceCommit: 'a'.repeat(40), sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, signing: 'unsigned-test-installer', notes: 'Fixture only', publishedAt: '2026-10-05T00:00:00Z' };
async function fixture(t, fetch, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glintex-updates-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [], launches = [];
  const c = await new UpdateController({ version: '1.1.0', directory, supported: true, fetch: async (url, options) => {
    calls.push(url); assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'error');
    return fetch ? fetch(url, options) : new Response(url.endsWith('/latest') ? JSON.stringify(release) : bytes);
  }, launch: async args => launches.push(args), ...extra }).initialize();
  return { c, calls, launches, directory };
}
test('stable version ordering and bounded manifests reject unsupported or directed releases', () => {
  assert.equal(compareVersions('1.10.0', '1.9.999'), 1);
  for (const patch of [{ version: '../2' }, { arch: 'arm64' }, { bytes: 0 }, { sha256: 'broken' }, { signing: 'signed' }, { notes: 'x'.repeat(4001) }, { version: '1.01.2' }]) assert.throws(() => validateRelease({ ...release, ...patch }));
  const manifest = validateRelease({ ...release, url: 'https://evil.invalid', command: 'bad' });
  assert.equal(manifest.url, undefined); assert.equal(manifest.command, undefined);
  assert.throws(() => new UpdateController({ version: '1.1.0', origin: 'http://app.glintex.in' }));
  assert.throws(() => new UpdateController({ version: '1.1.0', origin: 'https://other.invalid' }));
});
test('successful trusted sign-in retries waiting discovery without download or installation', async t => {
  let signedIn=false;
  const { c, calls, launches } = await fixture(t, async () => signedIn ? new Response(JSON.stringify(release)) : new Response('', { status:401 }));
  assert.equal((await c.check()).state,'signin');
  for (const details of [
    {url:'https://foreign.invalid/api/auth/login',statusCode:200},
    {url:c.origin+'/api/auth/logout',statusCode:200},
    {url:c.origin+'/api/auth/login',statusCode:401},
  ]) assert.equal((await c.authenticationCompleted(details)).state,'signin');
  assert.equal(calls.length,1);
  signedIn=true;
  await Promise.all(['login','me','login'].map(name=>c.authenticationCompleted({url:c.origin+'/api/auth/'+name,statusCode:200})));
  assert.equal(c.status().state,'available'); assert.equal(calls.length,2); assert.equal(launches.length,0);
  await c.authenticationCompleted({url:c.origin+'/api/auth/me',statusCode:200}); assert.equal(calls.length,2);
  assert.equal(await c.verified(),false,'discovery never downloads an installer');
});
test('authenticated discovery and verified download never install until explicit arm and safe close', async t => {
  const { c, launches } = await fixture(t);
  assert.equal((await c.check()).state, 'available'); assert.equal(launches.length, 0);
  assert.equal((await c.download()).state, 'ready'); assert.equal(await c.verified(), true); assert.equal(launches.length, 0);
  await assert.rejects(c.installAfterExit({ safety: () => null }), /not selected/);
  await c.arm(); await assert.rejects(c.installAfterExit({ safety: () => 'Capture in progress' }), /Capture/); assert.equal(launches.length, 0);
  await Promise.all([c.installAfterExit({ safety: () => null, parentPid: 123 }), c.installAfterExit({ safety: () => null, parentPid: 123 })]); assert.equal(launches.length, 1); assert.equal(launches[0].parentPid, 123); assert.equal(launches[0].silent, false);
  await c.disarm(); await assert.rejects(fs.stat(c.marker), { code: 'ENOENT' });
});
test('Later, offline restart and missing production hosting never trigger installation', async t => {
  let now = 1;
  const { c, directory, launches } = await fixture(t, null, { clock: () => now });
  await c.check(); c.later(); assert.equal((await c.check()).prompt, false);
  assert.equal((await c.check({ manual: true })).prompt, true); c.later(); now += 6 * 60 * 60 * 1000;
  assert.equal((await c.check()).prompt, true);
  await c.download(); await c.arm();
  const restarted = await new UpdateController({ version: '1.1.0', directory, supported: true, fetch: async () => { throw Error('offline'); }, launch: async () => assert.fail('automatic install') }).initialize();
  assert.equal(restarted.status().state, 'ready'); assert.equal(launches.length, 0);
  assert.equal((await restarted.check()).state, 'error');
  for (const [status, state] of [[401,'signin'],[403,'signin'],[503,'unavailable'],[404,'unavailable'],[204,'current']]) { const { c: other } = await fixture(t, () => new Response(null, { status })); assert.equal((await other.check()).state, state); }
});
test('check and download are single flight; corrupted, truncated and oversized downloads cannot arm', async t => {
  const { c, calls } = await fixture(t);
  await Promise.all([c.check(),c.check(),c.check()]); assert.equal(calls.length, 1);
  await Promise.all([c.download(),c.download()]); assert.equal(calls.length, 2);
  for (const body of [Buffer.from('corrupt'), Buffer.concat([bytes,bytes])]) {
    const { c: bad, directory } = await fixture(t, url => new Response(url.endsWith('/latest') ? JSON.stringify(release) : body));
    await bad.check(); await assert.rejects(bad.download(), /checksum|size/); await assert.rejects(bad.arm(), /verified/);
    assert.deepEqual((await fs.readdir(directory)).filter(x => /exe|part|ready/.test(x)), []);
  }
});
test('cached-file tampering, redirects and unsupported platform stop installation', async t => {
  const { c } = await fixture(t); await c.check(); await c.download(); await fs.writeFile(c.file(), Buffer.alloc(bytes.length));
  await assert.rejects(c.arm(), /verified/);
  const { c: redirected } = await fixture(t, () => ({ ok: true, status: 200, url: 'https://evil.invalid', text: async () => JSON.stringify(release) }));
  assert.equal((await redirected.check()).state, 'error');
  const { c: unsupported } = await fixture(t, null, { supported: false });
  assert.equal((await unsupported.check()).state, 'unsupported'); await assert.rejects(unsupported.arm());
});
test('same-version and rollback manifests cannot become download authority', async t => {
  for (const version of ['1.1.0','1.0.9']) { const { c } = await fixture(t, () => new Response(JSON.stringify({ ...release, version }))); assert.equal((await c.check()).state, 'current'); await assert.rejects(c.download()); }
});
test('manual checks expose no-update, expired-session, unavailable and offline feedback', async t => {
  for (const status of [204,401,503]) {
    const { c } = await fixture(t, () => new Response(null, { status }));
    assert.equal((await c.check({ manual: true })).prompt, true);
    c.later(); assert.equal(c.status().prompt, false);
  }
  const { c } = await fixture(t, () => { throw Error('offline'); });
  assert.equal((await c.check({ manual: true })).state, 'error'); assert.equal(c.status().prompt, true);
});
test('Windows handoff waits for the parent, rehashes and records installer failure without renderer commands', () => {
  const script = launchCommand({ file: "C:\\Users\\O'Brien\\updates\\Setup.exe", marker: 'C:\\updates\\approved.json', statusFile: 'C:\\updates\\status.json', parentPid: 123, release });
  assert.ok(script.includes("O''Brien")); assert.ok(script.includes('Get-Process -Id 123'));
  assert.ok(script.includes('Security.Cryptography.SHA256')); assert.ok(script.includes("Report 'waiting'")); assert.ok(script.includes("Report 'failed'"));
  assert.ok(script.includes('-PassThru -Wait')); assert.equal(script.includes('--silent'), false);
});
test('failed helper status stays visible on next launch but cannot supply installation authority', async t => {
  const { c, directory } = await fixture(t); await c.check(); await c.download();
  await fs.writeFile(path.join(directory,'install-status.json'), JSON.stringify({ state:'failed', version:release.version, command:'do not run', message:'do not display' }));
  const restarted = await new UpdateController({ version:'1.1.0', directory, supported:true, fetch:async()=>new Response(JSON.stringify(release)) }).initialize();
  assert.equal(restarted.status().state,'error'); assert.equal(restarted.status().prompt,true);
  assert.equal(restarted.status().message.includes('do not'),false); await assert.rejects(restarted.arm(),/verified/);
  assert.equal((await restarted.check({manual:true})).state,'ready');
});
test('helper startup failure cancels the install marker and retains the verified cache', async t => {
  const { c } = await fixture(t,null,{launch:async()=>{throw Error('helper did not acknowledge');}});
  await c.check();await c.download();await c.arm();await assert.rejects(c.installAfterExit({safety:()=>null}),/acknowledge/);
  await assert.rejects(fs.stat(c.marker),{code:'ENOENT'});assert.equal(c.status().state,'ready');assert.equal(await c.verified(),true);
});
test('cancelled transfer removes the partial file and remains retryable', async t => {
  let downloadStarted;
  const started = new Promise(resolve => { downloadStarted = resolve; });
  const { c, directory } = await fixture(t, (url, options) => {
    if (url.endsWith('/latest')) return new Response(JSON.stringify(release));
    downloadStarted(); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
  });
  await c.check(); const download = c.download(); await started; c.cancel();
  assert.equal((await download).state, 'available'); assert.equal(c.status().message.includes('cancelled'), true);
  assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.part')), false);
});
test('close safety refuses scale connection/capture, setup, saves, native work and queued prints', () => {
  for (const active of [{ scale: { isConnected: true } }, { scale: { status: 'connecting' } }, { driverRunning: true }, { nativeOperations: 1 }, { apiRequests: 1 }, { printJobs: [{ state: 'submitting' }] }]) assert.ok(updateBlockReason(active));
  assert.equal(updateBlockReason({ printJobs: [{ state: 'submitted' }, { state: 'failed' }, { state: 'outcome uncertain' }] }), null);
});
test('a cancelled choice cannot be rearmed by an earlier asynchronous verification', async t => {
  const { c } = await fixture(t); await c.check(); await c.download();
  const verified = c.verified.bind(c); let resolve;
  c.verified = () => new Promise(r => { resolve = r; }); const arming = c.arm();
  c.verified = verified; await c.disarm(); resolve(true);
  await assert.rejects(arming, /cancelled/); assert.equal(c.status().state, 'ready');
});
