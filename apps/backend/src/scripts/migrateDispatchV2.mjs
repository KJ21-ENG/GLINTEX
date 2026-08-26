import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { migrateLegacyDispatches } from '../services/dispatch/migrationService.js';

function option(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : fallback;
}

const idempotencyKey = option('idempotency-key', 'dispatch-v2-legacy-migration');
const actorUserId = option('actor-user-id', null);
const batchSize = option('batch-size', 25);
const startAfter = option('start-after', null);

try {
  const result = await migrateLegacyDispatches({ client: prisma, idempotencyKey, actorUserId, batchSize, startAfter });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
