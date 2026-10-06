const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
async function scanPackageExclusions(directory) {
  const manifest = require('../../../hardware/scale-driver/manifest.json');
  const vendorFiles = [manifest.archive, ...manifest.files];
  const sizes = new Set(vendorFiles.map(file => file.bytes));
  const hashes = new Set(vendorFiles.map(file => file.sha256));
  const asar = await import('@electron/asar');
  let physicalFiles = 0, archiveEntries = 0;
  function checkName(name) {
    const normalized = name.replaceAll('\\', '/');
    assert.doesNotMatch(normalized, /(^|\/)cache(\/|$)/i, 'Driver/cache directory must not ship: ' + normalized);
    assert.doesNotMatch(normalized, /\.(cab|inf|cat|sys)$|(^|\/)plser(?:64)?\.dll$/i, 'Driver package file must not ship: ' + normalized);
  }
  function checkBytes(bytes, name) {
    assert.ok(!hashes.has(createHash('sha256').update(bytes).digest('hex')), 'Pinned vendor bytes must not ship, including renamed files: ' + name);
  }
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name), relative = path.relative(directory, file);
      checkName(relative);
      assert.ok(!entry.isSymbolicLink(), 'Linked package entry must not ship: ' + relative);
      if (entry.isDirectory()) { walk(file); continue; }
      assert.ok(entry.isFile(), 'Unexpected package entry: ' + relative);
      physicalFiles++;
      if (sizes.has(fs.statSync(file).size)) checkBytes(fs.readFileSync(file), relative);
      if (!entry.name.endsWith('.asar')) continue;
      for (const name of asar.listPackage(file)) {
        checkName(name); archiveEntries++;
        const item = asar.statFile(file, name.replace(/^[/\\]/, ''));
        assert.ok(!item.link, 'Linked ASAR entry must not ship: ' + name);
        if (sizes.has(item.size)) checkBytes(asar.extractFile(file, name.replace(/^[/\\]/, '')), relative + ':' + name);
      }
    }
  }
  walk(directory);
  return { physicalFiles, archiveEntries, cacheIncluded: false, proprietaryDriverBinariesIncluded: false };
}
async function audit(directory) {
  const exclusions = await scanPackageExclusions(directory);
  const root = path.resolve(__dirname, '../../..'), kit = path.join(directory, 'resources/scale-driver');
  const names = ['Install.cmd','Install-ScaleDriver.ps1','manifest.json','README.md'];
  assert.deepEqual(fs.readdirSync(kit).sort(), [...names].sort(), 'Only allowlisted driver scripts/manifest may ship');
  const hashes = {};
  for (const name of names) {
    const source = path.join(root, 'hardware/scale-driver', name);
    const bytes = fs.readFileSync(path.join(kit, name)); assert.ok(bytes.equals(fs.readFileSync(source)), name + ' differs from source');
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
  for (const name of ['Install.cmd', 'Install-ScaleDriver.ps1']) assert.doesNotMatch(fs.readFileSync(path.join(kit, name), 'utf8'), /-Verb\s+RunAs|pnputil|ExecutionPolicy\s+Bypass|Set-ExecutionPolicy/i);
  const hostDirectory=path.join(directory,'resources/update-host');
  assert.deepEqual(fs.readdirSync(hostDirectory).sort(),['GLINTEXUpdateHost.exe','identity.json']);
  const hostIdentity=JSON.parse(fs.readFileSync(path.join(hostDirectory,'identity.json')));
  const host=fs.readFileSync(path.join(hostDirectory,'GLINTEXUpdateHost.exe'));
  assert.equal(createHash('sha256').update(host).digest('hex'),hostIdentity.binarySha256);
  assert.equal(host.length,hostIdentity.bytes); assert.equal(host.readUInt16LE(host.readUInt32LE(0x3c)+4),0x8664);
  for(const [name,key] of [['WindowsUpdateHost.cs','sourceSha256'],['WindowsUpdateHost.manifest','manifestSha256']])assert.equal(createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../src/updates',name))).digest('hex'),hostIdentity[key]);
  const asar = await import('@electron/asar'), archive = path.join(directory, 'resources/app.asar');
  const packageJson = JSON.parse(asar.extractFile(archive, 'package.json'));
  const info = JSON.parse(asar.extractFile(archive, 'build-info.json'));
  assert.equal(packageJson.version, require('../package.json').version);
  assert.equal(info.sourceCommit, execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8' }).trim());
  assert.equal(hostIdentity.sourceCommit,info.sourceCommit);
  // ASAR lists with the host OS separator, including backslashes on Windows.
  const files = asar.listPackage(archive).map(name => name.replaceAll('\\', '/'));
  for (const name of ['src/driver/setup.cjs','src/updates/controller.cjs','src/updates/safety.cjs','src/updates/protocol.cjs']) {
    assert.ok(files.includes('/'+name), name + ' absent from packaged app');
    assert.ok(asar.extractFile(archive, path.join(...name.split('/'))).equals(fs.readFileSync(path.join(__dirname, '..', name))), name + ' differs from tested source');
  }
  const native = files.find(name => /bindings-cpp\/prebuilds\/win32-x64\/.*\.node$/.test(name)); assert.ok(native, 'Windows x64 native SerialPort binding absent');
  const binary = asar.extractFile(archive, path.join(...native.replace(/^\//,'').split('/')));
  assert.equal(binary.subarray(0,2).toString(), 'MZ'); assert.equal(binary.readUInt16LE(binary.readUInt32LE(0x3c)+4), 0x8664);
  return { passed: true, version: packageJson.version, sourceCommit: info.sourceCommit, externalKitFiles: hashes, windowsSerialBindingPresent: true, ...exclusions, updaterModulesIncluded: true, driverPreparationOnly: true, automaticDriverElevation: false, windowsGUIUpdateHost: hostIdentity };
}
if (require.main === module) audit(path.resolve(process.argv[2])).then(report => console.log(JSON.stringify(report,null,2))).catch(error => { console.error(error); process.exit(1); });
module.exports = { audit, scanPackageExclusions };
