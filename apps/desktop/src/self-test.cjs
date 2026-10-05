// Explicit offline self-test. Always isolated from production cookies/settings.
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { validateRelease } = require("./updates/protocol.cjs");
const TEST_USER = {
  id: "fixture-operator",
  username: "fixture-operator",
  displayName: "Test operator",
  isAdmin: true,
  permissions: { settings: 2, inbound: 2 },
  roles: [],
  roleKeys: ["admin"],
};
async function startFixture() {
  let updateRelease, installer;
  if (process.env.GLINTEX_TEST_UPDATE_INSTALLER) {
    installer = path.resolve(process.env.GLINTEX_TEST_UPDATE_INSTALLER);
    const bytes = await fs.readFile(installer);
    updateRelease = validateRelease({ schemaVersion: 1, product: "GLINTEX", platform: "win32", arch: "x64", channel: "stable", version: process.env.GLINTEX_TEST_UPDATE_VERSION, sourceCommit: require("../build-info.json").sourceCommit, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), signing: "unsigned-test-installer", notes: "Disposable next-version fixture; never publish", publishedAt: new Date().toISOString() });
  }
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    const authorized = String(req.headers.cookie || "").includes(
      "glintex_fixture=session-fixture",
    );
    if (req.url === "/api/auth/status")
      return res.end('{"hasUsers":true,"needsBootstrap":false}');
    if (req.url === "/api/health") return res.end('{"ok":true}');
    if (req.url === "/api/public/branding") return res.end("{}");
    if (req.url === "/api/auth/login") {
      res.setHeader(
        "Set-Cookie",
        "glintex_fixture=session-fixture; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600",
      );
      return res.end(JSON.stringify({ ok: true, user: TEST_USER }));
    }
    if (req.url === "/api/auth/logout") {
      res.setHeader(
        "Set-Cookie",
        "glintex_fixture=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      );
      return res.end('{"ok":true}');
    }
    if (req.url === "/api/fixture/expired") {
      res.statusCode = 401;
      return res.end('{"error":"session_expired"}');
    }
    if (req.url === "/api/fixture/redirect") {
      res.writeHead(302, { Location: "https://example.invalid/blocked" });
      return res.end();
    }
    if (!authorized) {
      res.statusCode = 401;
      return res.end('{"error":"unauthorized"}');
    }
    if (req.url === "/api/auth/me")
      return res.end(JSON.stringify({ ok: true, user: TEST_USER }));
    if (req.url === "/api/fixture/hold") return setTimeout(() => res.end('{"ok":true,"simulatedPendingSave":true}'), 2000);
    if (req.url === "/api/desktop/releases/windows-x64/latest") {
      if (!updateRelease) { res.statusCode = 204; return res.end(); }
      return res.end(JSON.stringify(updateRelease));
    }
    if (updateRelease && req.url === `/api/desktop/releases/windows-x64/${updateRelease.version}/setup`) {
      res.setHeader("Content-Type", "application/octet-stream"); res.setHeader("Content-Length", updateRelease.bytes);
      require("node:fs").createReadStream(installer).pipe(res); return;
    }
    if (req.url === "/api/bootstrap")
      return res.end('{"slices":{},"allowed":{},"brand":{}}');
    if (req.url.startsWith("/api/module")) return res.end('{"slices":{}}');
    res.end("{}");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(49188, "127.0.0.1", resolve);
  });
  return server;
}
async function runSelfTest({
  window,
  session,
  app,
  reportDirectory,
  phase = "first",
}) {
  // An explicit disposable self-test needs painted screenshots of current UI.
  // Normal launches never enter this fixture function.
  window.showInactive();
  const evaluate = (code) =>
    window.webContents.executeJavaScript(`(async()=>{${code}})()`);
  const waitFor = async (code) => {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(`return ${code}`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("UI condition timed out: " + code);
  };
  assert.equal(await evaluate("return typeof require"), "undefined");
  const controller = await evaluate(
    "return window.glintexDesktop.getController()",
  );
  assert.ok(controller.capabilities.includes("native-scale"));
  if (process.platform === "win32") assert.equal(controller.scaleDriver.available, true, "packaged driver helper must exist outside ASAR");
  const frameCheck = await evaluate(
    `const frame=document.createElement('iframe');frame.style.display='none';document.body.appendChild(frame);frame.contentDocument.open();frame.contentDocument.write('<p>Challan fixture</p>');frame.contentDocument.close();const result={text:frame.contentDocument.body.innerText,bridge:typeof frame.contentWindow.glintexDesktop,print:typeof frame.contentWindow.print};frame.remove();return result;`,
  );
  assert.equal(frameCheck.text, "Challan fixture");
  assert.equal(frameCheck.bridge, "undefined");
  assert.equal(frameCheck.print, "function");

  const fetchStatus = (route) =>
    evaluate(
      `return (await fetch(${JSON.stringify(route)},{credentials:'include'})).status`,
    );
  if (["first", "update", "restored"].includes(phase)) {
    if (phase !== "restored") {
    await waitFor("document.querySelector('input[type=password]')!==null");
    await assert.rejects(
      evaluate("return window.glintexDesktop.printers.listJobs()"),
    );
    await assert.rejects(evaluate("return window.glintexDesktop.scale.driverSetup()"));
    await evaluate(
      `const inputs=document.querySelectorAll('form input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [i,input] of Array.from(inputs).entries()){setter.call(input,i?'fixture-password':'fixture-operator');input.dispatchEvent(new Event('input',{bubbles:true}));}return true;`,
    );
    await waitFor(
      "document.querySelector('form button[type=submit]') && !document.querySelector('form button[type=submit]').disabled",
    );
    await evaluate(
      "document.querySelector('form button[type=submit]').click();return true;",
    );
    }
    await waitFor("document.body.innerText.includes('Workstation setup')");
    assert.equal(await fetchStatus("/api/auth/me"), 200, "existing session must survive the authenticated upgrade");
    const cookies = await session.cookies.get({ name: "glintex_fixture" });
    assert.equal(cookies[0].httpOnly, true);
    assert.equal(cookies[0].sameSite, "lax");
    assert.equal(await evaluate("return document.cookie"), "");
    await evaluate(
      "Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Workstation setup')).click();return true;",
    );
    await waitFor("document.body.innerText.includes('Scale connection')");
    const ports = await evaluate(
      "return window.glintexDesktop.scale.enumerate()",
    );
    assert.ok(Array.isArray(ports));
    await assert.rejects(
      evaluate("return window.glintexDesktop.scale.capture({timeoutMs:100})"),
    );
    await session.cookies.flushStore();
    if (phase === "update") {
      const check = await evaluate("return window.glintexDesktop.updates.check()");
      assert.equal(check.state, "available"); assert.equal(check.release.version, process.env.GLINTEX_TEST_UPDATE_VERSION);
      await evaluate("return window.glintexDesktop.updates.later()");
      assert.equal((await evaluate("return window.glintexDesktop.updates.status()")).prompt, false);
      const ready = await evaluate("return window.glintexDesktop.updates.download()"); assert.equal(ready.state, "ready");
      await evaluate("return window.glintexDesktop.updates.arm()");
      await evaluate("return window.glintexDesktop.updates.disarm()");
      assert.equal((await evaluate("return window.glintexDesktop.updates.status()")).state, "ready");
      await evaluate("return window.glintexDesktop.updates.arm()");
      assert.equal((await evaluate("return window.glintexDesktop.updates.status()")).state, "armed");
      await evaluate("window.fixturePendingSave=fetch('/api/fixture/hold',{method:'POST'}).then(r=>r.json());return true");
      await new Promise(resolve => setTimeout(resolve, 100));
      window.close();
      await waitFor("window.glintexDesktop.updates.status().then(s=>s.closeBlocked===true).catch(()=>false)");
      assert.equal(window.isDestroyed(), false, "pending API save must prevent installer close");
      await evaluate("return window.fixturePendingSave");
    }
  } else {
    await waitFor("document.body.innerText.includes('Workstation setup')");
    assert.equal(await fetchStatus("/api/auth/me"), 200);
    assert.equal(await fetchStatus("/api/fixture/redirect"), 502);
    assert.equal(await fetchStatus("/api/fixture/expired"), 401);
    assert.equal(await fetchStatus("/api/auth/logout"), 200);
    assert.equal(await fetchStatus("/api/auth/me"), 401);
    await assert.rejects(
      evaluate("return window.glintexDesktop.printers.listJobs()"),
    );
    await window.reload();
    await waitFor("document.querySelector('input[type=password]')!==null");
  }
  await session.cookies.flushStore();
  await fs.mkdir(reportDirectory, { recursive: true });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const image = await window.webContents.capturePage();
  await fs.writeFile(
    path.join(reportDirectory, `packaged-${phase}.png`),
    image.toPNG(),
  );
  const report = {
    passed: true,
    phase,
    version: app.getVersion(),
    sourceCommit: require('../build-info.json').sourceCommit,
    restoredSession: phase === "restored",
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    checks: [
      "bundled-ui",
      "isolated-preload",
      "no-renderer-node",
      "native-serial-load",
      "login-or-restored-session",
      "httponly-samesite-cookie",
      "hardware-auth-gate",
      "same-origin-challan-frame-no-bridge",
      ["first", "update", "restored"].includes(phase) ? "setup-panel" : "expiry-logout-foreign-redirect",
      ...(phase === "restored" ? ["restored-session-after-authenticated-upgrade"] : []),
      ...(phase === "update" ? ["authenticated-release-discovery", "private-installer-download-and-sha256", "later-no-install", "explicit-arm-cancel-arm", "main-process-mid-save-close-block", "fixture-only-close-confirmation-and-silent-install"] : []),
    ],
    at: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(reportDirectory, `packaged-${phase}.json`),
    JSON.stringify(report, null, 2),
  );
  return report;
}
module.exports = { startFixture, runSelfTest };
