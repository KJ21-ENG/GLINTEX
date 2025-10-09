import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import prisma from './prismaClient.js';
import whatsapp from '../whatsapp/service.js';
import { interpolateTemplate, getTemplateByEvent, listTemplates, upsertTemplate } from './utils/whatsappTemplates.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 4000;
const RECEIVE_ROWS_FETCH_LIMIT = 500;
const RECEIVE_UPLOADS_FETCH_LIMIT = 100;

function normalizePieceId(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).trim();
  if (!cleaned) return null;
  const parts = cleaned.split('-').map(p => p.trim()).filter(Boolean);
  if (parts.length === 2 && /^\d+$/.test(parts[0])) {
    const lot = parts[0].padStart(3, '0');
    const seqPart = parts[1];
    if (/^\d+$/.test(seqPart)) {
      const seq = String(Number(seqPart));
      return `${lot}-${seq}`;
    }
    return `${lot}-${seqPart}`;
  }
  return cleaned;
}

function toNumber(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim().replace(/,/g, '');
  if (str === '') return null;
  const num = Number(str);
  if (!Number.isFinite(num)) return null;
  return num;
}

function toInt(val) {
  const num = toNumber(val);
  if (num === null) return null;
  const rounded = Math.round(num);
  return Number.isFinite(rounded) ? rounded : null;
}

function toOptionalString(val) {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  return str ? str : null;
}

function parseReceiveCsvContent(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('CSV content missing');
  }
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex(line => line.toLowerCase().includes('narration'));
  if (headerIndex === -1) {
    throw new Error('Unable to locate header row with Narration column');
  }
  const trimmedLines = lines.slice(headerIndex).join('\n');
  const rawRecords = parse(trimmedLines, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });

  const rows = [];
  const issues = [];
  const duplicateVchNos = new Set();
  const seenInFile = new Set();

  rawRecords.forEach((rec, idx) => {
    const rowPos = idx + 1; // relative to data portion
    const values = Object.values(rec || {}).map(val => (val === undefined || val === null) ? '' : String(val).trim());
    const allEmpty = values.every(v => v === '');
    if (allEmpty) {
      return;
    }
    const narrationRaw = rec['Narration'] ?? '';
    const pieceId = normalizePieceId(narrationRaw);
    const vchNoRaw = rec['VchNo'];
    const vchNo = toOptionalString(vchNoRaw);

    if (!pieceId && !vchNo) {
      return;
    }

    if (!pieceId) {
      issues.push({ type: 'missing_piece', row: rowPos, message: 'Missing Narration / piece id' });
      return;
    }
    if (!vchNo) {
      issues.push({ type: 'missing_vch', row: rowPos, message: 'Missing VchNo' });
      return;
    }
    if (seenInFile.has(vchNo)) {
      duplicateVchNos.add(vchNo);
      return;
    }
    seenInFile.add(vchNo);

    rows.push({
      pieceId,
      vchNo,
      narration: toOptionalString(narrationRaw),
      date: toOptionalString(rec['Date']),
      vchBook: toOptionalString(rec['Vch.Book']),
      barcode: toOptionalString(rec['Barcode']),
      shift: toOptionalString(rec['Shift']),
      godownName: toOptionalString(rec['Godown Name']),
      racNo: toOptionalString(rec['RacNo']),
      prodIssType: toOptionalString(rec['ProdIss Type']),
      yarnName: toOptionalString(rec['Yarn Name']),
      itemName: toOptionalString(rec['Item']),
      cut: toOptionalString(rec['Cut']),
      machineNo: toOptionalString(rec['MachineNo']),
      employee: toOptionalString(rec['Employee']),
      pktTypeName: toOptionalString(rec['PktTypeName']),
      pcsTypeName: toOptionalString(rec['PcsTypeName']),
      pcs: toInt(rec['Pcs']),
      grossWt: toNumber(rec['Grs Wt']),
      tareWt: toNumber(rec['Tare Wt']),
      netWt: toNumber(rec['Net Wt']),
      pktBoxWt: toNumber(rec['PktBoxWt']),
      pcsBoxWt: toNumber(rec['PcsBoxWt']),
      yarnWt: toNumber(rec['YarnWt']),
      totalKg: toNumber(rec['TotalKg']),
      createdBy: toOptionalString(rec['CreatedBy']),
      modifiedBy: toOptionalString(rec['modifyBy']),
    });
  });

  if (duplicateVchNos.size > 0) {
    issues.push({ type: 'duplicate_vch_in_file', rows: Array.from(duplicateVchNos) });
  }

  return { rows, issues };
}

function aggregateNetByPiece(rows) {
  const increments = new Map();
  for (const row of rows) {
    const net = Number(row.netWt || 0);
    if (!Number.isFinite(net) || net <= 0) continue;
    increments.set(row.pieceId, (increments.get(row.pieceId) || 0) + net);
  }
  return increments;
}

async function fetchInboundAndTotals(pieceIds) {
  if (!Array.isArray(pieceIds) || pieceIds.length === 0) {
    return { inboundMap: new Map(), totalsMap: new Map() };
  }
  const [inboundPieces, pieceTotals] = await Promise.all([
    prisma.inboundItem.findMany({ where: { id: { in: pieceIds } } }),
    prisma.receivePieceTotal.findMany({ where: { pieceId: { in: pieceIds } } }),
  ]);
  const inboundMap = new Map(inboundPieces.map(p => [p.id, p]));
  const totalsMap = new Map(pieceTotals.map(t => [t.pieceId, Number(t.totalNetWeight || 0)]));
  return { inboundMap, totalsMap };
}

