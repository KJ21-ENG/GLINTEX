const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { DriverSetup, PACKAGE_NAME, PACKAGE_FILES } = require("../src/driver/setup.cjs");
const { prepareDriverKit, KIT_FILES } = require("../scripts/prepare-driver-kit.cjs");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "GLINTEX user's [path] $()-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const kitDirectory = prepareDriverKit({ destination: path.join(root, "resources", "scale-driver") });
  const manifest = JSON.parse(await fs.readFile(path.join(kitDirectory, "manifest.json")));
  const files = Object.fromEntries(PACKAGE_FILES.map(name => [name, Buffer.from(name === "plser.inf" ? "DriverVer=06/07/2026,5.1.12.0\n[PRO.NTAMD64]\n" : "synthetic " + name)]));
  const archive = Buffer.alloc(270156, 1);
  manifest.files = manifest.files.map(file => ({ ...file, bytes: files[file.name].length, sha256: hash(files[file.name]) }));
  manifest.archive.sha256 = hash(archive);
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); await fs.writeFile(path.join(kitDirectory, "manifest.json"), manifestBytes);
  const calls = [], downloads = [];
  const helper = new DriverSetup({ kitDirectory, userData: path.join(root, "profile"), platform: "win32", arch: "x64", manifestSha256: hash(manifestBytes),
    fetch: async (...args) => { downloads.push(args); return new Response(archive); },
    run: async (exe, args, settings) => {
      calls.push({ exe, args, settings }); assert.equal(settings.shell, undefined);
      assert.doesNotMatch(exe + " " + args.join(" "), /RunAs|pnputil|ExecutionPolicy| -File /i);
      if (exe.endsWith("expand.exe")) { for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(args[2], name), bytes); return { stdout: "extracted" }; }
      assert.ok(exe.endsWith("powershell.exe"));
      const command = Buffer.from(args.at(-1), "base64").toString("utf16le");
      assert.match(command, /Get-AuthenticodeSignature -LiteralPath/); assert.ok(command.includes("Import-Module ([IO.Path]::Combine($PSHOME")); assert.ok(command.includes("Microsoft.PowerShell.Security.psd1")); assert.ok(command.includes("Microsoft.PowerShell.Utility.psd1")); assert.ok(!command.includes("$env:PSModulePath")); assert.doesNotMatch(command, /Invoke-Expression|Start-Process|RunAs|Install-ScaleDriver/i);
      assert.ok(command.includes("user''s [path] $()"), "paths are literal quoted, including apostrophes and metacharacters");
      await options.duringSignature?.(helper, calls);
      return { stdout: JSON.stringify(["plser.cat", "plser64.dll", "plser64.sys"].map(Name => ({ Name, Status: options.invalidSignature ? "NotSigned" : "Valid", Subject: "Microsoft Windows Hardware Compatibility Publisher" }))) };
    }, ...options.overrides });
  const cache = helper.status().cacheDirectory, packageDirectory = path.join(cache, PACKAGE_NAME);
  const offline = async () => { await fs.mkdir(packageDirectory, { recursive: true }); for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(packageDirectory, name), bytes); };
  return { root, helper, files, archive, calls, downloads, offline, cache, packageDirectory, kitDirectory };
}
test("allowlist ships four helper files without old privileged wrapper or vendor cache", async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.kitDirectory, "cache")); await fs.writeFile(path.join(f.kitDirectory, "cache", "driver.sys"), "vendor");
  const destination = prepareDriverKit({ source: f.kitDirectory, destination: path.join(f.root, "distribution") });
  assert.deepEqual((await fs.readdir(destination)).sort(), [...KIT_FILES].sort());
  for (const name of ["Install.cmd", "Install-ScaleDriver.ps1"]) assert.doesNotMatch(await fs.readFile(path.join(destination, name), "utf8"), /-Verb\s+RunAs|pnputil|ExecutionPolicy\s+Bypass|Set-ExecutionPolicy/i);
});
test("download, signature verification and offline reuse never install or execute mutable scripts", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.kitDirectory, "Install-ScaleDriver.ps1"), "throw 'tampered script must never execute'");
  await fs.writeFile(path.join(f.kitDirectory, "Run-DriverSetup.ps1"), "Start-Process attacker -Verb RunAs");
  const result = await f.helper.prepare(); assert.equal(result.success, true); assert.equal(result.installed, false); assert.equal(result.elevationRequested, false);
  assert.equal(result.packageDirectory, f.packageDirectory); assert.match(result.output, /No driver was installed/);
  assert.equal(f.downloads.length, 1); assert.equal(f.downloads[0][1].redirect, "error");
  assert.equal((await f.helper.prepare({ verifyOnly: true })).success, true); assert.equal(f.downloads.length, 1);
  assert.deepEqual(f.calls.map(value => path.win32.basename(value.exe)), ["expand.exe", "powershell.exe", "powershell.exe", "powershell.exe"]);
});
test("missing offline cache and unsupported platforms cannot download or execute", async t => {
  const f = await fixture(t); const result = await f.helper.prepare({ verifyOnly: true }); assert.equal(result.success, false); assert.equal(f.calls.length, 0); assert.equal(f.downloads.length, 0);
  for (const [platform, arch] of [["darwin", "x64"], ["win32", "arm64"], ["win32", "ia32"]]) { f.helper.platform = platform; f.helper.arch = arch; await assert.rejects(f.helper.prepare(), /requires Windows x64/); }
});
test("modified manifest, archive, file, unknown file and unsigned package fail visibly without install", async t => {
  const f = await fixture(t); const original = await fs.readFile(path.join(f.kitDirectory, "manifest.json"));
  await fs.appendFile(path.join(f.kitDirectory, "manifest.json"), " "); assert.match((await f.helper.prepare()).output, /manifest checksum/); assert.equal(f.calls.length, 0);
  await fs.writeFile(path.join(f.kitDirectory, "manifest.json"), original); await fs.mkdir(f.cache, { recursive: true }); await fs.writeFile(path.join(f.cache, PACKAGE_NAME + ".cab"), Buffer.alloc(270156));
  assert.match((await f.helper.prepare()).output, /Cached archive checksum/); assert.equal(f.calls.length, 0);
  await f.offline(); await fs.writeFile(path.join(f.packageDirectory, "plser.sys"), Buffer.from("tampered")); assert.equal((await f.helper.prepare({ verifyOnly: true })).success, false);
  await f.offline(); await fs.writeFile(path.join(f.packageDirectory, "attacker.ps1"), "evil"); assert.match((await f.helper.prepare({ verifyOnly: true })).output, /Unexpected package files/);
  const unsigned = await fixture(t, { invalidSignature: true }); await unsigned.offline(); assert.match((await unsigned.helper.prepare()).output, /Invalid Windows signature/);
});
test("replacement during signature check is detected; later changes never launch privileged code", async t => {
  const f = await fixture(t, { duringSignature: async helper => fs.writeFile(path.join(helper.status().cacheDirectory, PACKAGE_NAME, "plser.inf"), "replaced") });
  await f.offline(); const result = await f.helper.prepare({ verifyOnly: true }); assert.equal(result.success, false); assert.match(result.output, /Checksum mismatch/); assert.equal(f.calls.length, 1);
  const safe = await fixture(t); await safe.offline(); assert.equal((await safe.helper.prepare()).success, true);
  await fs.writeFile(path.join(safe.packageDirectory, "plser.inf"), "post-check replacement");
  assert.equal(safe.calls.length, 1, "preparation has no automatic installation continuation");
  assert.equal((await safe.helper.prepare({ verifyOnly: true })).success, false); assert.equal(safe.calls.length, 1);
});
test("linked package files/cache paths and excessive download size are rejected", async t => {
  const f = await fixture(t); await f.offline(); await fs.unlink(path.join(f.packageDirectory, "plser.sys")); await fs.symlink(path.join(f.packageDirectory, "plser64.sys"), path.join(f.packageDirectory, "plser.sys"));
  assert.equal((await f.helper.prepare({ verifyOnly: true })).success, false); assert.equal(f.calls.length, 0);
  const linked = await fixture(t); await fs.mkdir(path.dirname(linked.cache), { recursive: true }); await fs.symlink(linked.root, linked.cache, "junction"); assert.match((await linked.helper.prepare()).output, /must not be a link/);
  const oversized = await fixture(t, { overrides: { fetch: async () => new Response(Buffer.alloc(270157)) } }); assert.match((await oversized.helper.prepare()).output, /exceeds pinned size/); assert.equal(oversized.calls.length, 0);
});
test("normal preparation quarantines invalid entries, preserves link targets and keeps verification cache unchanged", async t => {
  for (const kind of ["partial", "file", "link"]) {
    const f = await fixture(t); await fs.mkdir(f.cache, { recursive: true });
    const outside = path.join(f.root, "outside.txt"); await fs.writeFile(outside, "leave untouched");
    if (kind === "partial") { await fs.mkdir(f.packageDirectory); await fs.writeFile(path.join(f.packageDirectory, "plser.inf"), "partial"); }
    if (kind === "file") await fs.writeFile(f.packageDirectory, "wrong entry");
    if (kind === "link") await fs.symlink(outside, f.packageDirectory);
    const before = (await fs.readdir(f.cache)).sort();
    assert.equal((await f.helper.prepare({ verifyOnly: true })).success, false);
    assert.deepEqual((await fs.readdir(f.cache)).sort(), before);
    assert.equal(f.downloads.length, 0);
    const result = await f.helper.prepare(); assert.equal(result.success, true); assert.equal(result.installed, false);
    assert.equal(f.downloads.length, 1); assert.equal(await fs.readFile(outside, "utf8"), "leave untouched");
    const quarantined = (await fs.readdir(f.cache)).filter(name => name.startsWith("invalid-")); assert.equal(quarantined.length, 1);
    if (kind === "link") assert.ok((await fs.lstat(path.join(f.cache, quarantined[0]))).isSymbolicLink());
    assert.equal((await f.helper.prepare({ verifyOnly: true })).success, true);
  }
});
test("concurrent preparation is refused and download failure reports no driver changes", async t => {
  let finish; const f = await fixture(t, { overrides: { fetch: () => new Promise(resolve => { finish = resolve; }) } });
  const first = f.helper.prepare(); await assert.rejects(f.helper.prepare(), /already running/);
  while (!finish) await new Promise(resolve => setImmediate(resolve)); finish(new Response("bad"));
  const result = await first; assert.equal(result.success, false); assert.match(result.output, /No driver was installed or changed/); assert.equal(f.helper.running, false);
});
