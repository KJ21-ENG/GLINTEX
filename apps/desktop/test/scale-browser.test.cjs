const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const moduleUrl = pathToFileURL(
  path.resolve(__dirname, "../../frontend/src/utils/weightScale.js"),
).href;
test("browser strict parser rejects number guessing, unstable and bracket guessing", async () => {
  const { parseWeightReading } = await import(
    "../../frontend/src/utils/weightScaleParser.js"
  );
  for (const text of [
    "ERR 42",
    "US 12.345 kg",
    "[12345]",
    "42",
    "ST 12 bags",
    "ST 1 kg ST 2 kg",
    "OL 12 kg",
  ])
    assert.equal(parseWeightReading(text), null, text);
  assert.equal(parseWeightReading("ST 12.345 kg").weightKg, 12.345);
});
test("browser USB metadata, retained baud diagnostics and complete-frame capture", async (t) => {
  let controller;
  const port = {
    readable: null,
    getInfo: () => ({ usbVendorId: 1027, usbProductId: 24577 }),
    async open() {
      this.readable = new ReadableStream({
        start(c) {
          controller = c;
        },
      });
    },
    async close() {
      this.readable = null;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { serial: { getPorts: async () => [port], addEventListener() {} } },
  });
  const { getScaleManager } = await import(moduleUrl + "?browser-test");
  const manager = getScaleManager();
  await manager.configure({ profileId: 'st-us-line' });
  t.after(async () => {
    await manager.disconnect();
    delete globalThis.navigator;
  });
  await manager.connect({ port, autoBaud: false, baudRate: 9600 });
  assert.deepEqual(manager.getState().portInfo, {
    vendorId: 1027,
    productId: 24577,
  });
  await manager.connect({ port });
  assert.equal(manager.getState().baudRate, 9600);
  controller.enqueue(new TextEncoder().encode("ST 12.3"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(manager.getState().lastReading, null);
  controller.enqueue(new TextEncoder().encode("45 kg\r\n"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(manager.getState().lastReading.weightKg, 12.345);
  controller.enqueue(
    new TextEncoder().encode("US 12.345 kg\r\nUS 12.345 kg\r\n"),
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(manager.getState().stableReading, null);
  controller.enqueue(new TextEncoder().encode("ERR 42\r\nERR 42\r\n"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(manager.getState().lastReading, null);
});
test("desktop facade never invokes Web Serial and passes capture metadata through", async (t) => {
  const captured = {
    weightKg: 1.23456,
    captureId: "test",
    source: "native-scale",
  };
  globalThis.window = {
    glintexDesktop: {
      scale: {
        onStatus() {},
        status: async () => ({ config: { path: "COM3" }, diagnostics: [] }),
        enumerate: async () => [{ path: "COM2" }, { path: "COM3" }],
        capture: async () => captured,
      },
    },
  };
  t.after(() => {
    delete globalThis.window;
  });
  const { getScaleManager, isWebSerialSupported } = await import(
    moduleUrl + "?desktop-test"
  );
  assert.equal(isWebSerialSupported(), true);
  assert.deepEqual(await getScaleManager().listAuthorizedPorts(), [
    { port: "COM3", info: { path: "COM3" }, label: "COM3" },
  ]);
  assert.equal(await getScaleManager().captureStableWeight(), captured);
});