function buildPieceSummaries(pieceIds, { inboundMap, totalsMap }, incrementsMap = new Map()) {
  const sortedIds = Array.from(new Set(pieceIds)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const pieces = [];
  let totalNetWeight = 0;
  for (const pieceId of sortedIds) {
    const inbound = inboundMap.get(pieceId) || null;
    const inboundWeight = inbound ? Number(inbound.weight || 0) : null;
    const currentReceived = totalsMap.get(pieceId) || 0;
    const delta = incrementsMap.get(pieceId) || 0;
    const nextReceived = currentReceived + delta;
    const currentPending = inboundWeight == null ? null : Math.max(0, inboundWeight - currentReceived);
    const nextPending = inboundWeight == null ? null : Math.max(0, inboundWeight - nextReceived);
    totalNetWeight += delta;
    pieces.push({
      pieceId,
      lotNo: inbound ? inbound.lotNo : null,
      inboundWeight,
      currentReceivedWeight: currentReceived,
      currentPendingWeight: currentPending,
      incrementWeight: delta,
      futureReceivedWeight: nextReceived,
      futurePendingWeight: nextPending,
      inboundExists: Boolean(inbound),
    });
  }
  return { pieces, totalNetWeight };
}

function buildLotSummaries(pieces) {
  const lotMap = new Map();
  for (const piece of pieces) {
    if (!piece.lotNo) continue;
    const lot = lotMap.get(piece.lotNo) || {
      lotNo: piece.lotNo,
      inboundWeight: 0,
      currentReceivedWeight: 0,
      currentPendingWeight: 0,
      incrementWeight: 0,
      futureReceivedWeight: 0,
      futurePendingWeight: 0,
      pieceCount: 0,
    };
    if (Number.isFinite(piece.inboundWeight)) {
      lot.inboundWeight += piece.inboundWeight;
    }
    if (Number.isFinite(piece.currentReceivedWeight)) {
      lot.currentReceivedWeight += piece.currentReceivedWeight;
    }
    if (Number.isFinite(piece.currentPendingWeight)) {
      lot.currentPendingWeight += piece.currentPendingWeight;
    }
    if (Number.isFinite(piece.incrementWeight)) {
      lot.incrementWeight += piece.incrementWeight;
    }
    if (Number.isFinite(piece.futureReceivedWeight)) {
      lot.futureReceivedWeight += piece.futureReceivedWeight;
    }
    if (Number.isFinite(piece.futurePendingWeight)) {
      lot.futurePendingWeight += piece.futurePendingWeight;
    }
    lot.pieceCount += 1;
    lotMap.set(piece.lotNo, lot);
  }
  return Array.from(lotMap.values()).sort((a, b) => a.lotNo.localeCompare(b.lotNo, undefined, { numeric: true, sensitivity: 'base' }));
}

function buildReceiveSummary({ filename, rows, incrementsMap, pieceMeta }) {
  const missingPieces = pieceMeta.pieces.filter(p => !p.inboundExists).map(p => p.pieceId);
  return {
    filename,
    rowCount: rows.length,
    pieceCount: incrementsMap.size,
    totalNetWeight: pieceMeta.totalNetWeight,
    pieces: pieceMeta.pieces,
    lots: buildLotSummaries(pieceMeta.pieces),
    missingPieces,
  };
}

// Helper: send notification for an event using stored templates
async function sendNotification(event, payload) {
  try {
    console.log('sendNotification called for', event, 'payload:', payload && JSON.stringify(payload));
    const tpl = await getTemplateByEvent(event);
    if (!tpl) return console.warn('No template for event', event);
    if (!tpl.enabled) return console.log('Template disabled for event', event);
    const msg = interpolateTemplate(tpl.template, payload || {});
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const recipients = [];
    if (tpl.sendToPrimary !== false && settings && settings.whatsappNumber) {
      recipients.push({ type: 'number', value: settings.whatsappNumber });
    }
    const allowedGroups = (settings && Array.isArray(settings.whatsappGroupIds)) ? settings.whatsappGroupIds : [];
    const templateGroups = (tpl && Array.isArray(tpl.groupIds)) ? tpl.groupIds : [];
    const groupsToSend = templateGroups.filter(id => allowedGroups.includes(id));
    for (const gid of groupsToSend) recipients.push({ type: 'group', value: gid });
    if (recipients.length === 0) return console.warn('No recipients configured for', event);
    const seen = new Set();
    const unique = recipients.filter(r => { const k = `${r.type}:${r.value}`; if (seen.has(k)) return false; seen.add(k); return true; });
    unique.forEach(r => {
      if (r.type === 'number') whatsapp.sendTextSafe(r.value, msg).catch(err => console.error('Failed to send to number', err));
      else whatsapp.sendToChatIdSafe(r.value, msg).catch(err => console.error('Failed to send to group', err));
    });
  } catch (err) {
    console.error('sendNotification error', err);
  }
}

app.get('/api/health', async (req, res) => {
  res.json({ ok: true });
});

app.get('/api/db', async (req, res) => {
  const items = await prisma.item.findMany();
  const firms = await prisma.firm.findMany();
  const suppliers = await prisma.supplier.findMany();
  const machines = await prisma.machine.findMany();
  const operators = await prisma.operator.findMany();
  const lots = await prisma.lot.findMany();
  const inbound_items = await prisma.inboundItem.findMany();
  const issue_to_machine = await prisma.issueToMachine.findMany();
  const settings = await prisma.settings.findMany();
  const receive_uploads = await prisma.receiveUpload.findMany({ orderBy: { uploadedAt: 'desc' }, take: RECEIVE_UPLOADS_FETCH_LIMIT });
  const receive_rows = await prisma.receiveRow.findMany({ orderBy: { createdAt: 'desc' }, take: RECEIVE_ROWS_FETCH_LIMIT });
  const receive_piece_totals = await prisma.receivePieceTotal.findMany();
  res.json({ items, firms, suppliers, machines, operators, lots, inbound_items, issue_to_machine, settings, receive_uploads, receive_rows, receive_piece_totals });
});

// Return the next lot number preview (value that will be used on save)
app.get('/api/sequence/next', async (req, res) => {
  try {
    const seq = await prisma.sequence.findUnique({ where: { id: 'lot_sequence' } });
    const nextVal = (seq ? seq.nextValue : 0) + 1;
    res.json({ next: String(nextVal).padStart(3, '0'), raw: nextVal });
  } catch (err) {
    console.error('Failed to read sequence', err);
    res.status(500).json({ error: 'Failed to read sequence' });
  }
});

// Whatsapp control endpoints
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    const status = whatsapp.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/whatsapp/start', async (req, res) => {
  try {
    // initialize client
    if (!whatsapp.client) {
      await whatsapp.init();
    }
    res.status(202).json({ ok: true });
  } catch (err) {
    console.error('Failed to start whatsapp', err);
    res.status(500).json({ error: String(err) });
  }
});

