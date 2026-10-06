const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const MAX_BYTES = 512 * 1024 * 1024;
function compareVersions(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) throw new Error("Invalid stable release version");
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
function validateRelease(value) {
  if (!value || value.schemaVersion !== 1 || value.product !== "GLINTEX" || value.platform !== "win32" || value.arch !== "x64" || value.channel !== "stable" || !VERSION.test(value.version) || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_BYTES || value.signing !== "unsigned-test-installer" || typeof value.notes !== "string" || value.notes.length > 4000 || !Number.isFinite(Date.parse(value.publishedAt)))
    throw new Error("Invalid GLINTEX Windows release manifest");
  // The server cannot direct the client to another origin, file or command.
  return { schemaVersion: 1, product: "GLINTEX", platform: "win32", arch: "x64", channel: "stable", version: value.version, sourceCommit: value.sourceCommit, sha256: value.sha256, bytes: value.bytes, signing: value.signing, notes: value.notes, publishedAt: value.publishedAt };
}
module.exports = { VERSION, MAX_BYTES, compareVersions, validateRelease };
