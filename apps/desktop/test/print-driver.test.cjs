const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createElectronPrinter,
} = require("../src/printing/electron-printer.cjs");
function artifact() {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(400, 16);
  b.writeUInt32BE(200, 20);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b[24] = 8;
  b[25] = 6;
  b.writeUInt32BE(require("node:zlib").crc32(b.subarray(12, 29)), 29);
  return {
    version: 1,
    widthMm: (400 * 25.4) / 203,
    heightMm: (200 * 25.4) / 203,
    dpi: 203,
    pages: [{ pngDataUrl: "data:image/png;base64," + b.toString("base64") }],
  };
}
function fakeWindow(behavior = {}) {
  const seen = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      seen.push(["options", options]);
      this.dead = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        setWindowOpenHandler() {},
        session: { setPermissionRequestHandler() {} },
        executeJavaScript: async () => {
          seen.push(["ready"]);
          if (behavior.badImage) throw new Error("decode failed");
        },
        print: (options, callback) => {
          seen.push(["print", options]);
          if (!behavior.timeout)
            callback(behavior.success !== false, behavior.reason);
        },
      });
    }
    async loadURL(url) {
      seen.push(["url", url]);
    }
    isDestroyed() {
      return this.dead;
    }
    destroy() {
      this.dead = true;
      this.emit("closed");
    }
  }
  return { Window, seen };
}
test("driver waits for artwork, uses exact printer/micron page size and safe window", async () => {
  const { Window, seen } = fakeWindow();
  const r = await createElectronPrinter({ BrowserWindow: Window })(artifact(), {
    printerName: "TSC TE244",
    dpi: 203,
  });
  assert.equal(r.success, true);
  assert.ok(
    seen.findIndex((x) => x[0] === "ready") <
      seen.findIndex((x) => x[0] === "print"),
  );
  const opts = seen.find((x) => x[0] === "print")[1];
  assert.equal(opts.deviceName, "TSC TE244");
  assert.equal(opts.scaleFactor, 100);
  assert.equal(opts.copies, 1);
  assert.equal(opts.margins.marginType, "none");
  const wp = seen[0][1].webPreferences;
  assert.equal(wp.sandbox, true);
  assert.equal(wp.nodeIntegration, false);
  assert.equal(wp.webSecurity, true);
});
test("driver timeout resolves uncertain rather than hangs/retries", async () => {
  const { Window, seen } = fakeWindow({ timeout: true });
  const r = await createElectronPrinter({
    BrowserWindow: Window,
    timeoutMs: 10,
  })(artifact(), { printerName: "TSC TE244", dpi: 203 });
  assert.equal(r.success, false);
  assert.equal(r.uncertain, true);
  assert.equal(seen.filter((x) => x[0] === "print").length, 1);
});
test("invalid decoded artwork fails before Windows print call", async () => {
  const { Window, seen } = fakeWindow({ badImage: true });
  const r = await createElectronPrinter({ BrowserWindow: Window })(artifact(), {
    printerName: "TSC TE244",
    dpi: 203,
  });
  assert.equal(r.success, false);
  assert.equal(r.uncertain, false);
  assert.equal(seen.filter((x) => x[0] === "print").length, 0);
});

test("version 2 documents are served through the private scheme with a strict CSP header", async () => {
  const { buildDocument } = require("../src/printing/controller.cjs");
  const { Window, seen } = fakeWindow();
  const handlers = {};
  const session = { fromPartition: (name) => ({ protocol: { handle: (scheme, handler) => { handlers[`${name}:${scheme}`] = handler; } } }) };
  const html = '<div class="pg" style="width:50mm;height:25mm"><div class="lbw"><div class="lb"><div class="el" data-id="t"><div class="ln">SAVED</div></div></div></div></div>';
  const artifact = { version: 2, dpi: 203, widthMm: 50, heightMm: 25, css: ".pg{position:relative}", fonts: [{ family: "Inter", weight: 700, style: "normal", dataUrl: "data:font/woff2;base64,AAAA" }], pages: [{ html }], templateSnapshot: { stageKey: "inbound" } };
  // The fake window fetches its document through the registered handler, as Chromium would.
  let served = null;
  let url = null;
  Window.prototype.loadURL = async function loadURL(target) {
    url = target;
    served = await handlers["glintex-print:glintex-print"]({ url: target });
  };
  const print = createElectronPrinter({ BrowserWindow: Window, session, partition: "glintex-print" });
  const run = print(artifact, { printerName: "Fixture", dpi: 203 });
  const result = await run;
  assert.equal(result.success, true);
  assert.match(url, /^glintex-print:\/\/job[a-z0-9]+\/$/);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("Content-Security-Policy"), "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'");
  const body = await served.text();
  assert.equal(body, buildDocument(artifact));
  assert.ok(body.includes("@page{size:50mm 25mm;margin:0}") && body.includes('@font-face{font-family:"Inter"') && body.includes("SAVED"));
  const printed = seen.find((e) => e[0] === "print")[1];
  assert.deepEqual(printed.pageSize, { width: 50000, height: 25000 });
  assert.equal(printed.scaleFactor, 100);
  // After the job the document is gone from memory.
  const after = await handlers["glintex-print:glintex-print"]({ url });
  assert.equal(after.status, 404);
});
