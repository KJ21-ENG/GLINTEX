#!/usr/bin/env node
// Backfill synthetic mark events for piece totals that already have wastage > 0
// from before the WastageEvent table existed. Idempotent: skips totals whose
// lastWastageEventId is already set.
//
// Usage:
//   node scripts/backfillWastageEvents.mjs --dry-run   (default)
//   node scripts/backfillWastageEvents.mjs --apply

import prisma from '../src/lib/prisma.js';
import crypto from 'node:crypto';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const DRY_RUN = !APPLY;

function cuid() {
  return 'wev_' + crypto.randomBytes(12).toString('base64url');
}

async function backfillStage(stage, modelKey) {
  const model = prisma[modelKey];
  const totals = await model.findMany({
    where: { wastageNetWeight: { gt: 0 }, lastWastageEventId: null },
  });
  console.log(`[${stage}] candidates: ${totals.length}`);

  let created = 0;
  for (const t of totals) {
    const eventId = cuid();
    const actorUserId = t.updatedByUserId || t.createdByUserId || null;
    const createdAt = t.updatedAt || t.createdAt || new Date();
    const eventData = {
      id: eventId,
      stage,
      pieceId: t.pieceId,
      eventType: 'mark',
      weight: Number(t.wastageNetWeight) || 0,
      note: null,
      reason: null,
      synthetic: true,
      actorUserId,
      createdAt,
    };
    if (DRY_RUN) {
      console.log(`[${stage}] would insert mark event for piece ${t.pieceId} weight ${eventData.weight}`);
      created += 1;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      await tx.wastageEvent.create({ data: eventData });
      await tx[modelKey].update({
        where: { pieceId: t.pieceId },
        data: { lastWastageEventId: eventId },
      });
    });
    created += 1;
  }
  console.log(`[${stage}] ${DRY_RUN ? 'would create' : 'created'}: ${created}`);
  return created;
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY (writing)'}`);
  let total = 0;
  total += await backfillStage('cutter', 'receiveFromCutterMachinePieceTotal');
  total += await backfillStage('coning', 'receiveFromConingMachinePieceTotal');
  total += await backfillStage('holo', 'receiveFromHoloMachinePieceTotal');
  console.log(`Total events ${DRY_RUN ? 'planned' : 'created'}: ${total}`);
  if (DRY_RUN) {
    console.log('Run with --apply to perform writes.');
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
