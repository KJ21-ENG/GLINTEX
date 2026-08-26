import 'dotenv/config';
import prisma from '../lib/prisma.js';
import {
  acceptCutoverRecovery,
  activateCutover,
  applyCutover,
  getCutoverStatus,
  previewCutover,
} from '../services/cutover/cutoverService.js';
import { getOption, mergePayload, parseCliArgs, printResult, readJsonFile } from '../services/cutover/cli.js';

function payloadFromOptions(options) {
  const inputPath = getOption(options, 'input', 'file', 'lines-file');
  const input = inputPath ? readJsonFile(inputPath) : {};
  const normalizedOptions = {
    ...options,
    reason: getOption(options, 'reason'),
    effectiveAt: getOption(options, 'effectiveAt', 'effective-at'),
    batchId: getOption(options, 'batchId', 'batch-id'),
    evidenceSnapshot: getOption(options, 'evidenceSnapshot', 'evidence-file'),
  };
  if (normalizedOptions['evidence-file']) normalizedOptions.evidenceSnapshot = readJsonFile(normalizedOptions['evidence-file'], 'evidence-file');
  return mergePayload(input, normalizedOptions, {
    reason: 'reason',
    effectiveAt: 'effectiveAt',
    batchId: 'batchId',
    evidenceSnapshot: 'evidenceSnapshot',
  });
}

async function main() {
  const { command, options } = parseCliArgs(process.argv.slice(2), {
    defaultCommand: 'status',
    commands: ['status', 'preview', 'apply', 'activate', 'accept-recovery', 'resume-recovery'],
  });
  const payload = payloadFromOptions(options);
  const actorUserId = getOption(options, 'actor-user-id', 'actorUserId') || null;

  if (command === 'status') {
    printResult(await getCutoverStatus({ client: prisma }));
    return;
  }
  if (command === 'preview') {
    printResult(await previewCutover({ payload, batchId: getOption(options, 'batch-id', 'batchId') || null, client: prisma }));
    return;
  }

  const idempotencyKey = getOption(options, 'idempotency-key', 'idempotencyKey');
  if (!idempotencyKey) throw new Error(`--idempotency-key is required for ${command}.`);

  if (command === 'apply') {
    printResult(await applyCutover({ payload, batchId: getOption(options, 'batch-id', 'batchId') || null, actorUserId, idempotencyKey, client: prisma }));
    return;
  }

  if (command === 'accept-recovery' || command === 'resume-recovery') {
    printResult(await acceptCutoverRecovery({
      payload: { ...payload, confirm: options.confirm === true || options.confirm === 'true', ownerAccepted: options['owner-accepted'] === true || options['owner-accepted'] === 'true' },
      batchId: getOption(options, 'batch-id', 'batchId') || null,
      actorUserId,
      idempotencyKey,
      client: prisma,
    }));
    return;
  }

  printResult(await activateCutover({
    payload: { ...payload, confirm: options.confirm === true || options.confirm === 'true', ownerAccepted: options['owner-accepted'] === true || options['owner-accepted'] === 'true' },
    batchId: getOption(options, 'batch-id', 'batchId') || null,
    actorUserId,
    idempotencyKey,
    client: prisma,
  }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error.code || 'cutover_command_failed', message: error.message, details: error.details || null }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