// List Whatsapp groups
app.get('/api/whatsapp/groups', async (req, res) => {
  try {
    const st = whatsapp.getStatus();
    if (st.status !== 'connected' || !whatsapp.client) return res.status(409).json({ error: 'not_connected' });
    const chats = await whatsapp.client.getChats();
    const groups = (chats || []).filter(c => c.isGroup).map(c => ({ id: c.id?._serialized || c.id || '', name: c.name || '' }));
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Templates endpoints
app.get('/api/whatsapp/templates', async (req, res) => {
  try {
    const t = await listTemplates();
    res.json(t);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.put('/api/whatsapp/templates/:event', async (req, res) => {
  try {
    const { event } = req.params;
    const { enabled, template, sendToPrimary, groupIds } = req.body;
    const cleanGroups = Array.isArray(groupIds) ? groupIds.filter(x => typeof x === 'string') : [];
    const t = await upsertTemplate(event, { enabled: !!enabled, template: template || '', sendToPrimary: sendToPrimary !== false, groupIds: cleanGroups });
    res.json(t);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.post('/api/whatsapp/send-event', async (req, res) => {
  try {
    const { event, payload } = req.body;
    const tpl = await getTemplateByEvent(event);
    if (!tpl || !tpl.enabled) return res.status(400).json({ error: 'Template not enabled or missing' });
    const msg = interpolateTemplate(tpl.template, payload || {});
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const recipients = [];
    if (tpl.sendToPrimary !== false && settings && settings.whatsappNumber) recipients.push({ type: 'number', value: settings.whatsappNumber });
    const allowedGroups = (settings && Array.isArray(settings.whatsappGroupIds)) ? settings.whatsappGroupIds : [];
    const templateGroups = (tpl && Array.isArray(tpl.groupIds)) ? tpl.groupIds : [];
    const groupsToSend = templateGroups.filter(id => allowedGroups.includes(id));
    for (const gid of groupsToSend) recipients.push({ type: 'group', value: gid });
    if (recipients.length === 0) return res.status(400).json({ error: 'No recipients configured' });
    const seen = new Set();
    const unique = recipients.filter(r => { const k = `${r.type}:${r.value}`; if (seen.has(k)) return false; seen.add(k); return true; });
    unique.forEach(r => { if (r.type === 'number') whatsapp.sendTextSafe(r.value, msg).catch(()=>{}); else whatsapp.sendToChatIdSafe(r.value, msg).catch(()=>{}); });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

app.get('/api/whatsapp/qrcode', async (req, res) => {
  try {
    const qr = whatsapp.getQrDataUrl();
    res.json({ qr });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// SSE endpoint for real-time whatsapp events (qr/status)
app.get('/api/whatsapp/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const emitter = whatsapp.getEmitter();
  const onStatus = (data) => res.write(`event: status\ndata: ${JSON.stringify(data)}\n\n`);
  const onQr = (data) => res.write(`event: qr\ndata: ${JSON.stringify(data)}\n\n`);
  emitter.on('status', onStatus);
  emitter.on('qr', onQr);
  req.on('close', () => {
    emitter.off('status', onStatus);
    emitter.off('qr', onQr);
  });
});

app.post('/api/whatsapp/logout', async (req, res) => {
  try {
    await whatsapp.logout();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/whatsapp/send-test', async (req, res) => {
  try {
    const number = req.body.number || '916353131826';
    await whatsapp.sendText(number, 'Hii');
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to send test message', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/lots', async (req, res) => {
  try {
    const { date, itemId, firmId, supplierId, pieces } = req.body;
    if (!date || !itemId || !firmId || !supplierId) {
      return res.status(400).json({ error: 'Missing required lot fields' });
    }
    if (!Array.isArray(pieces) || pieces.length === 0) {
      return res.status(400).json({ error: 'Lot requires at least one piece' });
    }

    const preparedPieces = pieces.map((piece, idx) => {
      const seq = piece.seq || idx + 1;
      const weight = Number(piece.weight);
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`Invalid weight for piece ${idx + 1}`);
      }
      return {
        seq,
        weight,
      };
    });

    const totalPieces = preparedPieces.length;
    const totalWeight = preparedPieces.reduce((sum, piece) => sum + piece.weight, 0);

    const result = await prisma.$transaction(async (tx) => {
      // Get next lot number from sequence
      const sequence = await tx.sequence.upsert({
        where: { id: 'lot_sequence' },
        update: { nextValue: { increment: 1 } },
        create: { id: 'lot_sequence', nextValue: 1 }
      });

      // Use the sequence value directly as the lot number (e.g. "001", "002")
      const lotNo = String(sequence.nextValue).padStart(3, "0");
      
      // Update piece IDs with the actual lot number
      const updatedPieces = preparedPieces.map((piece, idx) => ({
        ...piece,
        id: `${lotNo}-${idx + 1}`,
        lotNo,
        itemId,
        status: 'available',
      }));

      const lot = await tx.lot.create({
        data: {
          lotNo,
          date,
          itemId,
          firmId,
          supplierId,
          totalPieces,
          totalWeight,
        },
      });

      await tx.inboundItem.createMany({ data: updatedPieces });

      return lot;
    });

    res.json({ ok: true, lot: result });
    // Notify inbound created (non-blocking)
    try {
      const itemName = (await prisma.item.findUnique({ where: { id: itemId } })).name || '';
      sendNotification('inbound_created', { itemName, lotNo: result.lotNo, date, totalPieces, totalWeight });
    } catch (e) { console.error('notify inbound error', e); }
  } catch (err) {
    console.error('Failed to create lot', err);
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Lot already exists' });
    } else {
      res.status(500).json({ error: err.message || 'Failed to create lot' });
    }
  }
});

app.post('/api/issue_to_machine', async (req, res) => {
  try {
    const { date, itemId, lotNo, pieceIds, note, machineId, operatorId } = req.body;
    if (!date || !itemId || !lotNo) {
      return res.status(400).json({ error: 'Missing required issue_to_machine fields' });
    }
    if (!Array.isArray(pieceIds) || pieceIds.length === 0) {
      return res.status(400).json({ error: 'pieceIds must be a non-empty array' });
    }

    const issueRecord = await prisma.$transaction(async (tx) => {
      const pieces = await tx.inboundItem.findMany({
        where: { id: { in: pieceIds } },
        orderBy: { seq: 'asc' },
      });

      if (pieces.length !== pieceIds.length) {
        throw new Error('One or more pieces do not exist');
      }

      for (const piece of pieces) {
        if (piece.status !== 'available') {
          throw new Error(`Piece ${piece.id} is not available`);
        }
        if (piece.lotNo !== lotNo) {
          throw new Error(`Piece ${piece.id} does not belong to lot ${lotNo}`);
        }
        if (piece.itemId !== itemId) {
          throw new Error(`Piece ${piece.id} does not match item ${itemId}`);
        }
      }

      const totalWeight = pieces.reduce((sum, piece) => sum + piece.weight, 0);
      const pieceIdsCsv = pieceIds.join(',');

      await tx.inboundItem.updateMany({
        where: { id: { in: pieceIds } },
        data: { status: 'consumed' },
      });

      return tx.issueToMachine.create({
        data: {
          id: randomUUID(),
          date,
          itemId,
          lotNo,
          count: pieceIds.length,
          totalWeight,
          pieceIds: pieceIdsCsv,
          reason: 'internal',
          note: note || null,
          machineId: machineId || null,
          operatorId: operatorId || null,
        },
      });
    });

    res.json({ ok: true, issueToMachine: issueRecord });
    // Notify issue_to_machine created
    try {
      const itemName = (await prisma.item.findUnique({ where: { id: issueRecord.itemId } })).name || '';
      const machineName = issueRecord.machineId ? (await prisma.machine.findUnique({ where: { id: issueRecord.machineId } })).name : '';
      const operatorName = issueRecord.operatorId ? (await prisma.operator.findUnique({ where: { id: issueRecord.operatorId } })).name : '';
      // Include machineNumber for templates (alias of machineName)
      const machineNumber = machineName || '';
      sendNotification('issue_to_machine_created', { itemName, lotNo: issueRecord.lotNo, date: issueRecord.date, count: issueRecord.count, totalWeight: issueRecord.totalWeight, machineName, machineNumber, operatorName, pieceIds: issueRecord.pieceIds ? issueRecord.pieceIds.split(',') : [] });
      // If this issue_to_machine made available pieces for this item drop to zero, notify
      try {
        const availableAfter = await prisma.inboundItem.count({ where: { itemId: issueRecord.itemId, status: 'available' } });
        console.log(`Available pieces after issue_to_machine for ${itemName}: ${availableAfter}`);
        if (availableAfter === 0) {
          console.log(`Triggering out_of_stock notification for ${itemName}`);
          // Add small delay to ensure first message is queued before second
          setTimeout(() => {
            sendNotification('item_out_of_stock', { itemName, available: 0 });
          }, 1000);
        }
      } catch (e) { console.error('failed to check/send out_of_stock after issue_to_machine', e); }
    } catch (e) { console.error('notify issue_to_machine error', e); }
  } catch (err) {
    console.error('Failed to record issue_to_machine', err);
    res.status(400).json({ error: err.message || 'Failed to record issue_to_machine' });
  }
});

app.post('/api/receive_from_machine/import', async (req, res) => {
  try {
    const { filename, content } = req.body || {};
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Missing filename' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing CSV content' });
    }

    const { rows, issues } = parseReceiveCsvContent(content);
    if (issues.length > 0) {
      return res.status(400).json({ error: 'CSV validation failed', issues });
    }
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No usable rows found in CSV' });
    }

    const vchNos = rows.map(r => r.vchNo);
    const existing = await prisma.receiveRow.findMany({ where: { vchNo: { in: vchNos } }, select: { vchNo: true } });
    if (existing.length > 0) {
      const duplicates = existing.map(r => r.vchNo);
      return res.status(409).json({ error: 'Duplicate VchNo detected in database', duplicates });
    }

    const pieceIncrements = aggregateNetByPiece(rows);
    
    const pieceIds = Array.from(pieceIncrements.keys());
    const inboundAndTotals = await fetchInboundAndTotals(pieceIds);
    const pieceMeta = buildPieceSummaries(pieceIds, inboundAndTotals, pieceIncrements);
    const summary = buildReceiveSummary({ filename, rows, incrementsMap: pieceIncrements, pieceMeta });

    const upload = await prisma.$transaction(async (tx) => {
      const createdUpload = await tx.receiveUpload.create({
        data: {
          originalFilename: filename,
          rowCount: rows.length,
        },
      });

      const createPayload = rows.map(row => ({ ...row, uploadId: createdUpload.id }));
      if (createPayload.length > 0) {
        await tx.receiveRow.createMany({ data: createPayload });
      }

      for (const [pieceId, incrementBy] of pieceIncrements.entries()) {
        if (!Number.isFinite(incrementBy) || incrementBy === 0) continue;
        await tx.receivePieceTotal.upsert({
          where: { pieceId },
          update: { totalNetWeight: { increment: incrementBy } },
          create: { pieceId, totalNetWeight: incrementBy },
        });
      }

      return createdUpload;
    });

    res.json({
      ok: true,
      upload: {
        id: upload.id,
        originalFilename: upload.originalFilename,
        uploadedAt: upload.uploadedAt,
        rowCount: upload.rowCount,
      },
      summary,
    });
  } catch (err) {
    console.error('Failed to import receive-from-machine CSV', err);
    res.status(400).json({ error: err.message || 'Failed to import receive-from-machine CSV' });
  }
});

app.post('/api/receive_from_machine/preview', async (req, res) => {
  try {
    const { filename, content } = req.body || {};
    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Missing filename' });
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Missing CSV content' });
    }

    const { rows, issues } = parseReceiveCsvContent(content);
    if (issues.length > 0) {
      return res.status(400).json({ error: 'CSV validation failed', issues });
    }
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No usable rows found in CSV' });
    }

    const vchNos = rows.map(r => r.vchNo);
    const existing = await prisma.receiveRow.findMany({ where: { vchNo: { in: vchNos } }, select: { vchNo: true } });
    if (existing.length > 0) {
      const duplicates = existing.map(r => r.vchNo);
      return res.status(409).json({ error: 'Duplicate VchNo detected in database', duplicates });
    }

    const pieceIncrements = aggregateNetByPiece(rows);
    const pieceIds = Array.from(pieceIncrements.keys());
    const inboundAndTotals = await fetchInboundAndTotals(pieceIds);
    const pieceMeta = buildPieceSummaries(pieceIds, inboundAndTotals, pieceIncrements);
    const summary = buildReceiveSummary({ filename, rows, incrementsMap: pieceIncrements, pieceMeta });

    res.json({
      ok: true,
      preview: summary,
    });
  } catch (err) {
    console.error('Failed to preview receive-from-machine CSV', err);
    res.status(400).json({ error: err.message || 'Failed to preview receive-from-machine CSV' });
  }
});

// Simple import endpoint: replaces data for simplicity
app.post('/api/import', async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: 'Missing body' });

    // Clear existing tables (simple approach for import)
    await prisma.issueToMachine.deleteMany();
    await prisma.inboundItem.deleteMany();
    await prisma.lot.deleteMany();
    await prisma.item.deleteMany();
    await prisma.firm.deleteMany();
    await prisma.supplier.deleteMany();

    // Bulk create
    if (Array.isArray(data.items)) {
      for (const it of data.items) {
        await prisma.item.create({ data: { id: it.id || undefined, name: it.name } });
      }
    }
    if (Array.isArray(data.firms)) {
      for (const f of data.firms) {
        await prisma.firm.create({ data: { id: f.id || undefined, name: f.name } });
      }
    }
    if (Array.isArray(data.suppliers)) {
      for (const s of data.suppliers) {
        await prisma.supplier.create({ data: { id: s.id || undefined, name: s.name } });
      }
    }
    if (Array.isArray(data.lots)) {
      for (const l of data.lots) {
        await prisma.lot.create({ data: { id: l.id || undefined, lotNo: l.lotNo, date: l.date, itemId: l.itemId, firmId: l.firmId, supplierId: l.supplierId || null, totalPieces: l.totalPieces || 0, totalWeight: Number(l.totalWeight || 0) } });
      }
    }
    if (Array.isArray(data.inbound_items)) {
      for (const ii of data.inbound_items) {
        await prisma.inboundItem.create({ data: { id: ii.id, lotNo: ii.lotNo, itemId: ii.itemId, weight: Number(ii.weight || 0), status: ii.status || 'available', seq: ii.seq || 0 } });
      }
    }
    if (Array.isArray(data.issue_to_machine)) {
      for (const c of data.issue_to_machine) {
        await prisma.issueToMachine.create({ data: { id: c.id, date: c.date, itemId: c.itemId, lotNo: c.lotNo, count: c.count || 0, totalWeight: Number(c.totalWeight || 0), pieceIds: Array.isArray(c.pieceIds) ? c.pieceIds.join(',') : (c.pieceIds || ''), reason: c.reason || 'internal', note: c.note || null } });
      }
    }

    // Settings
    if (data.ui && data.ui.brand) {
      const b = data.ui.brand;
      await prisma.settings.upsert({ where: { id: 1 }, update: { brandPrimary: b.primary || '#2E4CA6', brandGold: b.gold || '#D4AF37', logoDataUrl: b.logoDataUrl || null }, create: { id: 1, brandPrimary: b.primary || '#2E4CA6', brandGold: b.gold || '#D4AF37', logoDataUrl: b.logoDataUrl || null } });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Basic CRUD endpoints (items example)
app.get('/api/items', async (req, res) => { res.json(await prisma.item.findMany()); });
app.post('/api/items', async (req, res) => { const { name } = req.body; const item = await prisma.item.create({ data: { name } }); res.json(item); });
app.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  const usage = await prisma.lot.count({ where: { itemId: id } }) + await prisma.inboundItem.count({ where: { itemId: id } }) + await prisma.issueToMachine.count({ where: { itemId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Item is referenced and cannot be deleted' });
  }
  await prisma.item.delete({ where: { id } });
  res.json({ ok: true });
});
// Update item name
app.put('/api/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.item.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Item not found' });
    const updated = await prisma.item.update({ where: { id }, data: { name } });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update item', err);
    res.status(500).json({ error: err.message || 'Failed to update item' });
  }
});

app.get('/api/firms', async (req, res) => { res.json(await prisma.firm.findMany()); });
app.post('/api/firms', async (req, res) => { const { name } = req.body; const firm = await prisma.firm.create({ data: { name } }); res.json(firm); });
app.delete('/api/firms/:id', async (req, res) => {
  const { id } = req.params;
  const usage = await prisma.lot.count({ where: { firmId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Firm is referenced and cannot be deleted' });
  }
  await prisma.firm.delete({ where: { id } });
  res.json({ ok: true });
});
// Update firm name
app.put('/api/firms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.firm.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Firm not found' });
    const updated = await prisma.firm.update({ where: { id }, data: { name } });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update firm', err);
    res.status(500).json({ error: err.message || 'Failed to update firm' });
  }
});

app.get('/api/suppliers', async (req, res) => { res.json(await prisma.supplier.findMany()); });
app.post('/api/suppliers', async (req, res) => { const { name } = req.body; const seller = await prisma.supplier.create({ data: { name } }); res.json(seller); });
app.delete('/api/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  const usage = await prisma.lot.count({ where: { supplierId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Supplier is referenced and cannot be deleted' });
  }
  await prisma.supplier.delete({ where: { id } });
  res.json({ ok: true });
});
// Update supplier name
app.put('/api/suppliers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Supplier not found' });
    const updated = await prisma.supplier.update({ where: { id }, data: { name } });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update supplier', err);
    res.status(500).json({ error: err.message || 'Failed to update supplier' });
  }
});

