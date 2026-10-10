"use strict";
const { validateArtifact, validateProfile, buildDocument } = require("./controller.cjs");
// Electron webContents.print takes microns; printToPDF takes inches.
const printSize = (a) => ({
  width: Math.round(a.widthMm * 1000),
  height: Math.round(a.heightMm * 1000),
});
const pdfSize = (a) => ({ width: a.widthMm / 25.4, height: a.heightMm / 25.4 });
const PRINT_CSP =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";
const SCHEME = "glintex-print";
let counter = 0;

// Documents are served from memory through a private scheme on the print partition:
// no multi-megabyte data: URL for pages that embed fonts, and the content security
// policy arrives as a real response header instead of a meta tag.
function createElectronPrinter({
  BrowserWindow,
  session,
  partition = "glintex-print",
  timeoutMs = 30000,
  // Integration runs replace the Windows submission with printToPDF; production never does.
  submit = (win, options, callback) => win.webContents.print(options, callback),
  cooldownMs = 0,
}) {
  const documents = new Map();
  let handlerReady = false;
  const ensureHandler = () => {
    if (handlerReady || !session) return;
    session.fromPartition(partition).protocol.handle(SCHEME, (request) => {
      const id = new URL(request.url).host;
      const html = documents.get(id);
      if (!html) return new Response("Print document unavailable", { status: 404 });
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": PRINT_CSP,
          "Cache-Control": "no-store",
        },
      });
    });
    handlerReady = true;
  };
  return async (artifact, profile) => {
    validateArtifact(artifact);
    validateProfile(profile);
    const html = buildDocument(artifact);
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
    const id = `job${Date.now().toString(36)}${(counter += 1)}`;
    const timer = setTimeout(() => {
      if (!win.isDestroyed()) win.destroy();
    }, timeoutMs);
    try {
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.session.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      if (session) {
        ensureHandler();
        documents.set(id, html);
        await win.loadURL(`${SCHEME}://${id}/`);
      } else {
        await win.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        );
      }
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
        submit(
          win,
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
      documents.delete(id);
      await disposeWindow(win, cooldownMs);
    }
  };
}

async function disposeWindow(win, cooldownMs) {
  if (!win.isDestroyed()) {
    const closed = new Promise((resolve) => win.once("closed", resolve));
    win.destroy();
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  if (cooldownMs > 0) await new Promise((resolve) => setTimeout(resolve, cooldownMs));
}
module.exports = { createElectronPrinter, printSize, pdfSize, PRINT_CSP, SCHEME };
