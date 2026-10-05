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
