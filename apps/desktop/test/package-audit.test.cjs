const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { scanPackageExclusions } = require('../scripts/audit-package.cjs');
test('complete package exclusion scan rejects driver/cache in resources, ASAR and unpacked files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glintex-package-audit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const asar = await import('@electron/asar');
  for (const location of ['resources/other', 'resources/app.asar.unpacked/nested', 'archive']) {
    for (const forbidden of ['unexpected.sys', 'plser64.dll', 'cache/anything.bin']) {
      const packageDirectory = path.join(root, 'package'); await fs.mkdir(packageDirectory);
      const source = location === 'archive' ? path.join(root, 'asar-source') : path.join(packageDirectory, location);
      const file = path.join(source, forbidden); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'vendor fixture');
      if (location === 'archive') await asar.createPackage(source, path.join(packageDirectory, 'app.asar'));
      await assert.rejects(scanPackageExclusions(packageDirectory), /must not ship/);
      await fs.rm(packageDirectory, { recursive: true }); await fs.rm(path.join(root, 'asar-source'), { recursive: true, force: true });
    }
  }
  const clean = path.join(root, 'clean'); await fs.mkdir(clean); await fs.writeFile(path.join(clean, 'GLINTEX.exe'), 'app');
  const result = await scanPackageExclusions(clean); assert.equal(result.physicalFiles, 1); assert.equal(result.cacheIncluded, false);
});
