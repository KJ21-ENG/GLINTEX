import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { reverseCutover } from '../services/cutover/cutoverService.js';
import { getOption, mergePayload, parseCliArgs, printResult, readJsonFile } from '../services/cutover/cli.js';

async function main() {
  const { options } = parseCliArgs(process.argv.slice(2));
  const inputPath = getOption(options, 'input', 'file', 'lines-file');
  const input = inputPath ? readJsonFile(inputPath) : {};
  const normalizedOptions = { ...options, reason: getOption(options, 'reason') };
  const payload = mergePayload(input, normalizedOptions, { reason: 'reason' });
  const batchId = getOption(options, 'batch-id', 'batchId') || payload.batchId;
  const idempotencyKey = getOption(options, 'idempotency-key', 'idempotencyKey');
  if (!batchId) throw new Error('--batch-id is required.');
  if (!idempotencyKey) throw new Error('--idempotency-key is required.');

  printResult(await reverseCutover({
    batchId,
    payload,
    actorUserId: getOption(options, 'actor-user-id', 'actorUserId') || null,
    idempotencyKey,
    client: prisma,
  }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error.code || 'cutover_reverse_failed', message: error.message, details: error.details || null }, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
