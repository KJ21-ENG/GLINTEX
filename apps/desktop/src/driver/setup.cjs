const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { randomUUID, createHash } = require("node:crypto");
const { promisify } = require("node:util");

const MANIFEST_SHA256 = "6ece02cbcf3e84a1a1168a11652cb22a63bac358c12e6a77f2804fd77dad4f67";
const PACKAGE_NAME = "prolific-5.1.12.0-windows-10-x64";
const PACKAGE_FILES = ["plser.cat", "plser.dll", "plser.inf", "plser.sys", "plser64.dll", "plser64.sys"];
const signatureFiles = ["plser.cat", "plser64.dll", "plser64.sys"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const literal = value => "'" + value.replaceAll("'", "''") + "'";

// Preparation inherits the caller's token. No script, driver installation,
// elevation verb or execution-policy override is executed by the application.
// These checks authenticate prepared data at verification time, not writable app
// code as an administrator trust root. Windows owns the later manual installation.
class DriverSetup {
  constructor({ kitDirectory, userData, platform = process.platform, arch = process.arch,
    run = promisify(execFile), fetch = globalThis.fetch, manifestSha256 = MANIFEST_SHA256 }) {
    Object.assign(this, { kitDirectory, userData, platform, arch, run, fetch, manifestSha256 });
    this.running = false;
  }
  status() {
    const bundled = ["Install.cmd", "Install-ScaleDriver.ps1", "manifest.json", "README.md"].every(file => existsSync(path.join(this.kitDirectory, file)));
    return {
      bundled, available: this.platform === "win32" && this.arch === "x64" && bundled,
      supported: "Windows 10 x64 · BAFO BF-812 / Prolific PL2303GT · USB\\VID_067B&PID_23A3&REV_0305",
      cacheDirectory: path.join(this.userData, "scale-driver", "cache"), preparationOnly: true,
    };
  }
  async regularFile(file, maximum) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error("Unexpected file or size: " + path.basename(file));
    const handle = await fs.open(file, "r");
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > maximum) throw new Error("File changed during verification: " + path.basename(file));
      const bytes = Buffer.alloc(maximum + 1); let count = 0;
      while (count < bytes.length) {
        const { bytesRead } = await handle.read(bytes, count, bytes.length - count, null);
        if (!bytesRead) break;
        count += bytesRead;
      }
      if (count > maximum) throw new Error("File exceeds pinned size: " + path.basename(file));
      return bytes.subarray(0, count);
    } finally { await handle.close(); }
  }
  async directory(directory) {
    await fs.mkdir(directory).catch(error => { if (error.code !== "EEXIST") throw error; });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Driver cache directory must not be a link.");
  }
  async manifest() {
    const bytes = await this.regularFile(path.join(this.kitDirectory, "manifest.json"), 16384);
    if (hash(bytes) !== this.manifestSha256) throw new Error("Bundled driver manifest checksum mismatch.");
    const manifest = JSON.parse(bytes);
    if (manifest.schemaVersion !== 1 || manifest.driverVersion !== "5.1.12.0" ||
      manifest.archive.bytes !== 270156 || new URL(manifest.archive.url).origin !== "https://catalog.s.download.windowsupdate.com" ||
      JSON.stringify(manifest.files.map(file => file.name).sort()) !== JSON.stringify([...PACKAGE_FILES].sort())) throw new Error("Unsupported driver manifest.");
    return manifest;
  }
  async checkFiles(directory, manifest) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Package directory must not be a link.");
    const names = (await fs.readdir(directory)).sort();
    if (JSON.stringify(names) !== JSON.stringify([...PACKAGE_FILES].sort())) throw new Error("Unexpected package files.");
    for (const file of manifest.files) {
      const bytes = await this.regularFile(path.join(directory, file.name), file.bytes);
      if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error("Checksum mismatch: " + file.name);
    }
    const bytes = await this.regularFile(path.join(directory, "plser.inf"), 16384);
    const inf = bytes.subarray(0, 2).equals(Buffer.from([255, 254])) ? bytes.toString("utf16le") : bytes.toString("utf8");
    if (!/DriverVer\s*=\s*06\/07\/2026,5\.1\.12\.0/i.test(inf) || !/\[PRO\.NTAMD64\]/i.test(inf)) throw new Error("Unexpected driver version or architecture.");
  }
  async verify(directory, manifest) {
    await this.checkFiles(directory, manifest);
    const files = signatureFiles.map(name => literal(path.join(directory, name))).join(",");
    const command = "$ErrorActionPreference='Stop'; @(" + files + ") | ForEach-Object { $s=Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $_; [pscustomobject]@{Name=[IO.Path]::GetFileName($_);Status=[string]$s.Status;Subject=[string]$s.SignerCertificate.Subject} } | ConvertTo-Json -Compress";
    const executable = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const { stdout } = await this.run(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")], { windowsHide: true, timeout: 60000, maxBuffer: 65536 });
    const signatures = JSON.parse(stdout.replace(/^\uFEFF/, "").trim());
    if (!Array.isArray(signatures) || signatures.length !== signatureFiles.length) throw new Error("Missing Windows signature results.");
    for (const name of signatureFiles) {
      const signature = signatures.find(value => value.Name === name);
      const publisher = name === "plser.cat" ? /Microsoft Windows Hardware Compatibility Publisher/ : /Microsoft Windows Hardware Compatibility Publisher|Prolific Technology Inc/;
      if (signature?.Status !== "Valid" || !publisher.test(signature.Subject)) throw new Error("Invalid Windows signature: " + name);
    }
    // Replacement during verification is detected. Nothing installs afterward;
    // Windows revalidates vendor signatures if the operator selects this package.
    await this.checkFiles(directory, manifest);
  }
  async download(manifest, destination) {
    const response = await this.fetch(manifest.archive.url, { redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw new Error("Microsoft driver download failed.");
    const length = response.headers.get("content-length");
    if (length && Number(length) !== manifest.archive.bytes) throw new Error("Unexpected archive download size.");
    const chunks = []; let received = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > manifest.archive.bytes) throw new Error("Archive exceeds pinned size.");
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    if (received !== manifest.archive.bytes || hash(bytes) !== manifest.archive.sha256) throw new Error("Downloaded archive checksum mismatch.");
    await fs.writeFile(destination, bytes, { flag: "wx" });
  }
  async prepare({ verifyOnly = false } = {}) {
    if (!this.status().available) throw new Error("Driver preparation requires Windows x64; the package supports Windows 10 and the listed adapter only.");
    if (this.running) throw new Error("Driver preparation is already running.");
    this.running = true;
    let logPath, temporary;
    try {
      await this.directory(this.userData);
      const root = path.join(this.userData, "scale-driver"); await this.directory(root);
      logPath = path.join(root, `prepare-${Date.now()}-${randomUUID()}.log`);
      const manifest = await this.manifest(), cache = this.status().cacheDirectory;
      await this.directory(cache);
      const packageDirectory = path.join(cache, PACKAGE_NAME);
      if (!existsSync(packageDirectory)) {
        if (verifyOnly) throw new Error("No cached driver package. Prepare it on an internet-connected Windows PC first.");
        temporary = path.join(cache, "prepare-" + randomUUID()); await this.directory(temporary);
        const archive = path.join(temporary, "driver.cab"), cachedArchive = path.join(cache, PACKAGE_NAME + ".cab");
        if (existsSync(cachedArchive)) {
          const bytes = await this.regularFile(cachedArchive, manifest.archive.bytes);
          if (bytes.length !== manifest.archive.bytes || hash(bytes) !== manifest.archive.sha256) throw new Error("Cached archive checksum mismatch.");
          await fs.writeFile(archive, bytes, { flag: "wx" });
        } else await this.download(manifest, archive);
        const extracted = path.join(temporary, "package"); await this.directory(extracted);
        const expand = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "expand.exe");
        await this.run(expand, ["-F:*", archive, extracted], { windowsHide: true, timeout: 60000, maxBuffer: 65536 });
        await this.verify(extracted, manifest);
        await fs.rename(extracted, packageDirectory);
      }
      await this.verify(packageDirectory, manifest);
      const output = `Verified Prolific ${manifest.driverVersion}. No driver was installed or changed.\nPackage: ${packageDirectory}\nFor Windows 10 x64 and USB\\VID_067B&PID_23A3&REV_0305 only.\nIf the adapter has no working COM port, use Device Manager > adapter > Update driver > Browse my computer for drivers and select this folder. Windows may require an administrator. Leave a working driver unchanged.`;
      await fs.writeFile(logPath, output, { flag: "wx" });
      return { success: true, installed: false, elevationRequested: false, preparationOnly: true, driverVersion: manifest.driverVersion, packageDirectory, logPath, output };
    } catch (error) {
      const output = "Driver preparation failed. No driver was installed or changed.\n" + error.message;
      if (logPath) await fs.writeFile(logPath, output, { flag: "wx" }).catch(() => {});
      return { success: false, installed: false, elevationRequested: false, preparationOnly: true, logPath, output };
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
      this.running = false;
    }
  }
}
module.exports = { DriverSetup, MANIFEST_SHA256, PACKAGE_NAME, PACKAGE_FILES };
