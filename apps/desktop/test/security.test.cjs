const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  assertSender,
  apiTarget,
  createAppHandler,
  isAppUrl,
} = require("../src/security.cjs");
const { SettingsStore } = require("../src/settings.cjs");
const origin = "https://app.glintex.in";
test("IPC rejects foreign contents, subframes, navigated and API senders", () => {
  const main = { url: origin + "/" };
  const wc = { mainFrame: main, isDestroyed: () => false };
  const event = { sender: wc, senderFrame: main };
  assert.doesNotThrow(() => assertSender(event, wc, origin));
  for (const e of [
    { sender: {}, senderFrame: main },
    { sender: wc, senderFrame: { url: origin + "/" } },
    { sender: wc, senderFrame: null },
  ])
    assert.throws(() => assertSender(e, wc, origin));
  for (const url of [
    "https://evil.test/",
    "https://app.glintex.in/api/auth/login",
    "file:///tmp/a",
  ]) {
    main.url = url;
    assert.throws(() => assertSender(event, wc, origin));
  }
});
test("API cannot escape first-party /api namespace", () => {
  assert.equal(
    apiTarget(origin + "/api/health", origin),
    origin + "/api/health",
  );
  for (const x of [
    "https://evil.test/api/a",
    origin + "/assets/x",
    origin + "/api/%2fsecret",
    origin + "/api/../../foo",
  ])
    assert.throws(() => apiTarget(x, origin));
  assert.equal(isAppUrl(origin + "/api/auth", origin), false);
});
test("bundled routes, missing assets, origin blocking and strict API forwarding", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "glintex-ui-"));
  await fs.writeFile(path.join(dir, "index.html"), "<h1>local</h1>");
  let calls = [];
  const handler = createAppHandler({
    origin,
    uiDirectory: dir,
    fetchApi: async (url, options) => {
      calls.push({ url, options });
      return new Response('{"ok":true}', {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.match(
    await (await handler(new Request(origin + "/settings"))).text(),
    /local/,
  );
  assert.equal(
    (await handler(new Request(origin + "/assets/missing.js"))).status,
    404,
  );
  assert.equal((await handler(new Request("https://evil.test/"))).status, 403);
  assert.equal(
    (await handler(new Request(origin + "/api/health"))).status,
    200,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.credentials, "include");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.bypassCustomProtocolHandlers, true);
  const foreign = new Request(origin + "/api/health");
  foreign.initiatorOrigin = "https://evil.test";
  assert.equal((await handler(foreign)).status, 403);
  await fs.rm(dir, { recursive: true });
});
test("settings persist across upgrades without sharing credentials", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "glintex-settings-"));
  let s = await new SettingsStore(dir).load();
  await s.set("scale", { path: "COM5" });
  await s.set("startAtLogin", true);
  s = await new SettingsStore(dir).load();
  assert.equal(s.get("scale").path, "COM5");
  assert.equal(s.get("startAtLogin"), true);
  await assert.rejects(s.set("token", "bad"));
  await fs.rm(dir, { recursive: true });
});

test("failed settings writes never activate an unpersisted profile", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "glintex-settings-"));
  const s = await new SettingsStore(dir).load();
  await s.set("printer", { printerName: "A" });
  s.file = path.join(dir, "missing", "settings.json");
  await assert.rejects(s.set("printer", { printerName: "B" }));
  assert.equal(s.get("printer").printerName, "A");
  await fs.rm(dir, { recursive: true });
});
