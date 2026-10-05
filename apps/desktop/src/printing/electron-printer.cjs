"use strict";
const { validateArtifact, validateProfile } = require("./controller.cjs");
// Electron webContents.print takes microns; printToPDF takes inches.
const printSize = (a) => ({
  width: Math.round(a.widthMm * 1000),
  height: Math.round(a.heightMm * 1000),
});
const pdfSize = (a) => ({ width: a.widthMm / 25.4, height: a.heightMm / 25.4 });
function createElectronPrinter({
  BrowserWindow,
  partition = "glintex-print",
  timeoutMs = 30000,
}) {
  return async (artifact, profile) => {
    validateArtifact(artifact);
    validateProfile(profile);
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    let submitted = false;
    const timer = setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
    }, timeoutMs);
    try {
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.session.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>@page{size:${artifact.widthMm}mm ${artifact.heightMm}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}img{display:block;width:${artifact.widthMm}mm;height:${artifact.heightMm}mm;break-after:page;image-rendering:pixelated}img:last-child{break-after:auto}</style>${artifact.pages.map((p) => `<img src="${p.pngDataUrl}">`).join("")}`;
      await win.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
      );
      await win.webContents.executeJavaScript(
        "Promise.all(Array.from(document.images, img => img.decode())).then(() => document.fonts.ready).then(() => true)",
      );
      return await new Promise((resolve) => {
        let done = false;
        const finish = (result) => {
          if (!done) {
            done = true;
            resolve(result);
          }
        };
        win.once("closed", () =>
          finish({
            success: false,
            uncertain: submitted,
            error:
              "Print window closed or timed out. Check labels before reprinting.",
          }),
        );
        submitted = true;
        win.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: profile.printerName,
            color: false,
            margins: { marginType: "none" },
            pageSize: printSize(artifact),
            scaleFactor: 100,
            copies: 1,
            landscape: false,
            dpi: { horizontal: profile.dpi, vertical: profile.dpi },
          },
          (success, reason) =>
            finish({
              success,
              uncertain:
                !success &&
                !["Invalid printer settings", "Print job canceled"].includes(
                  reason,
                ),
              error: success
                ? undefined
                : reason || "Windows print submission failed",
            }),
        );
      });
    } catch (error) {
      return { success: false, uncertain: submitted, error: error.message };
    } finally {
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
    }
  };
}
module.exports = { createElectronPrinter, printSize, pdfSize };
