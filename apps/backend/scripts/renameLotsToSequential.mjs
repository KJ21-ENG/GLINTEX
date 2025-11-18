import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const prisma = new PrismaClient();

function pad3(n) { return String(n).padStart(3, '0'); }

async function getNext3DigitStart() {
  const lots = await prisma.lot.findMany({ select: { lotNo: true } });
  let max3 = 0;
  for (const l of lots) {
    const m = /^\d{3}$/.exec(l.lotNo);
    if (m) {
      const val = Number(l.lotNo);
      if (Number.isFinite(val) && val > max3) max3 = val;
    }
  }
  return max3 + 1;
}

async function renameLot(oldLotNo, newLotNo) {
  // Fetch inbound items for mapping
  const inbound = await prisma.inboundItem.findMany({ where: { lotNo: oldLotNo }, orderBy: { seq: 'asc' } });
  const pieceIdMap = new Map(inbound.map(p => [p.id, `${newLotNo}-${p.seq}`]));

  await prisma.$transaction(async (tx) => {
    // Update ReceiveRow: pieceId and vchNo
    const recRows = await tx.receiveFromCutterMachineRow.findMany({ where: { OR: [ { pieceId: { startsWith: `${oldLotNo}-` } }, { vchNo: { startsWith: `${oldLotNo}-` } } ] } });
    for (const rr of recRows) {
      const oldPiece = rr.pieceId;
      const newPiece = oldPiece && oldPiece.startsWith(`${oldLotNo}-`) ? oldPiece.replace(`${oldLotNo}-`, `${newLotNo}-`) : oldPiece;
      const oldVch = rr.vchNo;
      const newVch = oldVch && oldVch.startsWith(`${oldLotNo}-`) ? oldVch.replace(`${oldLotNo}-`, `${newLotNo}-`) : oldVch;
      if (newPiece !== rr.pieceId || newVch !== rr.vchNo) {
        await tx.receiveFromCutterMachineRow.update({ where: { id: rr.id }, data: { pieceId: newPiece, vchNo: newVch } });
      }
    }

    // Update ReceivePieceTotal keys
    const rpt = await tx.receiveFromCutterMachinePieceTotal.findMany({ where: { pieceId: { startsWith: `${oldLotNo}-` } } });
    for (const t of rpt) {
      const newId = t.pieceId.replace(`${oldLotNo}-`, `${newLotNo}-`);
      // Upsert to new key then delete old
      await tx.receiveFromCutterMachinePieceTotal.upsert({
        where: { pieceId: newId },
        update: { totalNetWeight: { increment: Number(t.totalNetWeight || 0) } },
        create: { pieceId: newId, totalNetWeight: Number(t.totalNetWeight || 0) },
      });
      await tx.receiveFromCutterMachinePieceTotal.delete({ where: { pieceId: t.pieceId } });
    }

    // Update IssueToMachine for this lot
    const issues = await tx.issueToCutterMachine.findMany({ where: { lotNo: oldLotNo } });
    for (const is of issues) {
      const pieces = (is.pieceIds || '').split(',').map(s => s.trim()).filter(Boolean);
      const newPieces = pieces.map(pid => pid.startsWith(`${oldLotNo}-`) ? pid.replace(`${oldLotNo}-`, `${newLotNo}-`) : pid);
      await tx.issueToCutterMachine.update({ where: { id: is.id }, data: { lotNo: newLotNo, pieceIds: newPieces.join(',') } });
    }

    // Update InboundItem ids and lotNo
    for (const p of inbound) {
      const newId = `${newLotNo}-${p.seq}`;
      await tx.inboundItem.update({ where: { id: p.id }, data: { id: newId, lotNo: newLotNo } });
    }

    // Update Lot
    await tx.lot.update({ where: { lotNo: oldLotNo }, data: { lotNo: newLotNo } });
  });
}

async function main() {
  // Identify lots in 1000-series that we need to rename (1001..1004)
  const candidates = await prisma.lot.findMany({ where: { lotNo: { startsWith: '100' } }, orderBy: { lotNo: 'asc' } });
  if (candidates.length === 0) {
    console.log('No 100x lots found');
    return;
  }
  let next = await getNext3DigitStart();
  const mappings = [];
  for (const l of candidates) {
    const newLotNo = pad3(next++);
    mappings.push({ old: l.lotNo, new: newLotNo });
  }

  for (const m of mappings) {
    console.log(`Renaming ${m.old} -> ${m.new}`);
    await renameLot(m.old, m.new);
  }

  // Set sequence to last assigned
  const last = next - 1;
  await prisma.sequence.upsert({ where: { id: 'lot_sequence' }, update: { nextValue: last }, create: { id: 'lot_sequence', nextValue: last } });
  console.log(`Sequence set to ${last}`);
}

main().finally(()=>prisma.$disconnect());


