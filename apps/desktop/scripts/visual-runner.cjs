// Application integration test, running our fixture in a normal sandboxed Electron renderer.
// No production endpoint, physical device, OS permission changes or unsafe launch switches.
const { app, BrowserWindow, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "test/visual/output");
const origin = "http://127.0.0.1:4188";
let server, win;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  await fs.mkdir(output, { recursive: true });
  server = spawn(process.execPath, [path.join(__dirname, "visual-check.cjs")], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(Error("Fixture server startup timed out")),
      30000,
    );
    server.stdout.on("data", (data) => {
      process.stdout.write(data);
      if (String(data).includes("Offline visual QA")) {
        clearTimeout(deadline);
        resolve();
      }
    });
    server.stderr.on("data", (data) => process.stderr.write(data));
    server.once("error", reject);
    server.once("exit", (code) => {
      if (code) {
        clearTimeout(deadline);
        reject(Error(`Fixture server exited ${code}`));
      }
    });
  });
  await app.whenReady();
  const ses = session.fromPartition("visual-fixture");
  ses.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  ses.webRequest.onBeforeRequest((details, callback) =>
    callback({
      cancel: !(
        details.url.startsWith(origin + "/") || details.url.startsWith("data:")
      ),
    }),
  );
  win = new BrowserWindow({
    width: 1360,
    height: 960,
    show: false,
    webPreferences: {
      partition: "visual-fixture",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("console-message", (_event, details, message) => {
    console.log("Visual renderer:", message || details?.message || details);
  });
  await win.loadURL(origin + "/");
  win.showInactive();
  let result;
  for (let i = 0; i < 120; i++) {
    result = await win.webContents.executeJavaScript(
      `({done:document.querySelector('#results')?.dataset.finished==='true',text:document.querySelector('#results')?.textContent})`,
    );
    if (result.done) break;
    if (result.text?.startsWith("FAILED:")) throw Error(result.text);
    await delay(250);
  }
  if (!result?.done) throw Error("Real renderer label test timed out");
  const report = JSON.parse(result.text);
  if (report.completed !== 9 || report.results.some((r) => r.version !== 2 || r.fonts < 6 || r.warnings.length))
    throw Error("Version 2 artifacts with embedded fonts and no layout warnings expected: " + result.text);
  let panel = false;
  for (let attempt = 0; attempt < 100 && !panel; attempt++) {
    panel = await win.webContents.executeJavaScript(
      `(() => { const button = [...document.querySelectorAll('#panel button')].find(b=>/Workstation setup/i.test(b.textContent)); if (!button) return false; button.click(); return true; })()`,
    );
    if (!panel) await delay(100);
  }
  if (!panel) throw Error("Workstation panel button missing");
  await delay(750);
  const panelText = await win.webContents.executeJavaScript(
    `document.querySelector('#panel').innerText`,
  );
  for (const expected of [
    "Fixture TSC TE244",
    "unsupported",
    "outcome uncertain",
  ])
    if (!panelText.includes(expected))
      throw Error("Panel missing expected fixture state: " + expected);
  const driverUI = await require("./driver-ui-assertions.cjs").verifyDriverUI(code => win.webContents.executeJavaScript(code));
  const updateUI = await require("./update-ui-assertions.cjs").verifyUpdateUI(code => win.webContents.executeJavaScript(code), async (name, width = 1360) => {
    win.setSize(width, 960);
    await win.webContents.executeJavaScript("document.querySelector('#panel').scrollIntoView({block:'start'})");
    await delay(150);
    const rect = await win.webContents.executeJavaScript("(() => { const panel=document.querySelector('#panel');const r=panel.getBoundingClientRect();const notice=panel.querySelector('[aria-label=\"Application updates\"]');if(notice.scrollWidth>notice.clientWidth)throw Error('Update notice overflows the window');return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.min(300,Math.ceil(r.height))}; })()");
    await fs.writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage(rect)).toPNG());
  });
  await fs.writeFile(
    path.join(output, "workstation-panel.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  const count = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.label-card').length`,
  );
  for (let index = 0; index < count; index++) {
    const rect = await win.webContents.executeJavaScript(
      `(() => { const card = document.querySelectorAll('.label-card')[${index}]; card.scrollIntoView({block:'start'}); const r=card.getBoundingClientRect(); return {x:Math.max(0,Math.floor(r.x)),y:Math.max(0,Math.floor(r.y)),width:Math.ceil(r.width),height:Math.min(Math.ceil(r.height),innerHeight-Math.max(0,Math.floor(r.y)))}; })()`,
    );
    await delay(100);
    await fs.writeFile(
      path.join(output, `label-card-${index + 1}.png`),
      (await win.webContents.capturePage(rect)).toPNG(),
    );
  }
  const dpiChecks = [];
  for (const dpi of [300, 600, 203]) {
    await win.webContents.executeJavaScript(`window.fixtureSetDpi(${dpi})`);
    let text = "";
    for (let i = 0; i < 100; i++) {
      text = await win.webContents.executeJavaScript(
        `document.querySelector('#editor')?.innerText || ''`,
      );
      if (text.includes(dpi + " dpi") && text.includes("exact printed artwork")) break;
      await delay(100);
    }
    if (!text.includes(dpi + " dpi"))
      throw Error("Editor did not pick up the " + dpi + " dpi printer profile");
    const elements = await win.webContents.executeJavaScript(
      `document.querySelectorAll('#editor [data-element-id]').length`,
    );
    if (elements < 5) throw Error("Editor shows too few label elements: " + elements);
    dpiChecks.push({ dpi, elements });
  }
  // Every artifact the fixture built with the real canvas measurer now goes through the
  // production printer module: private scheme, CSP header, fonts, printToPDF instead of Windows.
  const { createElectronPrinter } = require("../src/printing/electron-printer.cjs");
  const printed = [];
  let current = null;
  const printer = createElectronPrinter({
    BrowserWindow,
    session,
    partition: "glintex-print-visual",
    submit: async (printWin, options, callback) => {
      try {
        const widthPx = Math.ceil((options.pageSize.width / 1000 / 25.4) * 96 * 3);
        const heightPx = Math.ceil((options.pageSize.height / 1000 / 25.4) * 96 * 3);
        printWin.setContentSize(widthPx + 40, heightPx + 40);
        printWin.webContents.setZoomFactor(3);
        await delay(150);
        await fs.writeFile(path.join(output, `${current}.print.png`), (await printWin.webContents.capturePage({ x: 0, y: 0, width: widthPx, height: heightPx })).toPNG());
        printWin.webContents.setZoomFactor(1);
        await fs.writeFile(path.join(output, `${current}.print.pdf`), await printWin.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } }));
        callback(true);
      } catch (error) {
        callback(false, error.message);
      }
    },
  });
  for (const r of report.results) {
    current = r.stage;
    const artifact = JSON.parse(await fs.readFile(path.join(output, `${r.stage}.artifact.json`), "utf8"));
    const outcome = await printer(artifact, { printerName: "Visual PDF", dpi: 203 });
    if (!outcome.success) throw Error(`Printer module failed for ${r.stage}: ${outcome.error}`);
    printed.push(r.stage);
  }
  if (printed.length !== 9) throw Error("Expected nine stages through the printer module");
  await win.webContents.executeJavaScript(
    `document.querySelector('#editor').scrollIntoView({block:'start'})`,
  );
  await delay(150);
  await fs.writeFile(
    path.join(output, "label-editor.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await fs.writeFile(
    path.join(output, "visual-report.json"),
    JSON.stringify(
      {
        ...report,
        printedThroughPrinterModule: printed,
        dpiChecks,
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        platform: process.platform,
        panelVerified: true,
        driverUI,
        updateUI,
        physicalHardwareTested: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "VISUAL_QA_PASS: nine version 2 label documents built with embedded fonts in real Chromium; designer and workstation fixture states present",
  );
}
main()
  .then(() => {
    if (win) win.destroy();
    if (server) server.kill();
    app.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      path.join(output, "visual-failure.txt"),
      error.stack || String(error),
    );
    if (win && !win.isDestroyed()) {
      await fs.writeFile(
        path.join(output, "visual-failure.png"),
        (await win.webContents.capturePage()).toPNG(),
      );
      await fs.writeFile(
        path.join(output, "visual-failure.json"),
        JSON.stringify({ error: String(error), body: await win.webContents.executeJavaScript("document.body.innerText") }, null, 2),
      );
    }
    if (win && !win.isDestroyed()) win.destroy();
    if (server) server.kill();
    app.exit(1);
  });
