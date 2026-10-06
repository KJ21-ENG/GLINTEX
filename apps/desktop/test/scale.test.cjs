const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  ScaleController,
  validateConfig,
} = require("../src/scale/controller.cjs");
const { parseFrame, FrameBuffer } = require("../src/scale/protocol.cjs");
class MockSerial extends EventEmitter {
  static ports = [
    {
      path: "COM3",
      serialNumber: "factory-test",
      vendorId: "0403",
      productId: "6001",
    },
  ];
  static async list() {
    return this.ports;
  }
  constructor(options) {
    super();
    this.options = options;
  }
  open(callback) {
    this.isOpen = true;
    callback();
  }
  close(callback) {
    this.isOpen = false;
    this.emit("close");
    callback?.();
  }
}
const config = {
  path: "COM3",
  profileId: "st-us-line",
  stabilitySamples: 2,
  staleMs: 100,
};
function make(t, options = {}) {
  const c = new ScaleController({
    serialProvider: MockSerial,
    config,
    ...options,
  });
  t.after(() => c.dispose());
  return c;
}
test("reject ERR 42, arbitrary numbers, overload, unknown units and unstable US", () => {
  for (const text of [
    "ERR 42",
    "ERROR 12.345 kg",
    "OL",
    "ST 1 tonne",
    "invoice 12.3",
    "ST NaN kg",
    "ST 90000 kg",
  ])
    assert.equal(parseFrame(text, config).valid, false, text);
  assert.equal(parseFrame("US 12.345 kg", config).stable, false);
  assert.equal(parseFrame("ST 12.345 kg", config).weightKg, 12.345);
  assert.equal(parseFrame("ST 12345 g", config).weightKg, 12.345);
  assert.equal(parseFrame("ST 1 lb", config).weightKg, 0.45359237);
  assert.equal(
    parseFrame("ST 12.345 kg", { profileId: "unknown" }).valid,
    false,
  );
});
test("frame buffering never parses fragments, handles multiple frames and overflow", () => {
  const f = new FrameBuffer("st-us-line");
  assert.deepEqual(f.push("ST 12.3"), []);
  assert.deepEqual(f.push("45 kg\r"), ["ST 12.345 kg"]);
  assert.deepEqual(f.push("\nST 1 kg\r\nST 2 kg\n"), ["ST 1 kg", "ST 2 kg"]);
  assert.deepEqual(f.push("x".repeat(600) + "ST 12 kg\n"), []);
  assert.deepEqual(f.push("ST 1 kg\n"), ["ST 1 kg"]);
});
test("bracket scaling is explicit and complete only", () => {
  const f = new FrameBuffer("bracket-integer");
  assert.deepEqual(f.push("[123"), []);
  assert.deepEqual(f.push("45]"), ["[12345]"]);
  assert.equal(
    parseFrame("[12345]", {
      profileId: "bracket-integer",
      unit: "kg",
      decimalPlaces: 3,
    }).weightKg,
    12.345,
  );
  assert.equal(parseFrame("[12345]", config).valid, false);
});
test("fresh capture rejects pre-request samples, fragments, ERR and US; preserves precision", async (t) => {
  const c = make(t);
  await c.connect();
  c.receive("ST 10 kg\nST 10 kg\n");
  const promise = c.capture({ timeoutMs: 1000 });
  await new Promise((r) => setImmediate(r));
  c.receive("ERR 42\nERR 42\nUS 12.345 kg\nUS 12.345 kg\nST 12.3");
  assert.equal(c.status().stableReading, null);
  c.receive("456 kg\nST 12.3456 kg\n");
  const result = await promise;
  assert.equal(result.weightKg, 12.3456);
  assert.equal(result.source, "native-scale");
  assert.ok(result.captureId);
  assert.equal(result.rawFrame, "ST 12.3456 kg");
});
test("capture concurrency and timeouts are explicit", async (t) => {
  const c = make(t);
  const first = c.capture({ timeoutMs: 100 });
  await assert.rejects(c.capture(), /already in progress/);
  await assert.rejects(first, /timeout/);
  assert.equal(c.pending, null);
});
test("stale readings are not stable", async (t) => {
  const c = make(t);
  await c.connect();
  c.receive("ST 1 kg\nST 1 kg\n");
  assert.ok(c.status().stableReading);
  c.lastReading.ts -= 500;
  c.checkStale();
  assert.equal(c.status().stableReading, null);
  assert.equal(c.status().status, "stale");
});
test("disconnect rejects capture and reconnect keeps configured port and serial settings", async (t) => {
  const c = make(t);
  const capture = c.capture();
  await new Promise((r) => setImmediate(r));
  c.port.close();
  await assert.rejects(capture, /disconnected/);
  await c.connect();
  assert.equal(c.port.options.path, "COM3");
  assert.equal(c.port.options.baudRate, 2400);
  await c.suspend();
  assert.equal(c.status().status, "suspended");
  await c.resume();
  assert.equal(c.status().isConnected, true);
});
test("missing, changed and ambiguous identities never substitute another scale", async (t) => {
  const c = make(t, { config: { ...config, path: "COM99" } });
  await assert.rejects(c.connect(), /unavailable/);
  const changed = make(t, { config: { ...config, serialNumber: "different" } });
  await assert.rejects(changed.connect(), /identity changed/);
  class Duplicate extends MockSerial {
    static async list() {
      return [MockSerial.ports[0], MockSerial.ports[0]];
    }
  }
  const ambiguous = make(t, { serialProvider: Duplicate });
  await assert.rejects(ambiguous.connect(), /ambiguous/);
});
test("busy port failure, bounded diagnostics and configuration validation", async (t) => {
  class Busy extends MockSerial {
    open(callback) {
      callback(new Error("Access denied"));
    }
  }
  const c = make(t, { serialProvider: Busy });
  await assert.rejects(c.connect(), /Access denied/);
  assert.match(c.status().error, /busy/);
  const good = make(t);
  await good.connect();
  good.receive("ERR 42\n".repeat(100));
  assert.equal(good.status().diagnostics.length, 40);
  assert.throws(() => validateConfig({ baudRate: 0 }));
  assert.throws(() => validateConfig({ evil: true }));
  const unknown = make(t, { config: { path: "COM3", profileId: "unknown" } });
  await assert.rejects(unknown.capture(), /Unknown scale protocol/);
});
test("unstable frame interrupts an otherwise stable sequence", async (t) => {
  const c = make(t);
  const pending = c.capture({ timeoutMs: 1000 });
  await new Promise((r) => setImmediate(r));
  c.receive("ST 1 kg\nUS 1 kg\nST 1 kg\n");
  assert.equal(c.status().stableReading, null);
  c.receive("ST 1 kg\n");
  assert.equal((await pending).weightKg, 1);
});
test("settings save is explicit, validates before persistence, and preserves identity", async (t) => {
  const saved = [];
  const c = make(t, { saveConfig: async (value) => saved.push(value) });
  await c.configure({
    ...config,
    serialNumber: "factory-test",
    baudRate: 19200,
  });
  await c.connect();
  assert.equal(c.port.options.baudRate, 19200);
  assert.equal(saved.length, 1);
  await assert.rejects(
    c.configure({ ...config, baudRate: 999 }),
    /Invalid serial/,
  );
  assert.equal(saved.length, 1);
});
test("pre-capture partial frame and high-bit corrupted input are not accepted", async (t) => {
  const c = make(t);
  await c.connect();
  c.receive("ST 9.");
  const pending = c.capture({ timeoutMs: 1000 });
  await new Promise((r) => setImmediate(r));
  c.receive("999 kg\n");
  assert.equal(c.status().lastReading, null);
  c.receive(Buffer.from([0xd3, 0xd4, 0x20, 0x31, 0x20, 0x6b, 0x67, 0x0a]));
  assert.equal(c.status().lastReading, null);
  c.receive("ST 2 kg\nST 2 kg\n");
  assert.equal((await pending).weightKg, 2);
});
test("native open and enumeration deadlines bound capture without callbacks", async (t) => {
  class NeverOpen extends MockSerial {
    open(callback) {
      this.openCallback = callback;
    }
  }
  const c = make(t, {
    serialProvider: NeverOpen,
    openTimeoutMs: 20,
    closeTimeoutMs: 20,
  });
  const started = Date.now();
  await assert.rejects(c.capture(), /open timed out/);
  assert.ok(Date.now() - started < 500);
  assert.equal(c.status().isConnected, false);
  assert.equal(c.captureStarting, false);
  class NeverList extends MockSerial {
    static list() {
      return new Promise(() => {});
    }
  }
  const list = make(t, { serialProvider: NeverList, openTimeoutMs: 20 });
  await assert.rejects(list.capture(), /enumeration timed out/);
});
test("late open after timeout is closed and cannot publish or capture", async (t) => {
  let native;
  class LateOpen extends MockSerial {
    constructor(options) {
      super(options);
      native = this;
    }
    open(callback) {
      this.openCallback = callback;
    }
  }
  const c = make(t, {
    serialProvider: LateOpen,
    openTimeoutMs: 20,
    closeTimeoutMs: 20,
  });
  await assert.rejects(c.capture(), /open timed out/);
  native.isOpen = true;
  native.openCallback();
  native.emit("data", Buffer.from("ST 99 kg\nST 99 kg\n"));
  await new Promise((r) => setImmediate(r));
  assert.equal(native.isOpen, false);
  assert.equal(c.status().lastReading, null);
  assert.equal(c.status().isConnected, false);
});
test("disconnect cancels opening and late completion never changes disconnected state", async (t) => {
  let native;
  class Slow extends MockSerial {
    constructor(o) {
      super(o);
      native = this;
    }
    open(cb) {
      this.callback = cb;
    }
  }
  const c = make(t, { serialProvider: Slow, openTimeoutMs: 100 });
  const capture = c.capture();
  await new Promise((r) => setImmediate(r));
  const rejected = assert.rejects(capture, /cancelled/);
  await c.disconnect();
  await rejected;
  native.isOpen = true;
  native.callback();
  await new Promise((r) => setImmediate(r));
  assert.equal(c.status().status, "disconnected");
  assert.equal(c.status().isConnected, false);
});
test("native close deadline bounds disconnect, suspend and dispose and blocks unsafe reconnect", async (t) => {
  class NeverClose extends MockSerial {
    close(callback) {
      this.closeCallback = callback;
    }
  }
  const c = make(t, { serialProvider: NeverClose, closeTimeoutMs: 20 });
  await c.connect();
  const native = c.port;
  const start = Date.now();
  await c.disconnect();
  assert.ok(Date.now() - start < 500);
  assert.match(c.status().error, /close timed out/);
  await assert.rejects(c.connect(), /has not closed/);
  await c.suspend();
  await c.dispose();
  assert.equal(c.status().isConnected, false);
  native.isOpen = false;
  native.emit("close");
  assert.equal(c.closingPort, null);
});
test("resume respects deliberately disconnected configured device", async (t) => {
  const c = make(t);
  await c.suspend();
  await c.resume();
  assert.equal(c.status().isConnected, false);
  await c.connect();
  await c.suspend();
  await c.resume();
  assert.equal(c.status().isConnected, true);
  await c.disconnect();
  await c.suspend();
  await c.resume();
  assert.equal(c.status().isConnected, false);
});
test("frame bursts preserve capture but bound renderer status notifications", async (t) => {
  const c = make(t);
  let notifications = 0;
  c.subscribe(() => notifications++);
  const pending = c.capture();
  await new Promise((r) => setImmediate(r));
  const before = notifications;
  c.receive("ST 1 kg\n".repeat(2000));
  assert.equal((await pending).weightKg, 1);
  assert.equal(c.sequence, 2000);
  assert.ok(notifications - before <= 2);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(notifications - before <= 3);
  assert.equal(c.status().diagnostics.length, 40);
});
test("PNP identity mismatch is explicit and weak identity is disclosed", async (t) => {
  const c = make(t);
  assert.match(c.status().identityWarning, /Port-only identity/);
  const mismatched = make(t, { config: { ...config, pnpId: "USB\\UNKNOWN" } });
  await assert.rejects(mismatched.connect(), /identity changed/);
  class Identified extends MockSerial {
    static async list() {
      return [{ ...MockSerial.ports[0], pnpId: "USB\\TEST" }];
    }
  }
  const adapter = make(t, {
    serialProvider: Identified,
    config: { ...config, pnpId: "USB\\TEST" },
  });
  await adapter.connect();
  assert.match(adapter.status().identityWarning, /Adapter identity only/);
  const capture = adapter.capture();
  await new Promise((r) => setImmediate(r));
  adapter.receive("ST 2 kg\nST 2 kg\n");
  const result = await capture;
  assert.equal(result.device.pnpId, "USB\\TEST");
  assert.match(result.device.identityWarning, /physical scale/);
  const serial = make(t, {
    config: { ...config, serialNumber: "factory-test" },
  });
  assert.equal(serial.status().identityWarning, null);
});
