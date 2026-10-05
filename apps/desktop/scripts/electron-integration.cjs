// Offline-only integration harness: never contacts the production service.
const { app, BrowserWindow, session, ipcMain } = require("electron");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createAppHandler, assertSender } = require("../src/security.cjs");
const root = process.env.GLINTEX_TEST_DATA;
if (!root) throw new Error("Isolated GLINTEX_TEST_DATA required");
app.setPath("userData", root);
let server, win;
app
  .whenReady()
  .then(async () => {
    server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/auth/login") {
        res.setHeader(
          "Set-Cookie",
          "glintex_test=session-fixture; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600",
        );
        return res.end('{"ok":true}');
      }
      if (req.url === "/api/auth/logout") {
        res.setHeader(
          "Set-Cookie",
          "glintex_test=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        );
        return res.end('{"ok":true}');
      }
      if (req.url === "/api/redirect") {
        res.writeHead(302, { Location: "https://example.invalid/steal" });
        return res.end();
      }
      if (req.url === "/api/expired") {
        res.statusCode = 401;
        return res.end('{"error":"session_expired"}');
      }
      if (req.url === "/api/auth/me") {
        if (
          !String(req.headers.cookie || "").includes(
            "glintex_test=session-fixture",
          )
        )
          res.statusCode = 401;
        return res.end(
          JSON.stringify({
            ok: res.statusCode === 200,
            user:
              res.statusCode === 200
                ? {
                    id: "test",
                    isAdmin: false,
                    permissions: { "receive.cutter": 2 },
                  }
                : null,
          }),
        );
      }
      res.statusCode = 404;
      res.end("{}");
    });
    // Fixed loopback port makes cookie restart evidence refer to the same origin.
    await new Promise((resolve) => server.listen(49187, "127.0.0.1", resolve));
    const origin = "http://127.0.0.1:49187";
    const ses = session.fromPartition("persist:integration");
    const ui = path.join(root, "fixture-ui");
    await fs.mkdir(ui, { recursive: true });
    await fs.writeFile(
      path.join(ui, "index.html"),
      "<title>GLINTEX test</title><p>Fixture</p>",
    );
    let invalidated = 0;
    ses.protocol.handle(
      "http",
      createAppHandler({
        origin,
        uiDirectory: ui,
        fetchApi: (url, opts) => ses.fetch(url, opts),
        onAuthInvalidated: () => {
          invalidated++;
        },
      }),
    );
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        partition: "persist:integration",
        preload: path.join(__dirname, "../src/preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    ipcMain.handle("glintex:operation", (event, operation) => {
      assertSender(event, win.webContents, origin);
      if (operation !== "controller") throw new Error("Unknown operation");
      return { version: "test" };
    });
    await win.loadURL(origin + "/");
    const evaluate = (code) => win.webContents.executeJavaScript(code);
    assert.equal(await evaluate("typeof require"), "undefined");
    assert.equal(
      await evaluate(
        "window.glintexDesktop.getController().then(c=>c.version)",
      ),
      "test",
    );
    const request = (route) =>
      evaluate(
        `fetch(${JSON.stringify(route)},{credentials:'include'}).then(async r=>({status:r.status,body:await r.text()}))`,
      );
    const phase = process.env.GLINTEX_TEST_PHASE || "first";
    if (phase === "first") {
      await ses.clearStorageData();
      assert.equal((await request("/api/auth/me")).status, 401);
      assert.equal((await request("/api/auth/login")).status, 200);
      assert.equal((await request("/api/auth/me")).status, 200);
      assert.equal(await evaluate("document.cookie"), "");
      const cookies = await ses.cookies.get({ name: "glintex_test" });
      assert.equal(cookies[0].httpOnly, true);
      assert.equal(cookies[0].sameSite, "lax");
      await ses.cookies.flushStore();
    } else {
      assert.equal(
        (await request("/api/auth/me")).status,
        200,
        "Cookie persists across process restart",
      );
      assert.equal(
        (await request("/api/redirect")).status,
        502,
        "Foreign redirect rejected",
      );
      assert.equal((await request("/api/expired")).status, 401);
      assert.ok(invalidated > 0);
      assert.equal((await request("/api/auth/logout")).status, 200);
      assert.equal((await request("/api/auth/me")).status, 401);
    }
    const report = {
      passed: true,
      phase,
      platform: process.platform,
      checks: [
        "sandbox-no-node",
        "isolated-preload",
        "first-party-api",
        "httponly-cookie",
        "samesite-cookie",
        phase === "first" ? "login-session" : "restart-expiry-logout-redirect",
      ],
    };
    await fs.writeFile(
      path.join(root, `integration-${phase}.json`),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    server.close();
    win.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    server?.close();
    win?.destroy();
    app.exit(1);
  });