app.get('/api/machines', async (req, res) => { res.json(await prisma.machine.findMany()); });
app.post('/api/machines', async (req, res) => { const { name } = req.body; const machine = await prisma.machine.create({ data: { name } }); res.json(machine); });
app.delete('/api/machines/:id', async (req, res) => {
  const { id } = req.params;
  const usage = await prisma.issueToMachine.count({ where: { machineId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Machine is referenced and cannot be deleted' });
  }
  await prisma.machine.delete({ where: { id } });
  res.json({ ok: true });
});
// Update machine name
app.put('/api/machines/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.machine.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Machine not found' });
    const updated = await prisma.machine.update({ where: { id }, data: { name } });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update machine', err);
    res.status(500).json({ error: err.message || 'Failed to update machine' });
  }
});

app.get('/api/operators', async (req, res) => { res.json(await prisma.operator.findMany()); });
app.post('/api/operators', async (req, res) => { const { name } = req.body; const operator = await prisma.operator.create({ data: { name } }); res.json(operator); });
app.delete('/api/operators/:id', async (req, res) => {
  const { id } = req.params;
  const usage = await prisma.issueToMachine.count({ where: { operatorId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Operator is referenced and cannot be deleted' });
  }
  await prisma.operator.delete({ where: { id } });
  res.json({ ok: true });
});
// Update operator name
app.put('/api/operators/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.operator.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Operator not found' });
    const updated = await prisma.operator.update({ where: { id }, data: { name } });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update operator', err);
    res.status(500).json({ error: err.message || 'Failed to update operator' });
  }
});

