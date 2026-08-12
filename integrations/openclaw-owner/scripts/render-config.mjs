#!/usr/bin/env node

import { chmod, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return process.argv[index + 1];
}

const templatePath = resolve(argument('--template'));
const outputPath = resolve(argument('--output'));
const ownerId = argument('--owner-id').trim();
const runtimeRootIndex = process.argv.indexOf('--runtime-root');
const runtimeRootInput = runtimeRootIndex === -1 ? '/var/lib/openclaw-glintex' : process.argv[runtimeRootIndex + 1];
if (!runtimeRootInput) throw new Error('Missing value for --runtime-root.');
const runtimeRoot = resolve(runtimeRootInput);

if (!/^\d{5,20}$/.test(ownerId)) {
  throw new Error('Owner Telegram ID must contain 5 to 20 digits.');
}

const template = await readFile(templatePath, 'utf8');
const ownerMarker = '__OWNER_TELEGRAM_ID__';
const runtimeMarker = '__RUNTIME_ROOT__';
const ownerMarkerCount = template.split(ownerMarker).length - 1;
const runtimeMarkerCount = template.split(runtimeMarker).length - 1;
if (ownerMarkerCount !== 3) {
  throw new Error(`Expected exactly 3 owner-ID markers, found ${ownerMarkerCount}.`);
}
if (runtimeMarkerCount !== 3) {
  throw new Error(`Expected exactly 3 runtime-root markers, found ${runtimeMarkerCount}.`);
}

if (!runtimeRoot.startsWith('/')) throw new Error('Runtime root must be absolute.');

const rendered = template
  .replaceAll(ownerMarker, ownerId)
  .replaceAll(runtimeMarker, runtimeRoot);
if (rendered.includes(ownerMarker) || rendered.includes(runtimeMarker)) {
  throw new Error('A configuration marker remained after rendering.');
}

const temporaryPath = resolve(dirname(outputPath), `.${randomUUID()}.tmp`);
await writeFile(temporaryPath, rendered, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
await chmod(temporaryPath, 0o600);
await rename(temporaryPath, outputPath);
await chmod(outputPath, 0o600);

process.stdout.write(`${outputPath}\n`);
