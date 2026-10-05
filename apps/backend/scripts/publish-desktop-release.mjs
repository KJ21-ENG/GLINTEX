// Operator-only filesystem publisher. No network upload or client credentials.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateDesktopRelease } from '../src/routes/desktopReleases.js';

export async function publishDesktopRelease({ delivery, verification, directory, notes, publishedAt = new Date().toISOString() }) {
  const manifest = JSON.parse(await fs.readFile(path.join(delivery, 'manifest.json'), 'utf8'));
  const identity = JSON.parse(await fs.readFile(path.join(delivery, 'release-identity.json'), 'utf8'));
  const tested = JSON.parse(await fs.readFile(verification, 'utf8'));
  if (!tested.passed || !tested.packagedLaunch || !tested.installedLaunch || !tested.upgradePreserved || !tested.authenticatedUpdate || !tested.manualBootstrapPreserved || !tested.reinstallPreserved || !tested.uninstall || tested.bootstrapTo !== manifest.version || identity.sourceCommit !== manifest.sourceCommit || identity.signing !== manifest.signing || identity.repository !== 'KJ21-ENG/GLINTEX-desktop-builds') throw new Error('Verified private Windows delivery required');
  const name = `GLINTEX-${manifest.version}-x64-Setup.exe`, file = manifest.files.find(f => f.name === name);
  if (!file) throw new Error('Candidate setup identity is missing');
  const release = validateDesktopRelease({ schemaVersion: 1, product: 'GLINTEX', platform: 'win32', arch: 'x64', channel: 'stable', version: manifest.version, sourceCommit: manifest.sourceCommit, bytes: file.bytes, sha256: file.sha256, signing: manifest.signing, notes, publishedAt });
  const bytes = await fs.readFile(path.join(delivery, name));
  if (bytes.length !== release.bytes || createHash('sha256').update(bytes).digest('hex') !== release.sha256) throw new Error('Candidate installer integrity mismatch');
  await fs.mkdir(directory, { recursive: true, mode: 0o750 });
  const root = await fs.realpath(directory), versionDirectory = path.join(root, release.version);
  // Immutable versions: overwriting a published release is never allowed.
  await fs.mkdir(versionDirectory, { mode: 0o750 });
  try {
    await fs.writeFile(path.join(versionDirectory, name), bytes, { flag: 'wx', mode: 0o640 });
    await fs.writeFile(path.join(versionDirectory, 'manifest.json'), JSON.stringify(release, null, 2), { flag: 'wx', mode: 0o640 });
    const temporary = path.join(root, `latest-${randomUUID()}.tmp`);
    await fs.writeFile(temporary, JSON.stringify({ version: release.version }), { flag: 'wx', mode: 0o640 });
    await fs.rename(temporary, path.join(root, 'latest.json'));
  } catch (error) { await fs.rm(versionDirectory, { recursive: true, force: true }); throw error; }
  return release;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [delivery, verification, directory, ...notes] = process.argv.slice(2);
  if (!delivery || !verification || !path.isAbsolute(directory || '') || !notes.length) throw new Error('Usage: node publish-desktop-release.mjs DELIVERY WINDOWS_REPORT ABSOLUTE_PRIVATE_DIRECTORY RELEASE_NOTES');
  console.log(JSON.stringify(await publishDesktopRelease({ delivery, verification, directory, notes: notes.join(' ') }), null, 2));
}