app.delete('/api/issue_to_machine/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find the issue_to_machine record
    const issueRecord = await prisma.issueToMachine.findUnique({ where: { id } });
    if (!issueRecord) {
      return res.status(404).json({ error: 'Issue to machine record not found' });
    }

    // Get the piece IDs from the issue_to_machine record
    const pieceIds = issueRecord.pieceIds ? issueRecord.pieceIds.split(',') : [];
    
    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Delete the issue_to_machine record
      await tx.issueToMachine.delete({ where: { id } });
      
      // Mark pieces as available again
      if (pieceIds.length > 0) {
        await tx.inboundItem.updateMany({
          where: { id: { in: pieceIds } },
          data: { status: 'available' },
        });
      }
    });

    res.json({ ok: true });
    // Notify issue_to_machine deleted
    try {
      const itemName = issueRecord.itemId ? (await prisma.item.findUnique({ where: { id: issueRecord.itemId } })).name : '';
      // include machine/operator info if available
      const machineRec = issueRecord.machineId ? await prisma.machine.findUnique({ where: { id: issueRecord.machineId } }) : null;
      const operatorRec = issueRecord.operatorId ? await prisma.operator.findUnique({ where: { id: issueRecord.operatorId } }) : null;
      const machineNameDel = machineRec ? machineRec.name : '';
      const operatorNameDel = operatorRec ? operatorRec.name : '';
      const machineNumberDel = machineNameDel || '';
      sendNotification('issue_to_machine_deleted', { itemName, lotNo: issueRecord.lotNo, date: issueRecord.date, count: issueRecord.count, totalWeight: issueRecord.totalWeight, pieceIds: issueRecord.pieceIds ? issueRecord.pieceIds.split(',') : [], machineName: machineNameDel, machineNumber: machineNumberDel, operatorName: operatorNameDel });
    } catch (e) { console.error('notify issue_to_machine deleted error', e); }
  } catch (err) {
    console.error('Failed to delete issue_to_machine record', err);
    res.status(500).json({ error: err.message || 'Failed to delete issue_to_machine record' });
  }
});

