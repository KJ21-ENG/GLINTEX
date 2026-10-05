const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
async function audit(directory) {
  const root = path.resolve(__dirname, '../../..'), kit = path.join(directory, 'resources/scale-driver');
  const names = ['Install.cmd','Install-ScaleDriver.ps1','manifest.json','README.md','Run-DriverSetup.ps1'];
  assert.deepEqual(fs.readdirSync(kit).sort(), [...names].sort(), 'Only allowlisted driver scripts/manifest may ship');
  const hashes = {};
  for (const name of names) {
    const source = name === 'Run-DriverSetup.ps1' ? path.join(__dirname, '../src/driver', name) : path.join(root, 'hardware/scale-driver', name);
    const bytes = fs.readFileSync(path.join(kit, name)); assert.ok(bytes.equals(fs.readFileSync(source)), name + ' differs from source');
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
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
  for (const name of ['src/updates/controller.cjs','src/updates/safety.cjs','src/updates/protocol.cjs']) {
    assert.ok(files.includes('/'+name), name + ' absent from packaged app');
    assert.ok(asar.extractFile(archive, path.join(...name.split('/'))).equals(fs.readFileSync(path.join(__dirname, '..', name))), name + ' differs from tested source');
  }
  const native = files.find(name => /bindings-cpp\/prebuilds\/win32-x64\/.*\.node$/.test(name)); assert.ok(native, 'Windows x64 native SerialPort binding absent');
  const binary = asar.extractFile(archive, path.join(...native.replace(/^\//,'').split('/')));
  assert.equal(binary.subarray(0,2).toString(), 'MZ'); assert.equal(binary.readUInt16LE(binary.readUInt32LE(0x3c)+4), 0x8664);
  return { passed: true, version: packageJson.version, sourceCommit: info.sourceCommit, externalKitFiles: hashes, windowsSerialBindingPresent: true, cacheIncluded: false, proprietaryDriverBinariesIncluded: false, updaterModulesIncluded: true, windowsGUIUpdateHost: hostIdentity };
}
if (require.main === module) audit(path.resolve(process.argv[2])).then(report => console.log(JSON.stringify(report,null,2))).catch(error => { console.error(error); process.exit(1); });
module.exports = { audit };
