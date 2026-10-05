const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { compareVersions, validateRelease, MAX_BYTES } = require("./protocol.cjs");
const PREFIX = "/api/desktop/releases/windows-x64";
async function hashFile(file) {
  const hash = crypto.createHash("sha256");
  const handle = await fs.open(file, "r");
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); }
  finally { await handle.close(); }
  return hash.digest("hex");
}
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function launchCommand({ file, release, marker, parentPid, silent = false, statusFile }) {
  // Fixed PowerShell command, no renderer paths/arguments; rehash after app exit.
  return `$ErrorActionPreference='Stop'; function Report([string]$state,[string]$message=''){ @{state=$state; message=$message; version=${quote(release.version)}; parentPid=${parentPid}; at=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress | Set-Content -LiteralPath ${quote(statusFile)} -Encoding UTF8 }; try { Report 'waiting'; $deadline=(Get-Date).AddSeconds(120); while(Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue){if(-not(Test-Path -LiteralPath ${quote(marker)}) -or (Get-Date) -gt $deadline){Report 'cancelled'; exit 2}; Start-Sleep -Milliseconds 250}; if(-not(Test-Path -LiteralPath ${quote(marker)})){Report 'cancelled'; exit 2}; Report 'parent-closed'; if((Get-Item -LiteralPath ${quote(file)}).Length -ne ${release.bytes} -or (Get-FileHash -LiteralPath ${quote(file)} -Algorithm SHA256).Hash -ine '${release.sha256}'){throw 'Update integrity check failed'}; Remove-Item -LiteralPath ${quote(marker)}; Report 'verified'; $installer=Start-Process -FilePath ${quote(file)} -WorkingDirectory ${quote(path.win32.dirname(file))}${silent ? " -ArgumentList '--silent'" : ""} -PassThru -Wait; if($installer.ExitCode -ne 0){throw ('Installer exited '+$installer.ExitCode)}; Report 'completed' } catch { Report 'failed' $_.Exception.Message; exit 1 }`;
}
async function launchAfterExit(options) {
  const statusFile = path.join(path.dirname(options.marker), 'install-status.json');
  await fs.rm(statusFile, { force: true });
  const command = launchCommand({ ...options, statusFile });
  const executable = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const child = spawn(executable, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], { detached: true, windowsHide: true, stdio: "ignore" });
  // A successful spawn does not prove PowerShell parsed/started the helper. Keep
  // the application open until the helper acknowledges it is waiting for us.
  let failure;
  child.once('error', error => { failure = error; });
  child.once('exit', code => { failure = new Error(`Update helper exited before acknowledgement (${code})`); });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    try {
      const text = await fs.readFile(statusFile, 'utf8');
      if (text.length <= 4096) {
        const status = JSON.parse(text.replace(/^\uFEFF/, ''));
        if (status.state === 'waiting' && status.parentPid === options.parentPid && status.version === options.release.version) { child.unref(); return; }
        if (status.state === 'failed') throw new Error('The Windows update helper could not start. GLINTEX remains open.');
      }
    } catch (error) { if (!['ENOENT'].includes(error.code) && !(error instanceof SyntaxError)) { child.kill(); throw error; } }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error('The Windows update helper did not acknowledge startup. GLINTEX remains open.');
}
class UpdateController extends EventEmitter {
  constructor({ version, directory, fetch, origin = "https://app.glintex.in", supported = process.platform === "win32" && process.arch === "x64", fixture = false, launch = launchAfterExit, clock = Date.now }) {
    super();
    if (origin !== "https://app.glintex.in" && !(fixture && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin))) throw new Error("Update origin must be the trusted GLINTEX HTTPS server");
    compareVersions(version, version);
    Object.assign(this, { version, directory, fetch, origin, supported, launch, clock });
    this.data = { state: supported ? "idle" : "unsupported", installedVersion: version, release: null, progress: 0, message: supported ? "Updates are checked after sign-in." : "Updates require the installed Windows x64 application." };
    this.marker = path.join(directory, "install-approved.json");
  }
  status() { return structuredClone(this.data); }
  set(values) { Object.assign(this.data, values); this.emit("status", this.status()); return this.status(); }
  async initialize() {
    if (!this.supported) return this;
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.rm(this.marker, { force: true }); // Arming never survives a restart.
    try {
      const release = validateRelease(JSON.parse(await fs.readFile(path.join(this.directory, "ready.json"), "utf8")));
      if (compareVersions(release.version, this.version) > 0 && await this.verified(release)) this.set({ state: "ready", release, message: "Previously downloaded update verified. Installation requires your choice." });
    } catch { /* Missing/damaged cached metadata is never installation authority. */ }
    try {
      const text = await fs.readFile(path.join(this.directory, 'install-status.json'), 'utf8');
      const status = text.length <= 4096 && JSON.parse(text.replace(/^\uFEFF/, ''));
      if (status?.state === 'failed' && status.version === this.data.release?.version) this.set({ state: 'error', prompt: true, message: 'The previous update did not complete. GLINTEX is still on the installed version. Check for updates and retry; local details are in updates/install-status.json.' });
    } catch { /* Diagnostic status never supplies a command or install authority. */ }
    return this;
  }
  file(release = this.data.release) { return path.join(this.directory, `GLINTEX-${release.version}-x64-Setup.exe`); }
  async verified(release = this.data.release) {
    if (!release) return false;
    try { return (await fs.stat(this.file(release))).size === release.bytes && await hashFile(this.file(release)) === release.sha256; }
    catch { return false; }
  }
  async request(relative, signal) {
    const url = this.origin + PREFIX + relative;
    const response = await this.fetch(url, { credentials: "include", redirect: "error", bypassCustomProtocolHandlers: true, signal });
    if (response.url && response.url !== url) throw new Error("Update response changed the trusted URL");
    if (response.status === 401 || response.status === 403) throw Object.assign(new Error("Sign in again to check or download private updates."), { state: "signin" });
    if (response.status === 404 || response.status === 503) throw Object.assign(new Error("Private update hosting is not enabled or is unavailable."), { state: "unavailable" });
    if (!response.ok) throw new Error("Update server returned " + response.status);
    return response;
  }
  check({ manual = false } = {}) {
    if (!this.supported) return Promise.resolve(this.status());
    if (this.checking) return this.checking;
    if (this.arming || ["downloading", "armed", "installing"].includes(this.data.state)) return Promise.resolve(this.status());
    this.checking = this.performCheck(manual).finally(() => { this.checking = null; });
    return this.checking;
  }
  async performCheck(manual) {
    this.set({ state: "checking", ...(manual ? { prompt: true } : {}), message: "Checking the private GLINTEX release service…" });
    try {
      const response = await this.request("/latest", AbortSignal.timeout(10000));
      if (response.status === 204) return this.set({ state: "current", release: null, checkedAt: this.clock(), message: "No published update is available." });
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > 16384) throw new Error("Update manifest is too large"); chunks.push(Buffer.from(chunk)); }
      const text = Buffer.concat(chunks).toString("utf8");
      const release = validateRelease(JSON.parse(text));
      if (compareVersions(release.version, this.version) <= 0) return this.set({ state: "current", release: null, checkedAt: this.clock(), message: "No newer version is available." });
      const ready = await this.verified(release);
      return this.set({ state: ready ? "ready" : "available", release, checkedAt: this.clock(), prompt: manual || this.deferredVersion !== release.version || this.clock() >= (this.deferUntil || 0), message: `GLINTEX ${release.version} is available.` });
    } catch (error) { return this.set({ state: error.state || "error", checkedAt: this.clock(), message: error.state ? error.message : "Could not check for updates. Check your connection and retry." }); }
  }
  download() {
    if (this.downloading) return this.downloading;
    if (this.arming || !this.supported || !this.data.release || !["available", "ready", "error"].includes(this.data.state)) return Promise.reject(new Error("Check for a newer release before downloading"));
    this.downloading = this.performDownload().finally(() => { this.downloading = null; this.abort = null; });
    return this.downloading;
  }
  async performDownload() {
    const release = validateRelease(this.data.release);
    if (await this.verified(release)) return this.set({ state: "ready", message: "Downloaded installer verified." });
    const partial = this.file(release) + ".part";
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort?.abort(), 10 * 60 * 1000);
    this.set({ state: "downloading", progress: 0, message: "Downloading the private installer. Work can continue." });
    let handle;
    try {
      const response = await this.request(`/${release.version}/setup`, this.abort.signal);
      const length = response.headers?.get("content-length");
      if (length && Number(length) !== release.bytes) throw new Error("Installer length differs from the release manifest");
      handle = await fs.open(partial, "w", 0o600);
      let bytes = 0; const hash = crypto.createHash("sha256");
      for await (const value of response.body) {
        if (this.abort.signal.aborted) throw new Error("Download cancelled");
        const chunk = Buffer.from(value); bytes += chunk.length;
        if (bytes > release.bytes || bytes > MAX_BYTES) throw new Error("Installer exceeded its declared size");
        hash.update(chunk); await handle.writeFile(chunk);
        this.set({ progress: Math.floor(bytes * 100 / release.bytes) });
      }
      if (bytes !== release.bytes || hash.digest("hex") !== release.sha256) throw new Error("Installer checksum verification failed; nothing will be installed");
      await handle.sync(); await handle.close(); handle = null;
      await fs.rename(partial, this.file(release));
      await fs.writeFile(path.join(this.directory, "ready.json"), JSON.stringify(release), { mode: 0o600 });
      return this.set({ state: "ready", progress: 100, message: "Installer verified from the authenticated GLINTEX server. Unsigned test installer; installation is optional." });
    } catch (error) {
      this.set({ state: this.cancelled ? "available" : error.state || "error", message: this.cancelled ? "Download cancelled. Retry when ready." : error.message });
      if (!this.cancelled) throw error;
      return this.status();
    } finally { clearTimeout(timeout); if (handle) await handle.close(); await fs.rm(partial, { force: true }); this.cancelled = false; }
  }
  cancel() { if (this.abort) { this.cancelled = true; this.abort.abort(); } return this.status(); }
  later() { this.deferredVersion = this.data.release?.version; this.deferUntil = this.clock() + 6 * 60 * 60 * 1000; return this.set({ prompt: false }); }
  arm() {
    if (this.arming) return this.arming;
    this.arming = this.performArm().finally(() => { this.arming = null; }); return this.arming;
  }
  async performArm() {
    const generation = this.choiceGeneration || 0;
    if (this.checking || !this.supported || !["ready", "armed"].includes(this.data.state) || !await this.verified()) throw new Error("A verified newer installer must be downloaded first");
    if (generation !== (this.choiceGeneration || 0)) throw new Error("Installation choice cancelled");
    return this.set({ state: "armed", prompt: false, message: "Update selected. Finish work, disconnect the scale, then close GLINTEX to install. Cancel this choice to keep the current version." });
  }
  async disarm() { this.choiceGeneration = (this.choiceGeneration || 0) + 1; await fs.rm(this.marker, { force: true }); return this.set({ state: await this.verified() ? "ready" : "available", message: "Installation cancelled. The current application remains open." }); }
  installAfterExit(options) {
    if (this.installing) return this.installing;
    this.installing = this.performInstall(options).finally(() => { this.installing = null; });
    return this.installing;
  }
  async performInstall({ safety, parentPid = process.pid, silent = false }) {
    const generation = this.choiceGeneration || 0;
    if (this.data.state !== "armed") throw new Error("Update was not selected");
    const blocked = await safety();
    if (blocked) throw new Error(blocked);
    if (!await this.verified()) throw new Error("Cached installer failed verification; installation stopped");
    if (this.data.state !== "armed" || generation !== (this.choiceGeneration || 0)) throw new Error("Installation choice cancelled");
    await fs.writeFile(this.marker, JSON.stringify({ version: this.data.release.version, parentPid }), { mode: 0o600 });
    this.set({ state: "installing", message: "Installer will open only after GLINTEX closes. Windows will not be restarted." });
    try { await this.launch({ file: this.file(), release: this.data.release, marker: this.marker, parentPid, silent }); }
    catch (error) { await this.disarm(); throw error; }
    return this.status();
  }
}
module.exports = { UpdateController, hashFile, launchAfterExit, launchCommand };
