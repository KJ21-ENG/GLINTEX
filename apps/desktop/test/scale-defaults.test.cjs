const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SCALE_SETTINGS, parseFrame } = require('../src/scale/protocol.cjs');
const { validateConfig } = require('../src/scale/controller.cjs');
const { SettingsStore } = require('../src/settings.cjs');

test('browser and native defaults interpret the physically checked GT-5 frame as 36.260 kg', async () => {
  const browser = await import('../../frontend/src/utils/weightScaleParser.js');
  assert.deepEqual(browser.DEFAULT_SCALE_SETTINGS, DEFAULT_SCALE_SETTINGS);
  assert.equal(validateConfig({}).path, '');
  assert.equal(browser.parseWeightReading('[03626]', browser.DEFAULT_SCALE_SETTINGS).weightKg, 36.26);
  assert.equal(parseFrame('[03626]', DEFAULT_SCALE_SETTINGS).weightKg, 36.26);
  assert.equal(browser.parseWeightReading('[03626]', { ...browser.DEFAULT_SCALE_SETTINGS, decimalPlaces: 3 }).weightKg, 3.626);
  assert.equal(browser.parseWeightReading('[03626]', { profileId: 'bracket-integer' }), null);
});

test('first-run and legacy unknown defaults migrate once; custom and later unknown profiles survive restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'glintex-scale-defaults-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fresh = await new SettingsStore(path.join(directory, 'fresh')).load();
  assert.deepEqual(fresh.get('scale'), { path: '', ...DEFAULT_SCALE_SETTINGS });
  assert.equal(fresh.get('scaleDefaultsVersion'), 1);
  const legacyDirectory = path.join(directory, 'legacy');
  await fs.mkdir(legacyDirectory);
  await fs.writeFile(path.join(legacyDirectory, 'workstation.json'), JSON.stringify({
    schemaVersion: 1, printer: { printerName: 'preserved' }, startAtLogin: true,
    scale: { path: 'COM7', serialNumber: 'known-adapter', profileId: 'unknown', decimalPlaces: 3, baudRate: 9600 },
  }));
  const legacy = await new SettingsStore(legacyDirectory).load();
  assert.equal(legacy.get('scale').path, 'COM7');
  assert.equal(legacy.get('scale').serialNumber, 'known-adapter');
  assert.equal(legacy.get('scale').profileId, 'bracket-integer');
  assert.equal(legacy.get('scale').decimalPlaces, 2);
  assert.equal(legacy.get('scale').baudRate, 2400);
  assert.deepEqual(legacy.get('printer'), { printerName: 'preserved' });
  assert.equal(legacy.get('startAtLogin'), true);
  await legacy.set('scale', { ...legacy.get('scale'), profileId: 'unknown' });
  assert.equal((await new SettingsStore(legacyDirectory).load()).get('scale').profileId, 'unknown');
  const customDirectory = path.join(directory, 'custom');
  await fs.mkdir(customDirectory);
  const custom = { path: 'COM12', profileId: 'st-us-line', baudRate: 19200, unit: 'g', decimalPlaces: 0 };
  await fs.writeFile(path.join(customDirectory, 'workstation.json'), JSON.stringify({ schemaVersion: 1, scale: custom }));
  assert.deepEqual((await new SettingsStore(customDirectory).load()).get('scale'), custom);
});
