// Several equal application windows: registry, cap, broadcasts and the only kind of
// target a renderer may ask to open.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { WindowRegistry, appWindowUrl } = require("../src/windows.cjs");
const { assertSender } = require("../src/security.cjs");
const origin = "https://app.glintex.in";

function fakeWindow(url) {
  const handlers = {};
  const w = {
    url, destroyed: false, sent: [], bounds: { x: 10, y: 20, width: 1360, height: 900 },
    webContents: { send: (channel, payload) => w.sent.push([channel, payload]), mainFrame: { url } },
    isDestroyed: () => w.destroyed,
    getBounds: () => w.bounds,
    on: (name, fn) => { handlers[name] = fn; },
    focus: () => handlers.focus(),
    close: () => { w.destroyed = true; handlers.closed(); },
  };
  w.webContents.isDestroyed = () => w.destroyed;
  return w;
}

test("windows open with the same factory, cascade from the focused one and are capped", () => {
  const created = [];
  const registry = new WindowRegistry({ create: ({ url, bounds }) => { const w = fakeWindow(url); w.created = bounds; created.push(w); return w; }, max: 3 });
  const first = registry.open(origin + "/");
  assert.equal(first.created, null);
  first.focus();
  const second = registry.open(origin + "/app/holo");
  assert.deepEqual(second.created, { x: 42, y: 52, width: 1360, height: 900 });
  assert.equal(registry.count(), 2);
  assert.equal(registry.primary(), first);
  second.focus();
  assert.equal(registry.focused(), second);
  registry.open(origin + "/");
  assert.throws(() => registry.open(origin + "/"), /At most 3 GLINTEX windows/);
  second.close();
  assert.equal(registry.count(), 2);
  assert.equal(registry.focused(), created[2], "focus falls back to the newest live window");
  assert.equal(registry.isLast(first), false);
  created[2].close();
  assert.equal(registry.isLast(first), true);
});

test("broadcasts reach every live window and the sender check accepts any of them", () => {
  const registry = new WindowRegistry({ create: ({ url }) => fakeWindow(url) });
  const a = registry.open(origin + "/");
  const b = registry.open(origin + "/app/coning");
  registry.broadcast("glintex:scale-status", { status: "connected" });
  assert.deepEqual(a.sent, [["glintex:scale-status", { status: "connected" }]]);
  assert.deepEqual(b.sent, [["glintex:scale-status", { status: "connected" }]]);
  assert.ok(registry.has(b.webContents));
  assert.doesNotThrow(() => assertSender({ sender: b.webContents, senderFrame: b.webContents.mainFrame }, registry.contents(), origin));
  assert.doesNotThrow(() => assertSender({ sender: a.webContents, senderFrame: a.webContents.mainFrame }, a.webContents, origin));
  const stranger = fakeWindow(origin + "/");
  assert.throws(() => assertSender({ sender: stranger.webContents, senderFrame: stranger.webContents.mainFrame }, registry.contents(), origin), /Untrusted/);
  b.close();
  assert.equal(registry.has(b.webContents), false);
  assert.throws(() => assertSender({ sender: b.webContents, senderFrame: b.webContents.mainFrame }, registry.contents(), origin), /Untrusted/);
  registry.broadcast("glintex:update-status", { state: "current" });
  assert.equal(b.sent.length, 1, "closed windows receive nothing");
});

test("a renderer may only open application pages of its own origin", () => {
  assert.equal(appWindowUrl("/", origin), origin + "/");
  assert.equal(appWindowUrl("/app/holo-issue?tab=2", origin), origin + "/app/holo-issue?tab=2");
  for (const bad of ["", "app/holo", "//evil.test/x", "https://evil.test/", "/api/auth/me", "javascript:alert(1)", "/a b", "\\\\evil", 123, null, "/" + "x".repeat(3000)])
    assert.throws(() => appWindowUrl(bad, origin), /application path/, String(bad));
});
