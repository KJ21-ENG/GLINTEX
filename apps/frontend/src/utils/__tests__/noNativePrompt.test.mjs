// The GLINTEX desktop app (Electron) does not implement window.prompt(); calling it throws
// "prompt() is not supported" and the action stops. Screens must use askForInput().
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askForInput, askForQuantity, subscribeInputPrompt } from '../inputPrompt.js';

const src = fileURLToPath(new URL('../../', import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path);
  return /\.(jsx?|tsx?)$/.test(name) ? [path] : [];
});

test('no screen calls the native prompt(), which the desktop app does not support', () => {
  const offenders = files(src).flatMap((path) => readFileSync(path, 'utf8').split('\n')
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /(^|[^\w.$])(window\.)?prompt\s*\(/.test(line.replace(/\/\/.*$/, '')))
    .map(({ i }) => `${relative(src, path)}:${i + 1}`));
  assert.deepEqual(offenders, []);
});

test('askForInput resolves with the answer or null, and quantities are whole numbers', async () => {
  let current = null;
  const unsubscribe = subscribeInputPrompt((request) => { current = request; });
  const answer = askForInput({ title: 'T', defaultValue: 'x' });
  assert.equal(current.title, 'T');
  current.resolve('typed');
  assert.equal(await answer, 'typed');
  assert.equal(current, null);

  const cancelled = askForQuantity();
  assert.equal(current.validate('0'), 'Enter a whole number, 1 or more');
  assert.equal(current.validate('2.5'), 'Enter a whole number, 1 or more');
  assert.equal(current.validate('101'), 'At most 100 at a time');
  assert.equal(current.validate('5'), null);
  current.resolve(null);
  assert.equal(await cancelled, null);

  const qty = askForQuantity();
  current.resolve('5');
  assert.equal(await qty, 5);
  unsubscribe();
  await assert.rejects(askForInput(), /not available/);
});
