const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.resolve(__dirname, '../../frontend/src/utils/weightScale.js')).href;
let moduleId = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));

function serialPort(options = {}) {
  return {
    readable: null, opened: false, opens: [], closes: 0,
    getInfo: () => ({ usbVendorId: 1659, usbProductId: 9123 }),
    async open(settings) {
      this.opens.push(settings);
      if (options.busy) throw new Error('Access denied: port busy');
      assert.equal(this.opened, false, 'port was closed before reopening');
      this.opened = true;
      this.readable = new ReadableStream({ start: controller => {
        this.controller = controller;
        const initial = options.initial?.(settings.baudRate);
        if (initial) controller.enqueue(new TextEncoder().encode(initial));
      } });
    },
    async close() {
      assert.equal(this.readable?.locked, false, 'reader lock was released before close');
      assert.equal(this.opened, true);
      this.opened = false; this.readable = null; ++this.closes;
    },
    send(raw) { this.controller.enqueue(new TextEncoder().encode(raw)); },
  };
}
async function browser(t, ports = [serialPort()], saved = new Map()) {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: {
    getPorts: async () => ports, requestPort: async () => ports[0], addEventListener() {},
  } } });
  globalThis.window = { localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) }, addEventListener() {} };
  const module = await import(url + '?capture=' + ++moduleId);
  const manager = module.getScaleManager();
  t.after(async () => {
    await manager.disconnect();
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  });
  return { manager, module, port: ports[0], saved };
}

test('GT-5 defaults use dynamic authorized port and capture fresh fragmented bracket frames at the physical scale factor', async t => {
  const { manager, port } = await browser(t);
  await manager.connect();
  assert.deepEqual(port.opens[0], { baudRate: 2400, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
  port.send('[03626][03626][03626][03'); await tick();
  assert.equal(manager.getState().stableReading.weightKg, 36.26);
  let settled = false;
  const capture = manager.captureStableWeight({ timeoutMs: 500 }).then(value => { settled = true; return value; });
  await tick();
  assert.equal(manager.getState().stableReading, null);
  port.send('626][03626][03626]'); await tick();
  assert.equal(settled, false, 'pre-request partial frame and two fresh samples cannot capture');
  port.send('[03626]');
  const result = await capture;
  assert.equal(result.weightKg, 36.26);
  assert.equal(result.rawFrame, '[03626]');
  assert.equal(result.profile.decimalPlaces, 2);
  assert.equal(result.source, 'browser-scale');
  const again = manager.captureStableWeight({ timeoutMs: 500 }); await tick();
  port.send('[04'); await tick(); assert.equal(manager.getState().stableReading, null);
  port.send('076][04076][04076]');
  assert.equal((await again).weightKg, 40.76);
  assert.equal(port.opens.length, 1, 'fresh capture retains the continuous reader');
});

test('overflow and invalid bracket frames break the stability sequence', async t => {
  const { manager, port } = await browser(t);
  await manager.connect();
  port.send('[03626][03626]' + 'x'.repeat(600) + '][03626][03626]'); await tick();
  assert.equal(manager.getState().stableReading, null);
  port.send('[03626]'); await tick(); assert.equal(manager.getState().stableReading.weightKg, 36.26);
  port.send('ERR 42]'); await tick(); assert.equal(manager.getState().lastReading, null);
  assert.equal(manager.getState().stableReading, null);
});

test('settings persist, remain editable, and unknown protocols cannot capture', async t => {
  const { manager, port, saved } = await browser(t);
  await manager.configure({ baudRate: 19200, unit: 'g', decimalPlaces: 0 });
  assert.equal(JSON.parse(saved.get('glintex.weightScale.settings')).decimalPlaces, 0);
  const restored = (await import(url + '?restore=' + ++moduleId)).getScaleManager();
  assert.equal(restored.getState().config.baudRate, 19200);
  assert.equal(restored.getState().config.unit, 'g');
  await manager.connect({ port });
  await assert.rejects(manager.configure({}), /Disconnect/);
  await manager.disconnect();
  await manager.configure({ profileId: 'unknown' });
  await manager.connect({ port });
  assert.equal(manager.getState().isConnected, true);
  assert.equal(manager.getState().captureReady, false);
  await assert.rejects(manager.captureStableWeight(), /supported scale protocol/);
});

test('explicit-unit capture discards a pre-request numeric tail and retains full precision', async t => {
  const { manager, port } = await browser(t);
  await manager.configure({ profileId: 'explicit-unit-line' });
  await manager.connect(); port.send('9.'); await tick();
  let settled = false;
  const pending = manager.captureStableWeight({ timeoutMs: 500 }).then(value => { settled = true; return value; });
  await tick(); port.send('999 kg\n12.3456 kg\n12.3456 kg\n'); await tick();
  assert.equal(settled, false);
  port.send('12.3456 kg\n');
  assert.equal((await pending).weightKg, 12.3456);
});

test('optional auto-baud probing frames brackets and reopens before continuous capture', async t => {
  const { manager, port } = await browser(t, [serialPort({ initial: baud => baud === 2400 ? '[03626]' : '?garbled' })]);
  await manager.connect({ autoBaud: true, baudRates: [9600, 2400], probeMs: 30 });
  assert.deepEqual(port.opens.map(settings => settings.baudRate), [9600, 2400, 2400]);
  assert.equal(port.closes, 2);
  const pending = manager.captureStableWeight({ timeoutMs: 500 }); await tick();
  port.send('[03626][03626][03626]');
  assert.equal((await pending).weightKg, 36.26);
});

test('a busy port error is retained rather than retried as an incorrect baud', async t => {
  const { manager, port } = await browser(t, [serialPort({ busy: true })]);
  await assert.rejects(manager.connect({ autoBaud: true, baudRates: [9600, 2400], probeMs: 30 }), /Access denied/);
  assert.equal(port.opens.length, 1);
  assert.equal(manager.getState().captureReady, false);
});

test('ambiguous authorized adapters require a choice; timeout and disconnect reject fresh capture', async t => {
  const { manager, port } = await browser(t, [serialPort(), serialPort()]);
  assert.equal(await manager.getPreferredAuthorizedPort(), null);
  await assert.rejects(manager.connect(), /explicit selection/);
  await manager.connect({ port });
  await assert.rejects(manager.captureStableWeight({ timeoutMs: 100 }), /fresh stable/);
  const pending = manager.captureStableWeight({ port, timeoutMs: 500 });
  const rejected = assert.rejects(pending, /disconnected/i);
  await tick(); await manager.disconnect(); await rejected;
});

 test('legacy openScale keeps complete serial defaults with a baud override', async t => {
  const { module, port } = await browser(t);
  await module.openScale(port, { baudRate: 19200 });
  assert.deepEqual(port.opens[0], { baudRate: 19200, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
  await module.closeScale(port);
});