// Delete a single inbound item (piece)
app.delete('/api/inbound_items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await prisma.inboundItem.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Inbound piece not found' });
    // Do not allow delete if consumed
    if (existing.status === 'consumed') return res.status(400).json({ error: 'Cannot delete consumed piece' });
    await prisma.inboundItem.delete({ where: { id } });
    // Recalculate lot totals
    const agg = await prisma.inboundItem.aggregate({ where: { lotNo: existing.lotNo }, _sum: { weight: true }, _count: { id: true } });
    const totalWeight = Number(agg._sum.weight || 0);
    const totalPieces = Number(agg._count.id || 0);
    await prisma.lot.update({ where: { lotNo: existing.lotNo }, data: { totalWeight, totalPieces } });
    res.json({ ok: true });
    // Notify inbound piece deleted
    try {
      const itemName = existing.itemId ? (await prisma.item.findUnique({ where: { id: existing.itemId } })).name : '';
      sendNotification('inbound_piece_deleted', { itemName, lotNo: existing.lotNo, pieceId: existing.id });
       // If deleting this piece caused available count to become zero, notify
       try {
         const availableAfter = await prisma.inboundItem.count({ where: { itemId: existing.itemId, status: 'available' } });
         console.log(`Available pieces after inbound piece delete for ${itemName}: ${availableAfter}`);
         if (availableAfter === 0) {
           console.log(`Triggering out_of_stock notification for ${itemName}`);
           // Add small delay to ensure first message is queued before second
           setTimeout(() => {
             sendNotification('item_out_of_stock', { itemName, available: 0 });
           }, 1000);
         }
       } catch (e) { console.error('failed to check/send out_of_stock after inbound piece delete', e); }
    } catch (e) { console.error('notify inbound piece deleted error', e); }
  } catch (err) {
    console.error('Failed to delete inbound piece', err);
    res.status(500).json({ error: err.message || 'Failed to delete inbound piece' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const { brandPrimary, brandGold, logoDataUrl, whatsappNumber, whatsappGroupIds } = req.body;
    const hasWhatsAppNumber = Object.prototype.hasOwnProperty.call(req.body, 'whatsappNumber');
    const hasWhatsAppGroupIds = Object.prototype.hasOwnProperty.call(req.body, 'whatsappGroupIds');
    // Normalize incoming whatsappNumber: accept 10-digit numbers without country code
    function normalizeForStore(num) {
      if (!num) return null;
      const digits = String(num).replace(/[^0-9]/g, '');
      if (!digits) return null;
      let d = digits.replace(/^0+/, '');
      if (d.length === 10) d = `91${d}`;
      return d;
    }
    const normalizedWhatsAppNumber = normalizeForStore(whatsappNumber);
    const cleanGroupIds = Array.isArray(whatsappGroupIds) ? whatsappGroupIds.filter(x => typeof x === 'string') : undefined;
    // Try to upsert including whatsappNumber if DB supports it, otherwise fallback without it
    try {
      const updateData = {
        brandPrimary: brandPrimary || '#2E4CA6',
        brandGold: brandGold || '#D4AF37',
        logoDataUrl: logoDataUrl || null,
      };
      if (hasWhatsAppNumber) updateData.whatsappNumber = normalizedWhatsAppNumber || null;
      if (hasWhatsAppGroupIds && cleanGroupIds !== undefined) updateData.whatsappGroupIds = cleanGroupIds;

      const createData = {
        id: 1,
        brandPrimary: brandPrimary || '#2E4CA6',
        brandGold: brandGold || '#D4AF37',
        logoDataUrl: logoDataUrl || null,
      };
      if (hasWhatsAppNumber) createData.whatsappNumber = normalizedWhatsAppNumber || null;
      if (hasWhatsAppGroupIds) createData.whatsappGroupIds = cleanGroupIds || [];

      const settings = await prisma.settings.upsert({
        where: { id: 1 },
        update: updateData,
        create: createData,
      });
      return res.json(settings);
    } catch (innerErr) {
      // Fallback: column may not exist yet (migration not applied). Persist without whatsappNumber
      console.warn('Failed to upsert with whatsappNumber, retrying without it:', innerErr.message || innerErr);
      const settings = await prisma.settings.upsert({
        where: { id: 1 },
        update: {
          brandPrimary: brandPrimary || '#2E4CA6',
          brandGold: brandGold || '#D4AF37',
          logoDataUrl: logoDataUrl || null,
        },
        create: {
          id: 1,
          brandPrimary: brandPrimary || '#2E4CA6',
          brandGold: brandGold || '#D4AF37',
          logoDataUrl: logoDataUrl || null,
        },
      });
      return res.json(settings);
    }
  } catch (err) {
    console.error('Failed to update settings', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Update a single inbound piece (seq, weight)
app.put('/api/inbound_items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { seq, weight } = req.body;
    if (seq !== undefined && (!Number.isInteger(seq) || seq < 1)) return res.status(400).json({ error: 'seq must be a positive integer' });
    if (weight !== undefined && (!Number.isFinite(Number(weight)) || Number(weight) <= 0)) return res.status(400).json({ error: 'weight must be a positive number' });

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.inboundItem.findUnique({ where: { id } });
      if (!existing) throw new Error('Inbound piece not found');

      const updated = await tx.inboundItem.update({ where: { id }, data: { ...(seq !== undefined ? { seq } : {}), ...(weight !== undefined ? { weight: Number(weight) } : {}) } });

      // Recalculate lot totals (totalPieces and totalWeight) based on current inbound items for the lot
      const lotNo = updated.lotNo;
      const agg = await tx.inboundItem.aggregate({ where: { lotNo }, _sum: { weight: true }, _count: { id: true } });
      const totalWeight = Number(agg._sum.weight || 0);
      const totalPieces = Number(agg._count.id || 0);
      await tx.lot.update({ where: { lotNo }, data: { totalWeight, totalPieces } });

      return updated;
    });

    res.json({ ok: true, inboundItem: result });
  } catch (err) {
    console.error('Failed to update inbound item', err);
    res.status(400).json({ error: err.message || 'Failed to update inbound item' });
  }
});

