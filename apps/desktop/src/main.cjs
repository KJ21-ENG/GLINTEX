const {
  app,
  BrowserWindow,
  session,
  ipcMain,
  powerMonitor,
  dialog,
  Menu,
  shell,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { SettingsStore } = require("./settings.cjs");
const { ScaleController } = require("./scale/controller.cjs");
const { PrintController } = require("./printing/controller.cjs");
const { createElectronPrinter } = require("./printing/electron-printer.cjs");
const {
  assertSender,
  assertPlain,
  validId,
  isAppUrl,
  createAppHandler,
} = require("./security.cjs");
const { assertPermission, mayReadJob } = require("./authorization.cjs");
app.setName("GLINTEX");
// Keep a stable path independent of package/version/Squirrel installation folders.
app.setPath("userData", path.join(app.getPath("appData"), "GLINTEX"));
let authenticated = false;
let authValidUntil = 0;
const smoke = process.argv.includes("--smoke-test");
const selfTest = process.argv.includes("--self-test");
const testMode = !app.isPackaged && process.env.GLINTEX_DESKTOP_TEST === "1";
const origin = selfTest
  ? "http://127.0.0.1:49188"
  : testMode
    ? process.env.GLINTEX_TEST_ORIGIN || "http://127.0.0.1:49187"
    : "https://app.glintex.in";
if (testMode && !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw new Error("Test API must be a local loopback fixture");
if (selfTest && !process.env.GLINTEX_TEST_DATA)
  throw new Error("Self-test requires isolated GLINTEX_TEST_DATA");
if (process.env.GLINTEX_TEST_DATA && (testMode || smoke || selfTest))
  app.setPath("userData", path.resolve(process.env.GLINTEX_TEST_DATA));
app.setAppUserModelId("com.squirrel.GLINTEX.GLINTEX");
let mainWindow, settings, scale, printer, desktopSession, fixtureServer;
const squirrel =
  process.platform === "win32" && require("electron-squirrel-startup");
// Disposable runner installs must not auto-launch against the live API.
const skipInstallerLaunch =
  process.env.GLINTEX_INSTALL_TEST === "1" &&
  process.argv.includes("--squirrel-firstrun");
if (squirrel || skipInstallerLaunch || !app.requestSingleInstanceLock())
  app.quit();
else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch(async (error) => {
      if (smoke || selfTest) {
        console.error(error);
        app.exit(1);
        return;
      }
      await dialog.showMessageBox({
        type: "error",
        title: "GLINTEX could not start",
        message: error.message,
      });
      app.exit(1);
    });
}
async function serverStatus() {
  try {
    const r = await desktopSession.fetch(origin + "/api/health", {
      credentials: "include",
      redirect: "error",
      bypassCustomProtocolHandlers: true,
      signal: AbortSignal.timeout(6000),
    });
    return {
      state: r.ok ? "online" : "offline",
      apiOrigin: origin,
      checkedAt: new Date().toISOString(),
      message: r.ok ? null : "Server returned " + r.status,
    };
  } catch {
    return {
      state: "offline",
      apiOrigin: origin,
      checkedAt: new Date().toISOString(),
      message: "Cannot reach GLINTEX server. Check the network and try again.",
    };
  }
}
async function start() {
  if (selfTest) fixtureServer = await require("./self-test.cjs").startFixture();
  settings = await new SettingsStore(
    path.join(app.getPath("userData"), "workstation"),
  ).load();
  desktopSession = session.fromPartition("persist:glintex-workstation");
  desktopSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.protocol.handle(
    new URL(origin).protocol.slice(0, -1),
    createAppHandler({
      origin,
      uiDirectory: path.join(__dirname, "../ui"),
      fetchApi: (url, options) => desktopSession.fetch(url, options),
      onAuthInvalidated: async () => {
        authenticated = false;
        await scale?.disconnect();
      },
    }),
  );
  // No remote scripts, secondary origins or localhost helper connections are permitted.
  desktopSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const u = new URL(details.url);
      allowed =
        u.origin === origin || u.protocol === "blob:" || u.protocol === "data:";
    } catch {}
    callback({ cancel: !allowed });
  });
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    title: "GLINTEX",
    icon: path.join(__dirname, "../assets/icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      partition: "persist:glintex-workstation",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "GLINTEX",
        submenu: [
          { role: "reload" },
          { role: "togglefullscreen" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
    ]),
  );
  mainWindow.webContents.setWindowOpenHandler(() => {
    // External account setup remains in the normal browser; never load remote code
    // or accept arbitrary caller URLs in the privileged desktop window.
    if (!selfTest && !smoke)
      void dialog
        .showMessageBox(mainWindow, {
          type: "info",
          title: "Use the browser for this link",
          message:
            "External links and account connections open in the browser version of GLINTEX.",
          buttons: ["Open GLINTEX in browser", "Cancel"],
          defaultId: 1,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0)
            return shell.openExternal("https://app.glintex.in");
        })
        .catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url, origin)) event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isAppUrl(url, origin)) event.preventDefault();
  });
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  mainWindow.webContents.on("render-process-gone", () => {
    if (!mainWindow.isDestroyed()) mainWindow.reload();
  });
  scale = new ScaleController({
    config: settings.get("scale"),
    saveConfig: (config) => settings.set("scale", config),
  });
  scale.subscribe((status) => {
    if (
      authenticated &&
      Date.now() < authValidUntil &&
      mainWindow &&
      !mainWindow.isDestroyed()
    )
      mainWindow.webContents.send("glintex:scale-status", status);
  });
  printer = new PrintController({
    directory: path.join(app.getPath("userData"), "print-jobs"),
    settings,
    getPrinters: () => mainWindow.webContents.getPrintersAsync(),
    printArtifact: createElectronPrinter({ BrowserWindow }),
  });
  const operations = {
    controller: () => ({
      version: app.getVersion(),
      capabilities: [
        "native-scale",
        "windows-driver-print",
        "durable-print-queue",
        "bundled-ui",
      ],
      apiOrigin: origin,
    }),
    "settings.get": () => settings.get(),
    "settings.update": async (data) => {
      assertPlain(data);
      if (
        Object.keys(data).some((k) => k !== "startAtLogin") ||
        typeof data.startAtLogin !== "boolean"
      )
        throw new Error("Only start-at-login can be changed here");
      if (process.platform === "win32") {
        if (!app.isPackaged)
          throw new Error(
            "Start-at-login is available after installing the packaged application",
          );
        const exe = path.basename(process.execPath);
        app.setLoginItemSettings({
          openAtLogin: data.startAtLogin,
          path: path.resolve(
            path.dirname(process.execPath),
            "..",
            "Update.exe",
          ),
          args: ["--processStart", exe],
        });
      }
      await settings.set("startAtLogin", data.startAtLogin);
      return settings.get();
    },
    "server.status": serverStatus,
    "scale.enumerate": () => scale.enumerate(),
    "scale.status": () => scale.status(),
    "scale.connect": () => scale.connect(),
    "scale.disconnect": () => scale.disconnect(),
    "scale.configure": (data) => scale.configure(assertPlain(data)),
    "scale.capture": (data) => scale.capture(assertPlain(data)),
    "printers.enumerate": () => printer.enumerate(),
    "printers.status": () => printer.status(),
    "printers.configure": (data) => printer.configure(assertPlain(data)),
    "printers.submit": (data) =>
      printer.submit(assertPlain(data, 21 * 1024 * 1024)),
    "printers.getJob": (id) => printer.getJob(validId(id)),
    "printers.listJobs": () => printer.listJobs(),
    "printers.reprint": (id) => printer.reprint(validId(id)),
  };
  ipcMain.handle("glintex:operation", async (event, operation, payload) => {
    assertSender(event, mainWindow?.webContents, origin);
    if (typeof operation !== "string" || !Object.hasOwn(operations, operation))
      throw new Error("Unknown desktop operation");
    if (operation === "controller" || operation === "server.status")
      return operations[operation](payload);
    let user;
    try {
      const response = await desktopSession.fetch(origin + "/api/auth/me", {
        credentials: "include",
        redirect: "error",
        bypassCustomProtocolHandlers: true,
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Session unavailable");
      user = (await response.json()).user;
    } catch {
      authenticated = false;
      await scale.disconnect();
      throw new Error(
        "Sign in again or restore server connectivity to use workstation devices",
      );
    }
    authenticated = true;
    authValidUntil = Date.now() + 30000;
    let stage = payload?.artifact?.templateSnapshot?.stageKey;
    if (operation === "printers.reprint" || operation === "printers.getJob") {
      const job = await printer.getJob(validId(payload));
      if (!mayReadJob(user, job))
        throw new Error(
          "This retained job belongs to another workstation user",
        );
      stage = job.stageKey;
    }
    assertPermission(user, operation, stage);
    if (operation === "printers.listJobs")
      return (await printer.listJobs()).filter((job) => mayReadJob(user, job));
    if (operation === "printers.submit")
      return printer.submit({
        ...assertPlain(payload, 21 * 1024 * 1024),
        ownerUserId: user.id,
      });
    if (operation === "printers.reprint")
      return printer.reprint(validId(payload), { ownerUserId: user.id });
    return operations[operation](payload);
  });
  powerMonitor.on("suspend", () => scale.suspend());
  powerMonitor.on("resume", () => scale.resume().catch(() => {}));
  mainWindow.on("ready-to-show", () => {
    if (!smoke && !selfTest) mainWindow.show();
  });
  await mainWindow.loadURL(origin + "/");
  if (selfTest) {
    const report = await require("./self-test.cjs").runSelfTest({
      window: mainWindow,
      session: desktopSession,
      app,
      reportDirectory:
        process.env.GLINTEX_TEST_REPORTS || process.env.GLINTEX_TEST_DATA,
      phase: process.env.GLINTEX_TEST_PHASE || "first",
    });
    console.log(JSON.stringify(report));
    app.quit();
    return;
  }
  if (smoke) {
    const checks = await mainWindow.webContents.executeJavaScript(
      `({title:document.title,bridge:typeof window.glintexDesktop?.getController==='function',node:typeof window.require,body:document.body.innerText.length})`,
    );
    await require("serialport").SerialPort.list();
    if (!checks.bridge || checks.node !== "undefined" || checks.body < 1)
      throw new Error("Packaged smoke checks failed");
    const report = {
      passed: true,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      checks,
      at: new Date().toISOString(),
    };
    if (process.env.GLINTEX_SMOKE_REPORT)
      await fs.writeFile(
        process.env.GLINTEX_SMOKE_REPORT,
        JSON.stringify(report, null, 2),
      );
    console.log(JSON.stringify(report));
    app.quit();
  }
}
app.on("before-quit", () => {
  fixtureServer?.close();
  scale?.dispose();
  desktopSession?.cookies.flushStore();
});
app.on("window-all-closed", () => app.quit());
