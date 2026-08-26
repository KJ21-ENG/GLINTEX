import assert from 'node:assert/strict';
import test from 'node:test';
import { activateOnNativeSettingsKey } from '../settingsKeyboard.js';

test('Settings Cancel and tab controls activate on native Enter and Space keys', () => {
  for (const key of ['Enter', ' ']) {
    let prevented = false;
    let activated = 0;
    const handled = activateOnNativeSettingsKey({ key, preventDefault: () => { prevented = true; } }, () => { activated += 1; });
    assert.equal(handled, true);
    assert.equal(prevented, true);
    assert.equal(activated, 1);
  }
  let activated = 0;
  assert.equal(activateOnNativeSettingsKey({ key: 'Tab', preventDefault() {} }, () => { activated += 1; }), false);
  assert.equal(activated, 0);
});
