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
const { DriverSetup } = require("./driver/setup.cjs");
const { UpdateController } = require("./updates/controller.cjs");
const { UpdateScheduler } = require("./updates/scheduler.cjs");
const { updateBlockReason } = require("./updates/safety.cjs");
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
const { WindowRegistry, appWindowUrl } = require("./windows.cjs");
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
let mainWindow, windows, settings, scale, printer, driverSetup, updater, updateScheduler, desktopSession, fixtureServer;
const windowLoads = new WeakMap();
let closingForUpdate = false, closeApproved = false, closeChecking = false, nativeOperations = 0;
const apiRequests = new Set();
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
    const target = windows?.focused();
    if (target) {
      if (target.isMinimized()) target.restore();
      target.show();
      target.focus();
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
  driverSetup = new DriverSetup({
    kitDirectory: app.isPackaged ? path.join(process.resourcesPath, "scale-driver") : path.resolve(__dirname, "../build/scale-driver"),
    userData: app.getPath("userData"),
  });
  desktopSession = session.fromPartition("persist:glintex-workstation");
  desktopSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  desktopSession.setPermissionCheckHandler(() => false);
  updater = await new UpdateController({
    version: app.getVersion(), directory: path.join(app.getPath("userData"), "updates"),
    fetch: (url, options) => desktopSession.fetch(url, options), origin, fixture: selfTest || testMode,
  }).initialize();
  updateScheduler = new UpdateScheduler({ updater });
  updater.on("status", status => windows?.broadcast("glintex:update-status", status));
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
    let businessRequest = false;
    try { const u = new URL(details.url); businessRequest = u.pathname.startsWith("/api/") && !/^\/api\/(health|auth\/me|desktop\/releases)(\/|$)/.test(u.pathname); } catch {}
    if (allowed && businessRequest && !closingForUpdate) apiRequests.add(details.id);
    callback({ cancel: !allowed || (closingForUpdate && businessRequest) });
  });
  desktopSession.webRequest.onCompleted(details => {
    apiRequests.delete(details.id);
    void updater.authenticationCompleted(details);
  });
  desktopSession.webRequest.onErrorOccurred(details => apiRequests.delete(details.id));
  // Every application window is built here: same bundle, same policies, same bridge.
  // Staff open several of them the way they used browser tabs.
  const createAppWindow = ({ url, bounds }) => {
    const win = new BrowserWindow({
      ...(bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : { width: 1360, height: 900 }),
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
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      // Application pages open as another window of this app. External account setup
      // remains in the normal browser; never load remote code in a privileged window.
      if (isAppUrl(target, origin)) {
        if (!closingForUpdate) openAppWindow(target, win);
        return { action: "deny" };
      }
      if (!selfTest && !smoke)
        void dialog
          .showMessageBox(win, {
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
    win.webContents.on("will-navigate", (event, target) => {
      if (!isAppUrl(target, origin)) event.preventDefault();
    });
    win.webContents.on("will-redirect", (event, target) => {
      if (!isAppUrl(target, origin)) event.preventDefault();
    });
    win.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    win.webContents.on("render-process-gone", () => {
      if (!win.isDestroyed()) win.reload();
    });
    // The browser habit: Ctrl+T opens another window too (Ctrl+N is the menu item).
    win.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && (input.control || input.meta) && !input.alt && !input.shift && input.key.toLowerCase() === "t") {
        event.preventDefault();
        openAppWindow(origin + "/", win);
      }
    });
    win.on("ready-to-show", () => {
      if (!smoke && !selfTest) win.show();
    });
    win.on("close", (event) => onWindowClose(win, event));
    // A page's unsaved-form guard can still veto the approved close.
    win.webContents.on("will-prevent-unload", () => {
      if (closeApproved && windows.isLast(win)) { closeApproved = false; closingForUpdate = false; void updater.disarm(); void win.webContents.executeJavaScript("document.body.inert=false"); }
    });
    windowLoads.set(win, win.loadURL(url));
    return win;
  };
  windows = new WindowRegistry({ create: createAppWindow });
  const openAppWindow = (url, from) => {
    try {
      return windows.open(url, from ? { from } : {});
    } catch (error) {
      const parent = from && !from.isDestroyed() ? from : windows.focused();
      if (parent && !selfTest && !smoke) void dialog.showMessageBox(parent, { type: "info", title: "GLINTEX windows", message: error.message, buttons: ["OK"] }).catch(() => {});
      return null;
    }
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "GLINTEX",
        submenu: [
          { label: "Check for updates", click: () => { void updater.check({ manual: true }); } },
          { role: "reload" },
          { role: "togglefullscreen" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "Window",
        submenu: [
          { label: "New window", accelerator: "CommandOrControl+N", click: () => { openAppWindow(origin + "/"); } },
          { type: "separator" },
          { role: "minimize" },
          { role: "close" },
        ],
      },
    ]),
  );
  mainWindow = windows.open(origin + "/");
  scale = new ScaleController({
    config: settings.get("scale"),
    saveConfig: (config) => settings.set("scale", config),
  });
  scale.subscribe((status) => {
    if (authenticated && Date.now() < authValidUntil)
      windows.broadcast("glintex:scale-status", status);
  });
  printer = new PrintController({
    directory: path.join(app.getPath("userData"), "print-jobs"),
    settings,
    getPrinters: () => {
      const win = windows.primary();
      if (!win) throw new Error("No application window is open");
      return win.webContents.getPrintersAsync();
    },
    printArtifact: createElectronPrinter({ BrowserWindow, session }),
  });
  const safety = async () => {
    await printer.ready;
    return updateBlockReason({ scale: scale.status(), driverRunning: driverSetup.running, nativeOperations, apiRequests: apiRequests.size, printJobs: [...printer.jobs.values()] });
  };
  // Closing a window while an update is armed: other windows just close; the last one
  // runs the preflight, because the installer may only start once GLINTEX has exited.
  const onWindowClose = (win, event) => {
    if (closeApproved || !["armed", "installing"].includes(updater.status().state)) return;
    if (!windows.isLast(win)) return;
    event.preventDefault();
    if (closeChecking) return;
    closeChecking = true;
    void (async () => {
      closingForUpdate = true;
      updater.set({ closeBlocked: false });
      await win.webContents.executeJavaScript("document.body.inert=true");
      const blocked = await safety();
      if (blocked) {
        updater.set({ closeBlocked: true, message: blocked });
        if (!(selfTest && process.env.GLINTEX_TEST_PHASE === "update")) await dialog.showMessageBox(win, { type: "info", title: "Finish work before updating", message: blocked, buttons: ["Keep working"] });
        return;
      }
      const fixtureUpgrade = selfTest && process.env.GLINTEX_TEST_PHASE === "update";
      const choice = fixtureUpgrade ? { response: 1 } : await dialog.showMessageBox(win, { type: "question", title: "Close GLINTEX and install the update?", message: "Confirm that every capture, receipt and edited form is saved, or deliberately discard unfinished forms. Windows printer submissions may still be printing; check the Windows queue first.", detail: "The verified installer opens after GLINTEX exits. Windows will not be restarted. Keep working if anything is unfinished.", buttons: ["Keep working", "Close and install"], defaultId: 0, cancelId: 0, noLink: true });
      if (choice.response !== 1) return;
      await settings.pending;
      await desktopSession.cookies.flushStore();
      await updater.installAfterExit({ safety, silent: fixtureUpgrade });
      closeApproved = true;
      win.close();
    })().catch(async error => {
      await updater.disarm();
      if (selfTest) { console.error(error); app.exit(1); return; }
      await dialog.showMessageBox(win, { type: "error", title: "Update stopped", message: error.message });
    }).finally(() => {
      closeChecking = false;
      if (!closeApproved && !win.isDestroyed()) {
        closingForUpdate = false;
        void win.webContents.executeJavaScript("document.body.inert=false");
      }
    });
  };
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
      scaleDriver: driverSetup.status(),
      updates: updater.status(),
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
    "windows.open": (target) => {
      const win = openAppWindow(appWindowUrl(target === undefined ? "/" : target, origin));
      if (!win) throw new Error(`At most ${windows.max} GLINTEX windows can be open; close one first`);
      return { count: windows.count() };
    },
    "updates.status": () => updater.status(),
    "updates.check": () => updater.check({ manual: true }),
    "updates.retry": () => updateScheduler.retry(),
    "updates.download": () => updater.download(),
    "updates.cancel": () => updater.cancel(),
    "updates.later": () => updater.later(),
    "updates.arm": () => updater.arm(),
    "updates.disarm": () => updater.disarm(),
    "scale.enumerate": () => scale.enumerate(),
    "scale.driverSetup": async (data) => {
      if (data !== undefined) throw new Error("Driver setup accepts no custom commands or paths");
      if (scale.status().isConnected || scale.status().status === "connecting")
        throw new Error("Disconnect the scale before running driver setup. Close other serial applications too.");
      return driverSetup.prepare();
    },
    "scale.status": () => scale.status(),
    "scale.connect": () => {
      if (driverSetup.running) throw new Error("Wait for driver setup to finish before connecting the scale");
      return scale.connect();
    },
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
    assertSender(event, windows.contents(), origin);
    if (typeof operation !== "string" || !Object.hasOwn(operations, operation))
      throw new Error("Unknown desktop operation");
    if (closingForUpdate) throw new Error("Application is closing for an update. Finish or cancel the close first.");
    if (operation.startsWith("updates.") && payload !== undefined) throw new Error("Updates accept no custom URLs, files or commands");
    if (operation === "controller" || operation === "server.status" || operation === "windows.open" || operation.startsWith("updates."))
      return operations[operation](payload);
    nativeOperations++;
    try {
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
      return await printer.submit({
        ...assertPlain(payload, 21 * 1024 * 1024),
        ownerUserId: user.id,
      });
    if (operation === "printers.reprint")
      return await printer.reprint(validId(payload), { ownerUserId: user.id });
    return await operations[operation](payload);
    } finally { nativeOperations--; }
  });
  powerMonitor.on("suspend", () => scale.suspend());
  powerMonitor.on("resume", () => {
    if (!closingForUpdate) {
      scale.resume().catch(() => {});
      void updateScheduler.retry();
    }
  });
  await windowLoads.get(mainWindow);
  if (!selfTest && !smoke) {
    updateScheduler.start();
  }
  if (selfTest) {
    const report = await require("./self-test.cjs").runSelfTest({
      window: mainWindow,
      windows,
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
    if (app.isPackaged && !driverSetup.status().bundled)
      throw new Error("Packaged scale driver helper is missing");
    const report = {
      passed: true,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      scaleDriver: driverSetup.status(),
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
// Quit must wait for asynchronous close preflight/helper acknowledgement just
// like clicking the window's close button. Re-enter quit only after approval.
app.on('before-quit', event => {
  if (!closeApproved && windows?.count() && ['armed','installing'].includes(updater?.status().state)) {
    event.preventDefault();
    for (const win of windows.all()) win.close();
    const remaining = windows.focused();
    if (remaining && !closeApproved) remaining.focus();
  }
});
app.on("will-quit", () => {
  updateScheduler?.stop();
  fixtureServer?.close();
  scale?.dispose();
  desktopSession?.cookies.flushStore();
});
app.on("window-all-closed", () => app.quit());
