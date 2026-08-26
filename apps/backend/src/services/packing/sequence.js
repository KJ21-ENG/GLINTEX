import { badRequest } from './errors.js';

function pad(value, width = 4) {
  return String(value).padStart(width, '0');
}

export function isoDateKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10).replaceAll('-', '');
}

export async function allocateOperationalSequence(tx, key) {
  const row = await tx.operationalSequence.upsert({
    where: { key },
    update: { nextValue: { increment: 1 } },
    create: { key, nextValue: 2 },
  });
  const value = row.nextValue - 1;
  if (!Number.isInteger(value) || value < 1) throw badRequest('sequence_invalid', 'The operational sequence is invalid.');
  return value;
}

export async function allocatePackingBatchNo(tx, date = new Date()) {
  const dateKey = isoDateKey(date);
  const sequence = await allocateOperationalSequence(tx, `packing_batch:${dateKey}`);
  return `PB-${dateKey}-${pad(sequence)}`;
}

export async function allocatePackingUnitBarcode(tx, batchNo, levelIndex, sequence) {
  return `PKU-${batchNo}-L${Number(levelIndex)}-U${pad(sequence)}`;
}

export async function allocateUnitSequence(tx, batchId, levelIndex) {
  return allocateOperationalSequence(tx, `packed_unit:${batchId}:level:${Number(levelIndex)}`);
}

export async function allocateAdjustmentBatchNo(tx, date = new Date()) {
  const dateKey = isoDateKey(date);
  const sequence = await allocateOperationalSequence(tx, `inventory_adjustment:${dateKey}`);
  return `IAB-${dateKey}-${pad(sequence)}`;
}
