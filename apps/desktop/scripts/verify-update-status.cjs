// Disposable Windows filesystem check: no installed app, installer or hardware.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { launchCommand } = require('../src/updates/controller.cjs');
const { waitForHelper, retryStatusAccess } = require('../src/updates/status-file.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = s => "'" + s.replaceAll("'", "''") + "'";
function powershell(script) {
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ProgressPreference='SilentlyContinue'; " + script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let error = ''; child.stderr.on('data', data => { error += data; });
  child.result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 || code === 2 ? resolve(code) : reject(new Error('Filesystem fixture helper failed: ' + error.slice(-2000))));
  });
  // Observe early rejection while other fixture work is pending.
  child.result.catch(() => {});
  return child;
}
async function exists(file) { try { await fs.stat(file); return true; } catch (e) { if (e.code !== 'ENOENT') throw e; return false; } }
async function until(condition) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await condition()) return; await wait(50); }
  throw Error('Windows filesystem fixture timed out');
}
async function verifyUpdateStatus() {
  assert.equal(process.platform, 'win32');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glintex-update-status-'));
  // waitForHelper intentionally unrefs a successful production helper. Keep
  // this standalone test alive until it has observed the helper's cancellation.
  const keepAlive = setInterval(() => {}, 1000);
  const children = [];
  const report = { passed: false, platform: process.platform, node: process.versions.node };
  try {
    const statusFile = path.join(directory, 'install-status.json');
    const marker = path.join(directory, 'install-approved.json');
    const locked = path.join(directory, 'locked');
    const unlock = path.join(directory, 'unlock');
    const expected = { parentPid: process.pid, release: { version: '1.1.4', bytes: 0, sha256: 'a'.repeat(64) } };
    const initial = JSON.stringify({ state: 'waiting', version: expected.release.version, parentPid: process.pid });
    async function lockStatus() {
      await fs.rm(locked, { force: true }); await fs.rm(unlock, { force: true });
      const locker = powershell(`$ErrorActionPreference='Stop'; $stream=[IO.File]::Open(${quote(statusFile)},[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None); try { [IO.File]::WriteAllText(${quote(locked)},'locked'); $deadline=(Get-Date).AddSeconds(15); while(-not(Test-Path -LiteralPath ${quote(unlock)}) -and (Get-Date)-lt $deadline){Start-Sleep -Milliseconds 50} } finally {$stream.Dispose()}`);
      children.push(locker); await until(() => exists(locked)); return locker;
    }
    await fs.writeFile(statusFile, initial);
    let locker = await lockStatus();
    await assert.rejects(fs.readFile(statusFile, 'utf8'), error => { report.reproducedError = error.code; return ['EBUSY', 'EACCES', 'EPERM'].includes(error.code); });
    const fake = new EventEmitter(); fake.kill = () => { report.helperKilled = true; }; fake.unref = () => {};
    setTimeout(() => fs.writeFile(unlock, 'release').catch(() => {}), 500);
    await waitForHelper(fake, statusFile, expected); await locker.result;
    assert.equal(report.helperKilled, undefined); report.readRecovered = true;

    // Lock the existing destination while the real generated Windows helper
    // writes. It must retry the atomic replacement, then acknowledge correctly.
    await fs.writeFile(statusFile, '{"state":"previous"}'); await fs.writeFile(marker, '{}');
    locker = await lockStatus();
    const helper = powershell(launchCommand({ ...expected, marker, statusFile, file: path.join(directory, 'never-launched-Setup.exe') }));
    children.push(helper);
    await until(async () => (await fs.readdir(directory)).some(name => name.endsWith('.tmp')));
    await wait(400); await fs.writeFile(unlock, 'release'); await locker.result;
    await waitForHelper(helper, statusFile, expected);
    report.writerRecovered = true;
    await fs.rm(marker); assert.equal(await helper.result, 2);
    const final = JSON.parse(await fs.readFile(statusFile, 'utf8'));
    assert.equal(final.state, 'cancelled');
    assert.equal((await fs.readdir(directory)).some(name => name.endsWith('.tmp')), false);
    report.atomicTemporaryFilesRemoved = true;

    // Old status cleanup is also a Windows sharing-sensitive operation.
    locker = await lockStatus();
    setTimeout(() => fs.writeFile(unlock, 'release').catch(() => {}), 500);
    await retryStatusAccess(() => fs.rm(statusFile, { force: true })); await locker.result;
    assert.equal(await exists(statusFile), false); report.cleanupRecovered = true;
    report.passed = true;
    return report;
  } finally {
    try {
      for (const child of children) if (child.exitCode === null) child.kill();
      await Promise.allSettled(children.map(child => child.result));
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
    } finally { clearInterval(keepAlive); }
  }
}
module.exports = { verifyUpdateStatus };
if (require.main === module) {
  verifyUpdateStatus().then(report => fs.writeFile(process.argv[2] || path.join(__dirname, 'update-status-proof.json'), JSON.stringify(report, null, 2)))
    .catch(async error => { await fs.writeFile(process.argv[2] || path.join(__dirname, 'update-status-proof.json'), JSON.stringify({ passed: false, error: error.stack })); process.exitCode = 1; });
}
