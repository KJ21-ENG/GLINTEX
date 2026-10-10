// Real Chromium print integration: every stage design goes through the production
// Electron printer (private scheme, fonts, readiness wait) with the Windows submission
// replaced by printToPDF and a page capture. Output: PNG, PDF and report.json.
// Run: electron apps/desktop/scripts/print-integration.cjs <output-dir>
const { app, BrowserWindow } = require("electron");
// The hidden print window is the only window here; closing it must not quit the app.
app.on("window-all-closed", () => {});
process.on("uncaughtException", (error) => { console.error(error); app.exit(1); });
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../../..");
const argOut = process.argv.slice(2).filter((a) => !a.startsWith("-")).pop();
const outDir = path.resolve(argOut || path.join(root, "apps/desktop/test/visual/print-output"));
if (process.env.ELECTRON_PROFILE) app.setPath("userData", process.env.ELECTRON_PROFILE);
const watchdog = setTimeout(() => { console.error("print integration timed out"); app.exit(2); }, 180000);
const fontFile = (pkg, name) => `data:font/woff2;base64,${fs.readFileSync(path.join(root, "node_modules/@fontsource", pkg, "files", `${name}.woff2`)).toString("base64")}`;
app.whenReady().then(async () => {
  const { session } = require("electron");
  const { createElectronPrinter } = require("../src/printing/electron-printer.cjs");
  const label = (name) => import(pathToFileURL(path.join(root, "apps/frontend/src/utils/label", name)).href);
  const { DEFAULT_STAGE_TEMPLATES, CALIBRATION_TEMPLATE } = await label("defaults.js");
  const { buildPrintableArtifact } = await label("artifact.js");
  const { buildSampleData } = await label("sampleData.js");
  const { migrateV1Template } = await label("migrate.js");
  const fonts = [
    { family: "Inter", weight: 400, style: "normal", dataUrl: fontFile("inter", "inter-latin-400-normal") },
    { family: "Inter", weight: 700, style: "normal", dataUrl: fontFile("inter", "inter-latin-700-normal") },
    { family: "Roboto Mono", weight: 400, style: "normal", dataUrl: fontFile("roboto-mono", "roboto-mono-latin-400-normal") },
    { family: "Roboto Mono", weight: 700, style: "normal", dataUrl: fontFile("roboto-mono", "roboto-mono-latin-700-normal") },
    { family: "IBM Plex Sans", weight: 400, style: "normal", dataUrl: fontFile("ibm-plex-sans", "ibm-plex-sans-latin-400-normal") },
    { family: "IBM Plex Sans", weight: 700, style: "normal", dataUrl: fontFile("ibm-plex-sans", "ibm-plex-sans-latin-700-normal") },
  ];
  fs.mkdirSync(outDir, { recursive: true });
  const jobs = [];
  for (const [stage, template] of Object.entries(DEFAULT_STAGE_TEMPLATES))
    for (const variant of ["typical", "long"])
      jobs.push({ name: `${stage}__${variant}`, artifact: buildPrintableArtifact(template, [buildSampleData(stage, variant)], { stageKey: stage, dpi: 203, fonts }) });
  jobs.push({ name: "calibration", artifact: buildPrintableArtifact(CALIBRATION_TEMPLATE, [{}], { stageKey: "calibration", dpi: 203, fonts }) });
  // A legacy version 1 design migrated on the fly, as saved production templates will be.
  const legacy = migrateV1Template({
    dimensions: { width: 75, height: 125, orientation: "landscape", pageWidth: 75, columns: 1 },
    content: { copies: 1, texts: [
      { id: "title", type: "text", angle: 270, pos: { x: 0, y: 123 }, value: "RECEIVE FROM CONING", style: { size: 16, bold: true, background: { enabled: true, paddingMm: 0.7 } } },
      { id: "date", type: "text", angle: 270, pos: { x: 9, y: 122 }, value: "DATE : @date", style: { size: 14, bold: true } },
      { id: "item", type: "text", angle: 270, pos: { x: 15, y: 122 }, value: "ITEM : @itemName (@cut)", style: { size: 14, bold: true, wrapAtCenter: true } },
      { id: "bc", type: "barcode", angle: 270, pos: { x: 45, y: 95 }, value: "{{barcode}}", style: { heightMm: 10, moduleMm: 0.35, humanReadable: true } },
      { id: "vl", type: "line", angle: 90, pos: { x: 6, y: 0 }, style: { lengthMm: 125, thicknessMm: 0.1 } },
    ] },
  });
  jobs.push({ name: "legacy_v1_migrated", artifact: buildPrintableArtifact(legacy, [buildSampleData("coning_receive", "typical")], { stageKey: "coning_receive", dpi: 203, fonts }) });
  const report = [];
  let current = null;
  const printer = createElectronPrinter({
    BrowserWindow,
    session,
    partition: "glintex-print-integration",
    submit: async (win, options, callback) => {
      try {
        const zoom = 3;
        const widthPx = Math.ceil((options.pageSize.width / 1000 / 25.4) * 96 * zoom);
        const heightPx = Math.ceil((options.pageSize.height / 1000 / 25.4) * 96 * zoom);
        win.setContentSize(widthPx + 40, heightPx + 40);
        win.webContents.setZoomFactor(zoom);
        await new Promise((r) => setTimeout(r, 150));
        const image = await win.webContents.capturePage({ x: 0, y: 0, width: widthPx, height: heightPx });
        fs.writeFileSync(path.join(outDir, `${current}.png`), image.toPNG());
        win.webContents.setZoomFactor(1);
        const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
        fs.writeFileSync(path.join(outDir, `${current}.pdf`), pdf);
        callback(true);
      } catch (error) {
        callback(false, error.message);
      }
    },
  });
  for (const job of jobs) {
    current = job.name;
    const started = Date.now();
    const result = await printer(job.artifact, { printerName: "Integration PDF", dpi: 203 });
    report.push({ name: job.name, success: result.success, error: result.error || null, ms: Date.now() - started, widthMm: job.artifact.widthMm, heightMm: job.artifact.heightMm, pages: job.artifact.pages.length, warnings: job.artifact.warnings });
    console.log(job.name.padEnd(36), result.success ? "ok" : `FAILED ${result.error}`, `${Date.now() - started}ms`, job.artifact.warnings.length ? "warnings: " + job.artifact.warnings.join("; ") : "");
  }
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
  const failed = report.filter((r) => !r.success);
  console.log(`print integration: ${report.length - failed.length}/${report.length} jobs submitted through the real printer`);
  clearTimeout(watchdog);
  app.exit(failed.length ? 1 : 0);
}).catch((error) => { console.error(error); app.exit(1); });
