const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { DriverSetup } = require("../src/driver/setup.cjs");
const { prepareDriverKit, KIT_FILES } = require("../scripts/prepare-driver-kit.cjs");

test("packaging allowlist excludes proprietary offline cache and unknown files", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "glintex-kit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), destination = path.join(root, "resources", "scale-driver");
  await fs.mkdir(path.join(source, "cache"), { recursive: true });
  for (const file of KIT_FILES) await fs.writeFile(path.join(source, file), file);
  await fs.writeFile(path.join(source, "cache", "driver.sys"), "vendor binary");
  await fs.writeFile(path.join(source, "offline.zip"), "vendor binary");
  prepareDriverKit({ source, destination });
  assert.deepEqual((await fs.readdir(destination)).sort(), [...KIT_FILES, "Run-DriverSetup.ps1"].sort());
});

test("packaged paths with spaces and apostrophes stay separate fixed arguments; results survive failure/restart", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "GLINTEX user's path-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const kitDirectory = prepareDriverKit({ destination: path.join(root, "resources", "scale-driver") });
  let code = 0, calls = 0;
  const helper = new DriverSetup({ kitDirectory, userData: path.join(root, "profile"), platform: "win32", arch: "x64", run: async (exe, args, options) => {
    calls++;
    assert.ok(exe.endsWith("\\WindowsPowerShell\\v1.0\\powershell.exe"));
    assert.equal(options.shell, undefined);
    assert.equal(args[args.indexOf("-KitDirectory") + 1], kitDirectory);
    assert.equal(args[args.indexOf("-Mode") + 1], "Install");
    await fs.writeFile(args[args.indexOf("-LogPath") + 1], "Verified; actual COM port reported\n");
    if (code) throw Object.assign(new Error("failed"), { code });
  } });
  assert.equal((await helper.install()).success, true);
  code = 3010;
  assert.equal((await helper.install()).restartRequired, true);
  code = 1;
  const failure = await helper.install();
  assert.equal(failure.success, false);
  assert.match(failure.output, /actual COM port/);
  assert.equal(calls, 3);
});

test("unsupported platforms, missing resources and concurrent setup cannot launch", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "glintex-platform-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const kitDirectory = prepareDriverKit({ destination: path.join(root, "resources", "scale-driver") });
  for (const [platform, arch, directory] of [["darwin", "x64", kitDirectory], ["win32", "arm64", kitDirectory], ["win32", "x64", path.join(root, "missing")]]) {
    const helper = new DriverSetup({ kitDirectory: directory, userData: root, platform, arch, run: () => assert.fail("must not launch") });
    await assert.rejects(helper.install(), /requires Windows x64/);
  }
  let finish;
  const helper = new DriverSetup({ kitDirectory, userData: root, platform: "win32", arch: "x64", run: () => new Promise(resolve => { finish = resolve; }) });
  const first = helper.install();
  await assert.rejects(helper.install(), /already running/);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  finish(); await first;
});
