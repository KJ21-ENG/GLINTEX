"use strict";
const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { DEFAULT_SCALE_SETTINGS, PROFILES, parseFrame, FrameBuffer } = require("./protocol.cjs");
function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid scale configuration");
  const c = {
    path: "",
    ...DEFAULT_SCALE_SETTINGS,
    ...input,
  };
  const allowed = [
    "path",
    "profileId",
    "baudRate",
    "dataBits",
    "stopBits",
    "parity",
    "flowControl",
    "decimalPlaces",
    "unit",
    "minKg",
    "maxKg",
    "stabilitySamples",
    "toleranceKg",
    "staleMs",
    "serialNumber",
    "vendorId",
    "productId",
    "pnpId",
  ];
  if (Object.keys(c).some((k) => !allowed.includes(k)))
    throw new Error("Unknown scale setting");
  if (
    typeof c.path !== "string" ||
    c.path.length > 256 ||
    /[\x00-\x1f]/.test(c.path)
  )
    throw new Error("Invalid device path");
  for (const k of ["serialNumber", "vendorId", "productId", "pnpId"])
    if (
      c[k] != null &&
      (typeof c[k] !== "string" || c[k].length > (k === "pnpId" ? 256 : 128))
    )
      throw new Error("Invalid device identity");
  if (!PROFILES.some((p) => p.id === c.profileId))
    throw new Error("Unsupported scale profile");
  if (
    ![1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(
      c.baudRate,
    ) ||
    ![7, 8].includes(c.dataBits) ||
    ![1, 2].includes(c.stopBits) ||
    !["none", "even", "odd"].includes(c.parity) ||
    !["none", "rtscts"].includes(c.flowControl)
  )
    throw new Error("Invalid serial settings");
  if (
    !["kg", "g", "lb", "oz"].includes(c.unit) ||
    !Number.isInteger(c.decimalPlaces) ||
    c.decimalPlaces < 0 ||
    c.decimalPlaces > 6
  )
    throw new Error("Invalid unit or decimal scale");
  if (
    !Number.isInteger(c.stabilitySamples) ||
    c.stabilitySamples < 2 ||
    c.stabilitySamples > 20 ||
    !Number.isFinite(c.toleranceKg) ||
    c.toleranceKg < 0 ||
    c.toleranceKg > 1 ||
    !Number.isInteger(c.staleMs) ||
    c.staleMs < 100 ||
    c.staleMs > 10000 ||
    !Number.isFinite(c.minKg) ||
    !Number.isFinite(c.maxKg) ||
    c.minKg < -5000 ||
    c.maxKg > 100000 ||
    c.minKg >= c.maxKg
  )
    throw new Error("Invalid capture limits");
  return c;
}
class ScaleController extends EventEmitter {
  constructor({
    serialProvider,
    config = {},
    saveConfig = async () => {},
    openTimeoutMs = 5000,
    closeTimeoutMs = 2000,
  } = {}) {
    super();
    this.provider = serialProvider;
    this.config = validateConfig(config);
    this.saveConfig = saveConfig;
    this.state = "disconnected";
    this.error = null;
    this.port = null;
    this.pending = null;
    this.samples = [];
    this.lastReading = null;
    this.diagnostics = [];
    this.frameBuffer = new FrameBuffer(this.config.profileId);
    this.sequence = 0;
    this.generation = 0;
    if (
      ![openTimeoutMs, closeTimeoutMs].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 30000,
      )
    )
      throw new Error("Invalid native operation deadline");
    this.openTimeoutMs = openTimeoutMs;
    this.closeTimeoutMs = closeTimeoutMs;
    this.closingPort = null;
    this.resumeConnection = false;
    this.suspended = false;
    this.disposed = false;
    this.timer = setInterval(() => this.checkStale(), 250);
    this.timer.unref?.();
  }
  getProvider() {
    if (!this.provider) this.provider = require("serialport").SerialPort;
    return this.provider;
  }
  async enumerate() {
    return (await this.getProvider().list()).map((p) =>
      Object.fromEntries(
        [
          "path",
          "manufacturer",
          "serialNumber",
          "vendorId",
          "productId",
          "pnpId",
        ]
          .filter((k) => p[k] != null)
          .map((k) => [k, String(p[k]).slice(0, 256)]),
      ),
    );
  }
  status() {
    return {
      status: this.state,
      error: this.error,
      isConnected: !!this.port?.isOpen,
      config: { ...this.config },
      portInfo: this.config.path
        ? {
            path: this.config.path,
            serialNumber: this.config.serialNumber,
            vendorId: this.config.vendorId,
            productId: this.config.productId,
            pnpId: this.config.pnpId,
          }
        : null,
      identityWarning: this.identityWarning(),
      baudRate: this.config.baudRate,
      lastReading: this.lastReading,
      stableReading: this.isStable() ? this.lastReading : null,
      diagnostics: this.diagnostics.slice(),
      profiles: PROFILES,
    };
  }
  identityWarning() {
    return this.config.serialNumber
      ? null
      : this.config.pnpId
        ? "Adapter identity only; verify the connected physical scale before capture"
        : "Port-only identity; verify the connected scale before capture";
  }
  subscribe(fn) {
    this.on("status", fn);
    fn(this.status());
    return () => this.off("status", fn);
  }
  publish(state, error = null, coalesce = false) {
    if (state) this.state = state;
    this.error = error;
    const emit = () => {
      this.notificationTimer = null;
      this.lastNotifiedAt = Date.now();
      this.emit("status", this.status());
    };
    if (!coalesce || Date.now() - (this.lastNotifiedAt || 0) >= 100) {
      clearTimeout(this.notificationTimer);
      emit();
    } else if (!this.notificationTimer) {
      this.notificationTimer = setTimeout(
        emit,
        100 - (Date.now() - this.lastNotifiedAt),
      );
      this.notificationTimer.unref?.();
    }
  }
  clear() {
    this.samples = [];
    this.lastReading = null;
    this.frameBuffer.reset();
  }
  async configure(input) {
    if (this.pending || this.captureStarting)
      throw new Error("Cannot configure during a capture");
    const next = validateConfig(input);
    await this.disconnect();
    await this.saveConfig(next);
    this.config = next;
    this.frameBuffer = new FrameBuffer(next.profileId);
    this.publish("disconnected");
    return this.status();
  }
  async connect() {
    if (this.disposed || this.suspended)
      throw new Error("Scale is suspended or disposed");
    if (this.closingPort)
      throw new Error(
        "Previous scale connection has not closed. Disconnect again or restart before reconnecting",
      );
    if (this.connecting) return this.connecting;
    if (this.port?.isOpen) return this.status();
    const pending = this.open();
    this.connecting = pending;
    try {
      return await pending;
    } finally {
      if (this.connecting === pending) this.connecting = null;
    }
  }
  async open() {
    const generation = ++this.generation;
    const deadline = Date.now() + this.openTimeoutMs;
    let ownedPort = null;
    try {
      if (!this.config.path)
        throw new Error("Select a scale in Desktop device settings");
      this.publish("connecting");
      const ports = await this.withTimeout(
        this.enumerate(),
        this.openTimeoutMs,
        "Scale enumeration timed out",
      );
      const exact = ports.filter((p) => p.path === this.config.path);
      if (exact.length !== 1)
        throw new Error(
          "Configured scale unavailable or ambiguous; select it explicitly",
        );
      const device = exact[0];
      for (const k of ["serialNumber", "vendorId", "productId", "pnpId"])
        if (this.config[k] && this.config[k] !== device[k])
          throw new Error(
            "Device identity changed; select and verify the scale explicitly",
          );
      if (generation !== this.generation)
        throw new Error("Connection cancelled");
      const Provider = this.getProvider();
      const c = this.config;
      const port = new Provider({
        path: c.path,
        baudRate: c.baudRate,
        dataBits: c.dataBits,
        stopBits: c.stopBits,
        parity: c.parity,
        rtscts: c.flowControl === "rtscts",
        autoOpen: false,
      });
      this.port = port;
      ownedPort = port;
      port.on("data", (data) => {
        if (this.port === port) this.receive(data);
      });
      port.on("error", (err) => {
        if (this.port === port) {
          this.clear();
          this.failCapture("Scale error: " + err.message);
          this.publish(
            "error",
            "Scale port error: " + String(err.message).slice(0, 200),
          );
        }
      });
      port.on("close", () => {
        if (this.closingPort === port) this.closingPort = null;
        if (this.port === port) {
          this.port = null;
          this.clear();
          this.failCapture("Scale disconnected");
          this.publish(
            "disconnected",
            "Scale disconnected; reconnect the configured device",
          );
        }
      });
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (this.cancelOpen === cancel) this.cancelOpen = null;
          error ? reject(error) : resolve();
        };
        const cancel = () => finish(new Error("Connection cancelled"));
        const timer = setTimeout(
          () => finish(new Error("Scale open timed out")),
          Math.max(1, deadline - Date.now()),
        );
        this.cancelOpen = cancel;
        try {
          port.open((error) => {
            if (
              settled ||
              generation !== this.generation ||
              this.port !== port
            ) {
              // A native driver may complete after cancellation/timeout. It must
              // never reacquire ownership or emit accepted measurements.
              if (port.isOpen) void this.closeBounded(port);
              if (!settled) finish(new Error("Connection cancelled"));
              return;
            }
            finish(error);
          });
        } catch (error) {
          finish(error);
        }
      });
      if (generation !== this.generation || this.port !== port) {
        void this.closeBounded(port);
        throw new Error("Connection cancelled");
      }
      this.clear();
      this.publish(
        c.profileId === "unknown" ? "unknown-protocol" : "connected",
      );
      return this.status();
    } catch (err) {
      if (ownedPort && this.port === ownedPort) this.port = null;
      if (ownedPort?.isOpen) void this.closeBounded(ownedPort);
      if (generation === this.generation)
        this.publish(
          "error",
          "Could not open configured scale (it may be busy): " +
            String(err.message).slice(0, 200),
        );
      throw err;
    }
  }
  receive(chunk) {
    for (const raw of this.frameBuffer.push(
      Buffer.isBuffer(chunk) ? chunk.toString("latin1") : chunk,
    )) {
      const now = Date.now();
      const reading = parseFrame(raw, this.config);
      this.diagnostics.push({
        timestamp: new Date(now).toISOString(),
        raw: raw.replace(/[^\x20-\x7e]/g, "?").slice(0, 512),
        result: reading.valid
          ? reading.stable === false
            ? "unstable"
            : "valid"
          : reading.reason,
      });
      if (this.diagnostics.length > 40) this.diagnostics.shift();
      ++this.sequence;
      if (!reading.valid || reading.stable === false) {
        this.samples = [];
        this.lastReading = null;
        this.publish(
          reading.valid ? "unstable" : reading.reason,
          reading.valid ? null : reading.reason,
          true,
        );
        continue;
      }
      this.lastReading = {
        weightKg: reading.weightKg,
        ts: now,
        sequence: this.sequence,
        meta: { ...reading, parser: reading.profileId, raw: reading.rawFrame },
        ...reading,
      };
      this.samples.push(this.lastReading);
      this.samples = this.samples
        .filter((s) => now - s.ts <= this.config.staleMs)
        .slice(-this.config.stabilitySamples);
      this.publish(this.isStable() ? "stable" : "reading", null, true);
      if (
        this.pending &&
        this.sequence > this.pending.after &&
        this.samples.every((s) => s.sequence > this.pending.after) &&
        this.isStable()
      ) {
        const result = {
          weightKg: reading.weightKg,
          captureId: randomUUID(),
          rawFrame: reading.rawFrame,
          device: {
            path: this.config.path,
            serialNumber: this.config.serialNumber || null,
            vendorId: this.config.vendorId || null,
            productId: this.config.productId || null,
            pnpId: this.config.pnpId || null,
            identityWarning: this.identityWarning(),
          },
          profile: {
            id: this.config.profileId,
            unit: this.config.unit,
            decimalPlaces: this.config.decimalPlaces,
            stabilitySamples: this.config.stabilitySamples,
            toleranceKg: this.config.toleranceKg,
            staleMs: this.config.staleMs,
          },
          profileId: this.config.profileId,
          unit: reading.unit,
          timestamp: new Date(now).toISOString(),
          source: "native-scale",
          meta: {
            ...reading,
            parser: reading.profileId,
            raw: reading.rawFrame,
            stable: true,
          },
          portInfo: this.status().portInfo,
          baudRate: this.config.baudRate,
        };
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.resolve(result);
      }
    }
  }
  isStable() {
    return (
      !!this.lastReading &&
      Date.now() - this.lastReading.ts <= this.config.staleMs &&
      this.samples.length >= this.config.stabilitySamples &&
      Math.max(...this.samples.map((s) => s.weightKg)) -
        Math.min(...this.samples.map((s) => s.weightKg)) <=
        this.config.toleranceKg
    );
  }
  checkStale() {
    if (
      this.lastReading &&
      Date.now() - this.lastReading.ts > this.config.staleMs
    ) {
      this.samples = [];
      this.lastReading = null;
      this.publish("stale", "No fresh scale data");
    }
  }
  async capture({ timeoutMs = 8000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
      throw new Error("Invalid capture timeout");
    if (this.pending || this.captureStarting)
      throw new Error("A scale capture is already in progress");
    if (this.config.profileId === "unknown")
      throw new Error(
        "Unknown scale protocol: configure and verify a supported profile first",
      );
    this.captureStarting = true;
    try {
      await this.connect();
    } finally {
      this.captureStarting = false;
    }
    this.clear(); // discard even partially buffered pre-request frames
    return new Promise((resolve, reject) => {
      this.pending = {
        resolve,
        reject,
        after: this.sequence,
        timer: setTimeout(
          () =>
            this.failCapture("No fresh stable reading before capture timeout"),
          timeoutMs,
        ),
      };
    });
  }
  failCapture(message) {
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
  }
  withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
  closeBounded(port) {
    if (!port?.isOpen) return Promise.resolve(true);
    this.closingPort = port;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok && this.closingPort === port) this.closingPort = null;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), this.closeTimeoutMs);
      try {
        port.close((error) => {
          if (!error && this.closingPort === port) this.closingPort = null;
          finish(!error);
        });
      } catch (_) {
        finish(false);
      }
    });
  }
  async disconnect() {
    ++this.generation;
    this.cancelOpen?.();
    this.connecting = null;
    this.resumeConnection = false;
    this.failCapture("Scale disconnected");
    const port = this.port || this.closingPort;
    this.port = null;
    this.clear();
    const closed = await this.closeBounded(port);
    this.publish(
      closed ? "disconnected" : "error",
      closed
        ? null
        : "Scale close timed out; disconnect again or restart before reconnecting",
    );
  }
  async suspend() {
    const reconnect = !!this.port?.isOpen;
    this.suspended = true;
    await this.disconnect();
    this.resumeConnection = reconnect;
    this.publish(
      "suspended",
      this.closingPort ? "Scale close is unconfirmed" : null,
    );
  }
  async resume() {
    const reconnect = this.resumeConnection;
    this.resumeConnection = false;
    this.suspended = false;
    if (reconnect && this.config.path) {
      try {
        await this.connect();
      } catch (error) {
        this.publish("error", error.message);
      }
    } else this.publish("disconnected");
  }
  async dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    clearTimeout(this.notificationTimer);
    this.notificationTimer = null;
    await this.disconnect();
    this.removeAllListeners();
  }
}
module.exports = { ScaleController, PROFILES, validateConfig };
