import fs from 'fs';

export function parseCliArgs(argv, { defaultCommand = null, commands = [] } = {}) {
  const args = [...argv];
  let command = defaultCommand;
  if (args[0] && !args[0].startsWith('--')) command = args.shift();
  if (commands.length && command && !commands.includes(command)) {
    throw new Error(`Unknown command "${command}". Expected one of: ${commands.join(', ')}.`);
  }

  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument "${argument}".`);
    const withoutPrefix = argument.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex >= 0) {
      options[withoutPrefix.slice(0, equalsIndex)] = withoutPrefix.slice(equalsIndex + 1);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      options[withoutPrefix] = next;
      index += 1;
    } else {
      options[withoutPrefix] = true;
    }
  }
  return { command, options };
}

export function readJsonFile(filePath, fieldName = 'input') {
  if (!filePath) throw new Error(`--${fieldName} is required.`);
  const raw = fs.readFileSync(String(filePath), 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`The ${fieldName} JSON file must contain an object.`);
  }
  return parsed;
}

export function getOption(options, ...names) {
  for (const name of names) {
    if (options[name] !== undefined) return options[name];
  }
  return undefined;
}

export function mergePayload(input, options, aliases = {}) {
  const payload = { ...(input || {}) };
  for (const [optionName, payloadName] of Object.entries(aliases)) {
    if (options[optionName] !== undefined) payload[payloadName] = options[optionName];
  }
  return payload;
}

export function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}