// Delete a lot and its inbound items and issue-to-machine records
app.delete('/api/lots/:lotNo', async (req, res) => {
  try {
    const { lotNo } = req.params;
    // Do not allow delete if any issue_to_machine record exists for this lot
    const consCount = await prisma.issueToMachine.count({ where: { lotNo } });
    if (consCount > 0) {
      return res.status(400).json({ error: 'Cannot delete lot: one or more pieces have been issued' });
    }
    // Gather info for notification before deletion
    const lotRec = await prisma.lot.findUnique({ where: { lotNo } });
    const itemRec = lotRec ? await prisma.item.findUnique({ where: { id: lotRec.itemId } }) : null;
    const totalPieces = lotRec ? Number(lotRec.totalPieces || 0) : 0;

    await prisma.$transaction(async (tx) => {
      await tx.inboundItem.deleteMany({ where: { lotNo } });
      await tx.lot.deleteMany({ where: { lotNo } });
    });

    res.json({ ok: true });

    // Notify lot deletion
    try {
      sendNotification('lot_deleted', { itemName: itemRec ? itemRec.name : '', lotNo, totalPieces, date: lotRec ? lotRec.date : '' });
      // After removing the lot's pieces, if item has zero available pieces now, notify
      try {
        const itemIdentifier = lotRec ? lotRec.itemId : null;
        const itemNameForCheck = itemRec ? itemRec.name : (lotRec ? (await prisma.item.findUnique({ where: { id: lotRec.itemId } })).name : '');
         if (itemIdentifier) {
           const availableAfter = await prisma.inboundItem.count({ where: { itemId: itemIdentifier, status: 'available' } });
           console.log(`Available pieces after lot delete for ${itemNameForCheck}: ${availableAfter}`);
           if (availableAfter === 0) {
             console.log(`Triggering out_of_stock notification for ${itemNameForCheck}`);
             // Add small delay to ensure first message is queued before second
             setTimeout(() => {
               sendNotification('item_out_of_stock', { itemName: itemNameForCheck || '', available: 0 });
             }, 1000);
           }
         }
      } catch (e) { console.error('failed to check/send out_of_stock after lot delete', e); }
    } catch (e) { console.error('notify lot deleted error', e); }
  } catch (err) {
    console.error('Failed to delete lot', err);
    res.status(500).json({ error: err.message || 'Failed to delete lot' });
  }
});

app.listen(PORT, () => {
  console.log(`GLINTEX backend listening on http://localhost:${PORT}`);
  // Initialize Whatsapp service on startup so it restores LocalAuth session if present
  (async () => {
    try {
      await whatsapp.init();
      console.log('Whatsapp service initialized');
    } catch (err) {
      console.error('Failed to initialize Whatsapp service', err);
    }
  })();
});
