import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
export function validateDesktopRelease(value) {
  if (!value || value.schemaVersion !== 1 || value.product !== 'GLINTEX' || value.platform !== 'win32' || value.arch !== 'x64' || value.channel !== 'stable' || !VERSION.test(value.version) || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 512 * 1024 * 1024 || value.signing !== 'unsigned-test-installer' || typeof value.notes !== 'string' || value.notes.length > 4000 || !Number.isFinite(Date.parse(value.publishedAt))) throw new Error('Invalid desktop release');
  return { schemaVersion: 1, product: 'GLINTEX', platform: 'win32', arch: 'x64', channel: 'stable', version: value.version, sourceCommit: value.sourceCommit, sha256: value.sha256, bytes: value.bytes, signing: value.signing, notes: value.notes, publishedAt: value.publishedAt };
}
async function boundedFile(root, relative) {
  const file = path.join(root, relative), resolved = await fs.realpath(file);
  if (!resolved.startsWith(root + path.sep) || (await fs.lstat(file)).isSymbolicLink()) throw new Error('Release file outside private directory');
  return resolved;
}
export function createDesktopReleaseRouter({ authenticate, getDirectory = () => process.env.GLINTEX_DESKTOP_RELEASE_DIRECTORY }) {
  if (typeof authenticate !== 'function') throw new Error('Release authentication is mandatory');
  const router = Router();
  router.use((_req, res, next) => { res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
  router.use(authenticate);
  const root = async () => {
    const directory = getDirectory(); if (!directory) throw new Error('Desktop updates are not configured');
    return fs.realpath(directory);
  };
  const json = async file => { if ((await fs.stat(file)).size > 16384) throw new Error('Release metadata too large'); return JSON.parse(await fs.readFile(file, 'utf8')); };
  const manifest = async (directory, version) => {
    if (!VERSION.test(version)) throw new Error('Invalid release version');
    const release = validateDesktopRelease(await json(await boundedFile(directory, path.join(version, 'manifest.json'))));
    if (release.version !== version) throw new Error('Release directory/version mismatch');
    return release;
  };
  router.get('/windows-x64/latest', async (_req, res) => {
    try {
      const directory = await root();
      let latest; try { latest = await json(await boundedFile(directory, 'latest.json')); } catch (e) { if (e.code === 'ENOENT') return res.status(204).end(); throw e; }
      return res.json(await manifest(directory, latest.version));
    } catch { return res.status(503).json({ error: 'desktop_release_unavailable' }); }
  });
  router.get('/windows-x64/:version/setup', async (req, res) => {
    if (!VERSION.test(req.params.version)) return res.status(404).end();
    try {
      const directory = await root(), release = await manifest(directory, req.params.version);
      const file = await boundedFile(directory, path.join(release.version, `GLINTEX-${release.version}-x64-Setup.exe`));
      const handle = await fs.open(file, 'r');
      try {
        if ((await handle.stat()).size !== release.bytes) throw new Error('Installer size mismatch');
        const hash = createHash('sha256');
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        if (hash.digest('hex') !== release.sha256) throw new Error('Installer checksum mismatch');
      } finally { await handle.close(); }
      res.set('Content-Type', 'application/octet-stream');
      return res.download(file, `GLINTEX-${release.version}-x64-Setup.exe`, error => { if (error && !res.headersSent) res.status(503).end(); });
    } catch { return res.status(503).json({ error: 'desktop_release_unavailable' }); }
  });
  return router;
}
