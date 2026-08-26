import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { importCutoverOpeningBalances } from '../services/cutover/cutoverService.js';
import { getOption, mergePayload, parseCliArgs, printResult, readJsonFile } from '../services/cutover/cli.js';

async function main() {
  const { options } = parseCliArgs(process.argv.slice(2));
  const input = readJsonFile(getOption(options, 'input', 'file', 'lines-file'), 'input');
  const normalizedOptions = {
    ...options,
    reason: getOption(options, 'reason'),
    effectiveAt: getOption(options, 'effectiveAt', 'effective-at'),
    cutoverBatchId: getOption(options, 'cutoverBatchId', 'cutover-batch-id'),
    openingBatchId: getOption(options, 'openingBatchId', 'opening-batch-id'),
    evidenceSnapshot: getOption(options, 'evidenceSnapshot', 'evidence-file'),
  };
  if (normalizedOptions['evidence-file']) normalizedOptions.evidenceSnapshot = readJsonFile(normalizedOptions['evidence-file'], 'evidence-file');
  const payload = mergePayload(input, normalizedOptions, {
    reason: 'reason',
    effectiveAt: 'effectiveAt',
    cutoverBatchId: 'cutoverBatchId',
    openingBatchId: 'openingBatchId',
    evidenceSnapshot: 'evidenceSnapshot',
  });
  const idempotencyKey = getOption(options, 'idempotency-key', 'idempotencyKey');
  if (!idempotencyKey) throw new Error('--idempotency-key is required.');

  printResult(await importCutoverOpeningBalances({
    payload,
    cutoverBatchId: getOption(options, 'cutover-batch-id', 'cutoverBatchId') || null,
    openingBatchId: getOption(options, 'opening-batch-id', 'openingBatchId') || null,
    actorUserId: getOption(options, 'actor-user-id', 'actorUserId') || null,
    idempotencyKey,
    client: prisma,
  }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error.code || 'opening_balance_import_failed', message: error.message, details: error.details || null }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
