import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import prisma from './prismaClient.js';
import whatsapp from '../whatsapp/service.js';
import { interpolateTemplate, getTemplateByEvent, listTemplates, upsertTemplate } from './utils/whatsappTemplates.js';
import { logCrud } from './utils/auditLogger.js';
import bwipjs from 'bwip-js';
import { deriveMaterialCodeFromItem, makeInboundBarcode, makeIssueBarcode, makeReceiveBarcode } from './utils/barcodeHelpers.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 4000;
const RECEIVE_ROWS_FETCH_LIMIT = 500;
const RECEIVE_UPLOADS_FETCH_LIMIT = 100;

function normalizeBarcodeInput(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizePieceId(raw) {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).trim();
  if (!cleaned) return null;
  // Treat underscore as dash so CSVs using 12_5 map to 12-5
  const normalizedSeparators = cleaned.replace(/_/g, '-');
  const parts = normalizedSeparators.split('-').map(p => p.trim()).filter(Boolean);
  if (parts.length === 2 && /^\d+$/.test(parts[0])) {
    const lot = parts[0].padStart(3, '0');
    const seqPart = parts[1];
    if (/^\d+$/.test(seqPart)) {
      const seq = String(Number(seqPart));
      return `${lot}-${seq}`;
    }
    return `${lot}-${seqPart}`;
  }
  return normalizedSeparators;
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

function normalizeWorkerRole(role) {
  const val = typeof role === 'string' ? role.toLowerCase().trim() : '';
  return val === 'helper' ? 'helper' : 'operator';
}

// Helper: Get or create bobbin by name (normalize to "Bobbin" if empty/null)
async function getOrCreateBobbin(pcsTypeName) {
  if (!pcsTypeName || !String(pcsTypeName).trim()) {
    // Default to "Bobbin" if PcsTypeName is empty
    pcsTypeName = 'Bobbin';
  }
  const normalizedName = String(pcsTypeName).trim();
  
  // Try to find existing bobbin (case-insensitive)
  const existing = await prisma.bobbin.findFirst({
    where: {
      name: {
        equals: normalizedName,
        mode: 'insensitive',
      },
    },
  });
  
  if (existing) {
    return existing.id;
  }
  
  // Create new bobbin
  const newBobbin = await prisma.bobbin.create({
    data: { name: normalizedName },
  });
  
  return newBobbin.id;
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

function aggregatePieceCounts(rows) {
  const counts = new Map();
  for (const row of rows) {
    const pcs = Number(row.pcs || 0);
    if (!Number.isFinite(pcs) || pcs <= 0) continue;
    counts.set(row.pieceId, (counts.get(row.pieceId) || 0) + pcs);
  }
  return counts;
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
  const workers = await prisma.operator.findMany();
  const operators = workers.filter(w => (w.role || 'operator') === 'operator');
  const helpers = workers.filter(w => (w.role || 'operator') === 'helper');
  const bobbins = await prisma.bobbin.findMany();
  const boxes = await prisma.box.findMany();
  const lots = await prisma.lot.findMany();
  const inbound_items = await prisma.inboundItem.findMany();
  const issue_to_machine = await prisma.issueToMachine.findMany();
  const settings = await prisma.settings.findMany();
  const receive_uploads = await prisma.receiveUpload.findMany({ orderBy: { uploadedAt: 'desc' }, take: RECEIVE_UPLOADS_FETCH_LIMIT });
  const receive_rows = await prisma.receiveRow.findMany({
    orderBy: { createdAt: 'desc' },
    take: RECEIVE_ROWS_FETCH_LIMIT,
    include: {
      bobbin: {
        select: {
          id: true,
          name: true,
          weight: true,
        },
      },
      box: {
        select: {
          id: true,
          name: true,
          weight: true,
        },
      },
      operator: {
        select: {
          id: true,
          name: true,
        },
      },
      helper: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  const receive_piece_totals = await prisma.receivePieceTotal.findMany();
  res.json({
    items,
    firms,
    suppliers,
    machines,
    workers,
    operators,
    helpers,
    bobbins,
    boxes,
    lots,
    inbound_items,
    issue_to_machine,
    settings,
    receive_uploads,
    receive_rows,
    receive_piece_totals,
  });
});

app.get('/api/issue_to_machine', async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query.barcode);
    if (!barcode) return res.status(400).json({ error: 'Missing barcode query param' });
    const issue = await prisma.issueToMachine.findUnique({ where: { barcode } });
    if (!issue) return res.status(404).json({ error: 'Issue not found' });
    const pieceIds = issue.pieceIds ? issue.pieceIds.split(',').filter(Boolean) : [];
    res.json({ ...issue, pieceIds });
  } catch (err) {
    console.error('Failed to fetch issue by barcode', err);
    res.status(500).json({ error: 'Failed to fetch issue' });
  }
});

app.get('/api/inbound_items/barcode/:code', async (req, res) => {
  try {
    const code = normalizeBarcodeInput(req.params.code);
    if (!code) return res.status(400).json({ error: 'Missing barcode' });
    const piece = await prisma.inboundItem.findUnique({ where: { barcode: code } });
    if (!piece) return res.status(404).json({ error: 'Barcode not found' });
    res.json(piece);
  } catch (err) {
    console.error('Failed to lookup inbound barcode', err);
    res.status(500).json({ error: 'Failed to lookup barcode' });
  }
});

app.get('/api/issue_to_machine/lookup', async (req, res) => {
  try {
    const barcode = normalizeBarcodeInput(req.query.barcode);
    if (!barcode) return res.status(400).json({ error: 'Missing barcode' });
    const issue = await prisma.issueToMachine.findUnique({ where: { barcode } });
    if (!issue) return res.status(404).json({ error: 'Issue barcode not found' });
    const pieceIds = issue.pieceIds ? issue.pieceIds.split(',').map(s => s.trim()).filter(Boolean) : [];
    res.json({ ...issue, pieceIds });
  } catch (err) {
    console.error('Failed to lookup issue barcode', err);
    res.status(500).json({ error: 'Failed to lookup barcode' });
  }
});

app.get('/api/barcodes/render', async (req, res) => {
  try {
    const code = normalizeBarcodeInput(req.query.code);
    if (!code) return res.status(400).json({ error: 'Missing code' });
    const scale = Math.min(Math.max(Number(req.query.scale) || 3, 2), 8);
    const height = Math.min(Math.max(Number(req.query.height) || 12, 8), 30);
    const buffer = await bwipjs.toBuffer({
      bcid: 'code128',
      text: code,
      scale,
      height,
      includetext: true,
      textxalign: 'center',
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('Failed to render barcode', err);
    res.status(500).json({ error: 'Failed to render barcode' });
  }
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

// Set the lot sequence to a specific integer value (so the next created lot becomes value+1)
app.post('/api/sequence/set', async (req, res) => {
  try {
    const { next } = req.body || {};
    const num = Number(next);
    if (!Number.isInteger(num) || num < 0) return res.status(400).json({ error: 'next must be a non-negative integer' });
    const updated = await prisma.sequence.upsert({
      where: { id: 'lot_sequence' },
      update: { nextValue: num },
      create: { id: 'lot_sequence', nextValue: num },
    });
    res.json({ ok: true, nextValue: updated.nextValue });
  } catch (err) {
    console.error('Failed to set sequence', err);
    res.status(500).json({ error: 'Failed to set sequence' });
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
    const force = req.body && (req.body.force === true || req.body.force === 'true');
    await whatsapp.init({ force });
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

      const itemRecord = await prisma.item.findUnique({ where: { id: itemId } });
      if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
      const materialCode = deriveMaterialCodeFromItem(itemRecord);

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
      const updatedPieces = preparedPieces.map((piece, idx) => {
        const seq = idx + 1;
        return {
          ...piece,
          id: `${lotNo}-${seq}`,
          lotNo,
          itemId,
          seq,
          status: 'available',
          barcode: makeInboundBarcode({ materialCode, lotNo, seq }),
        };
      });

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

      await logCrud({
        entityType: 'lot',
        entityId: lot.id,
        action: 'create',
        payload: {
          lotNo,
          date,
          itemId,
          firmId,
          supplierId,
          totalPieces,
          totalWeight,
          pieces: updatedPieces.map(p => ({ id: p.id, seq: p.seq, weight: p.weight })),
        },
        client: tx,
      });

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

    const itemRecord = await prisma.item.findUnique({ where: { id: itemId } });
    if (!itemRecord) return res.status(404).json({ error: 'Item not found' });
    const materialCode = deriveMaterialCodeFromItem(itemRecord);

    const { issueRecord } = await prisma.$transaction(async (tx) => {
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

      const firstSeq = pieces[0]?.seq ?? 0;
      const issueRow = await tx.issueToMachine.create({
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
          barcode: makeIssueBarcode({ materialCode, lotNo, seq: firstSeq }),
        },
      });

        return { issueRecord: issueRow };
      });

    await logCrud({
      entityType: 'issue_to_machine',
      entityId: issueRecord.id,
      action: 'create',
      payload: {
        lotNo: issueRecord.lotNo,
        date: issueRecord.date,
        itemId: issueRecord.itemId,
        count: issueRecord.count,
        totalWeight: issueRecord.totalWeight,
        pieceIds: issueRecord.pieceIds ? issueRecord.pieceIds.split(',') : [],
        machineId: issueRecord.machineId,
        operatorId: issueRecord.operatorId,
      },
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
    const pieceCountIncrements = aggregatePieceCounts(rows);
    
    const pieceIds = Array.from(pieceIncrements.keys());
    const inboundAndTotals = await fetchInboundAndTotals(pieceIds);
    const pieceMeta = buildPieceSummaries(pieceIds, inboundAndTotals, pieceIncrements);
    const summary = buildReceiveSummary({ filename, rows, incrementsMap: pieceIncrements, pieceMeta });

    const upload = await prisma.$transaction(async (tx) => {
      // Normalize PcsTypeName to bobbin IDs (create bobbins if they don't exist)
      const uniquePcsTypeNames = [...new Set(rows.map(r => r.pcsTypeName).filter(Boolean))];
      const bobbinIdMap = new Map();
      
      for (const pcsTypeName of uniquePcsTypeNames) {
        const normalizedName = pcsTypeName.trim() || 'Bobbin';
        // Find or create bobbin (case-insensitive)
        let bobbin = await tx.bobbin.findFirst({
          where: {
            name: {
              equals: normalizedName,
              mode: 'insensitive',
            },
          },
        });
        
        if (!bobbin) {
          bobbin = await tx.bobbin.create({
            data: { name: normalizedName },
          });
        }
        
        bobbinIdMap.set(pcsTypeName, bobbin.id);
      }
      
      // Also ensure "Bobbin" exists for empty/null values
      if (!bobbinIdMap.has(null) && !bobbinIdMap.has('')) {
        let defaultBobbin = await tx.bobbin.findFirst({
          where: {
            name: {
              equals: 'Bobbin',
              mode: 'insensitive',
            },
          },
        });
        
        if (!defaultBobbin) {
          defaultBobbin = await tx.bobbin.create({
            data: { name: 'Bobbin' },
          });
        }
        
        bobbinIdMap.set(null, defaultBobbin.id);
        bobbinIdMap.set('', defaultBobbin.id);
      }

      const createdUpload = await tx.receiveUpload.create({
        data: {
          originalFilename: filename,
          rowCount: rows.length,
        },
      });

      const createPayload = rows.map(row => ({
        ...row,
        uploadId: createdUpload.id,
        bobbinId: bobbinIdMap.get(row.pcsTypeName) || bobbinIdMap.get(null) || bobbinIdMap.get(''),
      }));
      
      if (createPayload.length > 0) {
        await tx.receiveRow.createMany({ data: createPayload });
      }

      for (const [pieceId, incrementBy] of pieceIncrements.entries()) {
        if (!Number.isFinite(incrementBy) || incrementBy === 0) continue;
        const pcsIncrement = pieceCountIncrements.get(pieceId) || 0;
        const updateData = {
          totalNetWeight: { increment: incrementBy },
        };
        if (pcsIncrement > 0) {
          updateData.totalPieces = { increment: pcsIncrement };
        }
        await tx.receivePieceTotal.upsert({
          where: { pieceId },
          update: updateData,
          create: { pieceId, totalNetWeight: incrementBy, totalPieces: pcsIncrement > 0 ? pcsIncrement : 0 },
        });
      }

      return createdUpload;
    });

    await logCrud({
      entityType: 'receive_upload',
      entityId: upload.id,
      action: 'create',
      payload: {
        filename,
        rowCount: upload.rowCount,
        summary,
      },
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

// Mark remaining pending weight for a piece as wastage (only if piece was issued to machine)
app.post('/api/receive_from_machine/mark_wastage', async (req, res) => {
  try {
    const { pieceId } = req.body || {};
    if (!pieceId || typeof pieceId !== 'string') return res.status(400).json({ error: 'Missing pieceId' });

    // Check inbound item exists
    const inbound = await prisma.inboundItem.findUnique({ where: { id: pieceId } });
    if (!inbound) return res.status(404).json({ error: 'Piece not found' });

    // Verify piece was issued to machine at least once
    const issuedCount = await prisma.issueToMachine.count({ where: { pieceIds: { contains: pieceId } } });
    if (issuedCount === 0) return res.status(400).json({ error: 'Piece was not issued to machine' });

    // Fetch current received and wastage totals
    const currentTotal = await prisma.receivePieceTotal.findUnique({ where: { pieceId } });
    const received = currentTotal ? Number(currentTotal.totalNetWeight || 0) : 0;
    const existingWastage = currentTotal ? Number(currentTotal.wastageNetWeight || 0) : 0;

    const inboundWeight = Number(inbound.weight || 0);
    const remaining = Math.max(0, inboundWeight - received - existingWastage);
    if (remaining <= 0) return res.status(400).json({ error: 'No remaining pending weight to mark as wastage' });

    // Upsert wastage increment inside transaction
    const updated = await prisma.$transaction(async (tx) => {
      await tx.receivePieceTotal.upsert({
        where: { pieceId },
        update: { wastageNetWeight: { increment: remaining } },
        create: { pieceId, totalNetWeight: 0, wastageNetWeight: remaining },
      });
      return tx.receivePieceTotal.findUnique({ where: { pieceId } });
    });

    // Send notification
    try {
      const lotNo = inbound.lotNo || '';
      const itemRec = inbound.itemId ? await prisma.item.findUnique({ where: { id: inbound.itemId } }) : null;
      const itemName = itemRec ? itemRec.name || '' : '';
      const wastageFormatted = Number(remaining).toFixed(3);
      const inboundWeight = Number(inbound.weight || 0);
      const wastagePercent = inboundWeight > 0 ? ((remaining / inboundWeight) * 100).toFixed(2) : '0.00';
      sendNotification('piece_wastage_marked', { pieceId, lotNo, itemName, wastage: wastageFormatted, wastagePercent });
    } catch (e) { console.error('notify piece wastage error', e); }

    await logCrud({
      entityType: 'receive_piece_total',
      entityId: pieceId,
      action: 'update',
      before: currentTotal,
      after: updated,
      payload: { action: 'mark_wastage', marked: remaining },
    });

    res.json({ ok: true, pieceId, marked: remaining, updated });
  } catch (err) {
    console.error('Failed to mark wastage', err);
    res.status(500).json({ error: err.message || 'Failed to mark wastage' });
  }
});

app.post('/api/receive_from_machine/manual', async (req, res) => {
  try {
    const {
      pieceId,
      lotNo,
      bobbinId,
      boxId,
      bobbinQuantity,
      operatorId,
      helperId,
      grossWeight,
      receiveDate,
      issueBarcode,
    } = req.body || {};

    if (!boxId) return res.status(400).json({ error: 'Missing box selection' });
    if (!bobbinId) return res.status(400).json({ error: 'Missing bobbin selection' });
    if (!operatorId) return res.status(400).json({ error: 'Missing operator' });

    const normalizedIssueCode = issueBarcode ? normalizeBarcodeInput(issueBarcode) : '';
    let resolvedPieceId = pieceId;
    let resolvedLotNo = lotNo;
    if (normalizedIssueCode) {
      const issue = await prisma.issueToMachine.findUnique({ where: { barcode: normalizedIssueCode } });
      if (!issue) return res.status(404).json({ error: 'Issue barcode not found' });
      const pieceIds = issue.pieceIds ? issue.pieceIds.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (pieceIds.length !== 1) {
        return res.status(400).json({ error: 'Issue barcode must reference exactly one piece' });
      }
      resolvedPieceId = pieceIds[0];
      resolvedLotNo = issue.lotNo;
    }

    if (!resolvedPieceId || typeof resolvedPieceId !== 'string') return res.status(400).json({ error: 'Missing pieceId' });

    const piece = await prisma.inboundItem.findUnique({ where: { id: resolvedPieceId } });
    if (!piece) return res.status(404).json({ error: 'Piece not found' });
    if (resolvedLotNo && piece.lotNo !== resolvedLotNo) return res.status(400).json({ error: 'Piece does not belong to the scanned issue' });

    const bobbin = await prisma.bobbin.findUnique({ where: { id: bobbinId } });
    if (!bobbin) return res.status(404).json({ error: 'Bobbin not found' });
    const box = await prisma.box.findUnique({ where: { id: boxId } });
    if (!box) return res.status(404).json({ error: 'Box not found' });

    const operatorRec = await prisma.operator.findUnique({ where: { id: operatorId } });
    if (!operatorRec || normalizeWorkerRole(operatorRec.role) !== 'operator') {
      return res.status(400).json({ error: 'Invalid operator selected' });
    }
    const helperRec = helperId ? await prisma.operator.findUnique({ where: { id: helperId } }) : null;
    if (helperId && (!helperRec || normalizeWorkerRole(helperRec.role) !== 'helper')) {
      return res.status(400).json({ error: 'Invalid helper selected' });
    }

    const bobbinQty = Math.max(0, toInt(bobbinQuantity) || 0);
    if (bobbinQty <= 0) {
      return res.status(400).json({ error: 'Bobbin quantity must be greater than zero' });
    }
    const gross = toNumber(grossWeight);
    if (gross === null || !Number.isFinite(gross) || gross <= 0) {
      return res.status(400).json({ error: 'Gross weight must be a positive number' });
    }

    const bobbinWeight = Number(bobbin.weight);
    if (!Number.isFinite(bobbinWeight) || bobbinWeight <= 0) {
      return res.status(400).json({ error: 'Bobbin weight missing. Update bobbin first.' });
    }
    const boxWeight = Number(box.weight);
    if (!Number.isFinite(boxWeight) || boxWeight <= 0) {
      return res.status(400).json({ error: 'Box weight missing. Update box first.' });
    }

    const computedTare = boxWeight + bobbinWeight * bobbinQty;
    const net = gross - computedTare;
    if (!Number.isFinite(net) || net <= 0) {
      return res.status(400).json({ error: 'Computed net weight must be positive. Check weights and quantity.' });
    }

    const inboundWeight = Number(piece.weight || 0);
    const currentTotals = await prisma.receivePieceTotal.findUnique({ where: { pieceId: resolvedPieceId } });
    const alreadyReceived = currentTotals ? Number(currentTotals.totalNetWeight || 0) : 0;
    const existingWastage = currentTotals ? Number(currentTotals.wastageNetWeight || 0) : 0;
    const pendingBefore = Math.max(0, inboundWeight - alreadyReceived - existingWastage);
    if (pendingBefore <= 0) {
      return res.status(400).json({ error: 'Piece has no pending weight remaining' });
    }
    if (net - pendingBefore > 1e-6) {
      return res.status(400).json({ error: 'Net weight exceeds pending weight' });
    }

    const receiveDateStr = toOptionalString(receiveDate) || new Date().toISOString().slice(0, 10);
    const vchNo = `MAN-${randomUUID().slice(0, 8)}`;

    const txResult = await prisma.$transaction(async (tx) => {
      const upload = await tx.receiveUpload.create({
        data: {
          originalFilename: 'manual-entry',
          rowCount: 1,
        },
      });

      const receiveBarcode = makeReceiveBarcode({ lotNo: piece.lotNo, seq: piece.seq, crateIndex: 1 });

      const createdRow = await tx.receiveRow.create({
        data: {
          uploadId: upload.id,
          pieceId: resolvedPieceId,
          vchNo,
          date: receiveDateStr,
          grossWt: gross,
          tareWt: computedTare,
          netWt: net,
          totalKg: net,
          pktTypeName: box.name,
          pcsTypeName: bobbin.name,
          bobbinId: bobbin.id,
          boxId: box.id,
          operatorId: operatorRec.id,
          helperId: helperRec ? helperRec.id : null,
          pcs: bobbinQty,
          employee: operatorRec.name,
          shift: helperRec ? helperRec.name : null,
          narration: 'Manual entry',
          createdBy: 'manual',
          barcode: receiveBarcode,
        },
      });

      await tx.receivePieceTotal.upsert({
        where: { pieceId: resolvedPieceId },
        update: {
          totalNetWeight: { increment: net },
          totalPieces: { increment: bobbinQty },
        },
        create: {
          pieceId: resolvedPieceId,
          totalNetWeight: net,
          totalPieces: bobbinQty,
        },
      });

      return {
        rowId: createdRow.id,
        upload,
        receiveBarcode,
      };
    });

    const rowWithRelations = await prisma.receiveRow.findUnique({
      where: { id: txResult.rowId },
      include: {
        bobbin: { select: { id: true, name: true, weight: true } },
        box: { select: { id: true, name: true, weight: true } },
        operator: { select: { id: true, name: true } },
        helper: { select: { id: true, name: true } },
      },
    });

    if (!rowWithRelations) {
      return res.status(500).json({ error: 'Failed to load manual entry' });
    }

    const updatedTotals = await prisma.receivePieceTotal.findUnique({ where: { pieceId: resolvedPieceId } });
    const pendingAfter = Math.max(
      0,
      inboundWeight - Number(updatedTotals?.totalNetWeight || 0) - Number(updatedTotals?.wastageNetWeight || 0)
    );

    res.json({
      ok: true,
      row: rowWithRelations,
      upload: txResult.upload,
      pendingBefore,
      pendingAfter,
      receiveBarcode: txResult.receiveBarcode,
    });
  } catch (err) {
    console.error('Failed to record manual receive', err);
    res.status(500).json({ error: err.message || 'Failed to record manual receive' });
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
    await prisma.receiveRow.deleteMany();
    await prisma.receiveUpload.deleteMany();
    await prisma.receivePieceTotal.deleteMany();
    await prisma.inboundItem.deleteMany();
    await prisma.lot.deleteMany();
    await prisma.item.deleteMany();
    await prisma.firm.deleteMany();
    await prisma.supplier.deleteMany();
    await prisma.operator.deleteMany();
    await prisma.bobbin.deleteMany();
    await prisma.box.deleteMany();

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
    if (Array.isArray(data.workers)) {
      for (const w of data.workers) {
        await prisma.operator.create({ data: { id: w.id || undefined, name: w.name, role: normalizeWorkerRole(w.role) } });
      }
    }
    if (Array.isArray(data.bobbins)) {
      for (const b of data.bobbins) {
        await prisma.bobbin.create({ data: { id: b.id || undefined, name: b.name, weight: b.weight != null ? Number(b.weight) : null } });
      }
    }
    if (Array.isArray(data.boxes)) {
      for (const box of data.boxes) {
        await prisma.box.create({ data: { id: box.id || undefined, name: box.name, weight: Number(box.weight || 0) } });
      }
    }

    // Settings
    if (data.ui && data.ui.brand) {
      const b = data.ui.brand;
      await prisma.settings.upsert({ where: { id: 1 }, update: { brandPrimary: b.primary || '#2E4CA6', brandGold: b.gold || '#D4AF37', logoDataUrl: b.logoDataUrl || null }, create: { id: 1, brandPrimary: b.primary || '#2E4CA6', brandGold: b.gold || '#D4AF37', logoDataUrl: b.logoDataUrl || null } });
    }

    await logCrud({
      entityType: 'import',
      entityId: null,
      action: 'import',
      payload: {
        counts: {
          items: Array.isArray(data.items) ? data.items.length : 0,
          firms: Array.isArray(data.firms) ? data.firms.length : 0,
          suppliers: Array.isArray(data.suppliers) ? data.suppliers.length : 0,
          lots: Array.isArray(data.lots) ? data.lots.length : 0,
          inboundItems: Array.isArray(data.inbound_items) ? data.inbound_items.length : 0,
          issues: Array.isArray(data.issue_to_machine) ? data.issue_to_machine.length : 0,
          workers: Array.isArray(data.workers) ? data.workers.length : 0,
          bobbins: Array.isArray(data.bobbins) ? data.bobbins.length : 0,
          boxes: Array.isArray(data.boxes) ? data.boxes.length : 0,
        },
      },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

// Basic CRUD endpoints (items example)
app.get('/api/items', async (req, res) => { res.json(await prisma.item.findMany()); });
app.post('/api/items', async (req, res) => {
  const { name } = req.body;
  const item = await prisma.item.create({ data: { name } });
  await logCrud({
    entityType: 'item',
    entityId: item.id,
    action: 'create',
    payload: item,
  });
  res.json(item);
});
app.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params;
  const existingItem = await prisma.item.findUnique({ where: { id } });
  if (!existingItem) {
    return res.status(404).json({ error: 'Item not found' });
  }
  const usage = await prisma.lot.count({ where: { itemId: id } }) + await prisma.inboundItem.count({ where: { itemId: id } }) + await prisma.issueToMachine.count({ where: { itemId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Item is referenced and cannot be deleted' });
  }
  await prisma.item.delete({ where: { id } });
  await logCrud({
    entityType: 'item',
    entityId: id,
    action: 'delete',
    payload: existingItem,
  });
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
    await logCrud({
      entityType: 'item',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update item', err);
    res.status(500).json({ error: err.message || 'Failed to update item' });
  }
});

app.get('/api/firms', async (req, res) => { res.json(await prisma.firm.findMany()); });
app.post('/api/firms', async (req, res) => {
  const { name } = req.body;
  const firm = await prisma.firm.create({ data: { name } });
  await logCrud({ entityType: 'firm', entityId: firm.id, action: 'create', payload: firm });
  res.json(firm);
});
app.delete('/api/firms/:id', async (req, res) => {
  const { id } = req.params;
  const existingFirm = await prisma.firm.findUnique({ where: { id } });
  if (!existingFirm) return res.status(404).json({ error: 'Firm not found' });
  const usage = await prisma.lot.count({ where: { firmId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Firm is referenced and cannot be deleted' });
  }
  await prisma.firm.delete({ where: { id } });
  await logCrud({ entityType: 'firm', entityId: id, action: 'delete', payload: existingFirm });
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
    await logCrud({
      entityType: 'firm',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update firm', err);
    res.status(500).json({ error: err.message || 'Failed to update firm' });
  }
});

app.get('/api/suppliers', async (req, res) => { res.json(await prisma.supplier.findMany()); });
app.post('/api/suppliers', async (req, res) => {
  const { name } = req.body;
  const seller = await prisma.supplier.create({ data: { name } });
  await logCrud({ entityType: 'supplier', entityId: seller.id, action: 'create', payload: seller });
  res.json(seller);
});
app.delete('/api/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  const existingSupplier = await prisma.supplier.findUnique({ where: { id } });
  if (!existingSupplier) return res.status(404).json({ error: 'Supplier not found' });
  const usage = await prisma.lot.count({ where: { supplierId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Supplier is referenced and cannot be deleted' });
  }
  await prisma.supplier.delete({ where: { id } });
  await logCrud({ entityType: 'supplier', entityId: id, action: 'delete', payload: existingSupplier });
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
    await logCrud({
      entityType: 'supplier',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update supplier', err);
    res.status(500).json({ error: err.message || 'Failed to update supplier' });
  }
});

app.get('/api/machines', async (req, res) => { res.json(await prisma.machine.findMany()); });
app.post('/api/machines', async (req, res) => {
  const { name } = req.body;
  const machine = await prisma.machine.create({ data: { name } });
  await logCrud({ entityType: 'machine', entityId: machine.id, action: 'create', payload: machine });
  res.json(machine);
});
app.delete('/api/machines/:id', async (req, res) => {
  const { id } = req.params;
  const existingMachine = await prisma.machine.findUnique({ where: { id } });
  if (!existingMachine) return res.status(404).json({ error: 'Machine not found' });
  const usage = await prisma.issueToMachine.count({ where: { machineId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Machine is referenced and cannot be deleted' });
  }
  await prisma.machine.delete({ where: { id } });
  await logCrud({ entityType: 'machine', entityId: id, action: 'delete', payload: existingMachine });
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
    await logCrud({
      entityType: 'machine',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update machine', err);
    res.status(500).json({ error: err.message || 'Failed to update machine' });
  }
});

app.get('/api/operators', async (req, res) => { res.json(await prisma.operator.findMany()); });
app.post('/api/operators', async (req, res) => {
  const { name, role } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const workerRole = normalizeWorkerRole(role);
  const worker = await prisma.operator.create({ data: { name, role: workerRole } });
  await logCrud({ entityType: 'operator', entityId: worker.id, action: 'create', payload: worker });
  res.json(worker);
});
app.delete('/api/operators/:id', async (req, res) => {
  const { id } = req.params;
  const existingOperator = await prisma.operator.findUnique({ where: { id } });
  if (!existingOperator) return res.status(404).json({ error: 'Operator not found' });
  const usage =
    (await prisma.issueToMachine.count({ where: { operatorId: id } })) +
    (await prisma.receiveRow.count({
      where: {
        OR: [
          { operatorId: id },
          { helperId: id },
        ],
      },
    }));
  if (usage > 0) {
    return res.status(400).json({ error: 'Operator is referenced and cannot be deleted' });
  }
  await prisma.operator.delete({ where: { id } });
  await logCrud({ entityType: 'operator', entityId: id, action: 'delete', payload: existingOperator });
  res.json({ ok: true });
});
// Update operator name
app.put('/api/operators/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, role } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.operator.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Operator not found' });
    const data = { name };
    if (role !== undefined) data.role = normalizeWorkerRole(role);
    const updated = await prisma.operator.update({ where: { id }, data });
    await logCrud({
      entityType: 'operator',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
        oldRole: existing.role,
        newRole: updated.role,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update operator', err);
    res.status(500).json({ error: err.message || 'Failed to update operator' });
  }
});

app.get('/api/bobbins', async (req, res) => { res.json(await prisma.bobbin.findMany()); });
app.post('/api/bobbins', async (req, res) => {
  const { name, weight } = req.body;
  const weightNum = weight !== undefined && weight !== null ? Number(weight) : null;
  const bobbin = await prisma.bobbin.create({
    data: {
      name,
      weight: weightNum !== null && Number.isFinite(weightNum) ? weightNum : null,
    },
  });
  await logCrud({ entityType: 'bobbin', entityId: bobbin.id, action: 'create', payload: bobbin });
  res.json(bobbin);
});
app.delete('/api/bobbins/:id', async (req, res) => {
  const { id } = req.params;
  const existingBobbin = await prisma.bobbin.findUnique({ where: { id } });
  if (!existingBobbin) return res.status(404).json({ error: 'Bobbin not found' });
  const usage = await prisma.receiveRow.count({ where: { bobbinId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Bobbin is referenced and cannot be deleted' });
  }
  await prisma.bobbin.delete({ where: { id } });
  await logCrud({ entityType: 'bobbin', entityId: id, action: 'delete', payload: existingBobbin });
  res.json({ ok: true });
});
// Update bobbin name and weight
app.put('/api/bobbins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, weight } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const existing = await prisma.bobbin.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Bobbin not found' });
    const weightNum = weight !== undefined && weight !== null ? Number(weight) : null;
    const updated = await prisma.bobbin.update({
      where: { id },
      data: {
        name,
        weight: weightNum !== null && Number.isFinite(weightNum) ? weightNum : null,
      },
    });
    await logCrud({
      entityType: 'bobbin',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
        oldWeight: existing.weight,
        newWeight: updated.weight,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update bobbin', err);
    res.status(500).json({ error: err.message || 'Failed to update bobbin' });
  }
});

app.get('/api/boxes', async (req, res) => { res.json(await prisma.box.findMany()); });
app.post('/api/boxes', async (req, res) => {
  const { name, weight } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });
  const weightNum = Number(weight);
  if (!Number.isFinite(weightNum) || weightNum <= 0) return res.status(400).json({ error: 'weight must be a positive number' });
  const box = await prisma.box.create({
    data: {
      name,
      weight: weightNum,
    },
  });
  await logCrud({ entityType: 'box', entityId: box.id, action: 'create', payload: box });
  res.json(box);
});
app.delete('/api/boxes/:id', async (req, res) => {
  const { id } = req.params;
  const existingBox = await prisma.box.findUnique({ where: { id } });
  if (!existingBox) return res.status(404).json({ error: 'Box not found' });
  const usage = await prisma.receiveRow.count({ where: { boxId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Box is referenced and cannot be deleted' });
  }
  await prisma.box.delete({ where: { id } });
  await logCrud({ entityType: 'box', entityId: id, action: 'delete', payload: existingBox });
  res.json({ ok: true });
});
app.put('/api/boxes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, weight } = req.body;
    if (!name) return res.status(400).json({ error: 'Missing name' });
    const weightNum = Number(weight);
    if (!Number.isFinite(weightNum) || weightNum <= 0) return res.status(400).json({ error: 'weight must be a positive number' });
    const existing = await prisma.box.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Box not found' });
    const updated = await prisma.box.update({
      where: { id },
      data: {
        name,
        weight: weightNum,
      },
    });
    await logCrud({
      entityType: 'box',
      entityId: id,
      action: 'update',
      before: existing,
      after: updated,
      payload: {
        oldName: existing.name,
        newName: updated.name,
        oldWeight: existing.weight,
        newWeight: updated.weight,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('Failed to update box', err);
    res.status(500).json({ error: err.message || 'Failed to update box' });
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
    const cleanPieceIds = pieceIds.map(p => String(p).trim()).filter(Boolean);
    if (cleanPieceIds.length > 0) {
      const receiveCount = await prisma.receiveRow.count({ where: { pieceId: { in: cleanPieceIds } } });
      if (receiveCount > 0) {
        return res.status(400).json({ error: 'Cannot delete issue: receive records exist for one or more pieces' });
      }
    }
    
    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Delete the issue_to_machine record
      await tx.issueToMachine.delete({ where: { id } });
      
      // Mark pieces as available again
      if (cleanPieceIds.length > 0) {
        await tx.inboundItem.updateMany({
          where: { id: { in: cleanPieceIds } },
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
      sendNotification('issue_to_machine_deleted', { itemName, lotNo: issueRecord.lotNo, date: issueRecord.date, count: issueRecord.count, totalWeight: issueRecord.totalWeight, pieceIds: cleanPieceIds, machineName: machineNameDel, machineNumber: machineNumberDel, operatorName: operatorNameDel });
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

    await logCrud({
      entityType: 'inbound_item',
      entityId: id,
      action: 'delete',
      payload: {
        lotNo: existing.lotNo,
        itemId: existing.itemId,
        weight: existing.weight,
      },
    });

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
    const previousSettings = await prisma.settings.findUnique({ where: { id: 1 } });
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
    await logCrud({
      entityType: 'settings',
      entityId: '1',
      action: 'update',
      before: previousSettings,
      after: settings,
      payload: settings,
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
      await logCrud({
        entityType: 'settings',
        entityId: '1',
        action: 'update',
        before: previousSettings,
        after: settings,
        payload: settings,
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

    let beforeInbound = null;
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.inboundItem.findUnique({ where: { id } });
      if (!existing) throw new Error('Inbound piece not found');
      beforeInbound = existing;

      const updated = await tx.inboundItem.update({ where: { id }, data: { ...(seq !== undefined ? { seq } : {}), ...(weight !== undefined ? { weight: Number(weight) } : {}) } });

      // Recalculate lot totals (totalPieces and totalWeight) based on current inbound items for the lot
      const lotNo = updated.lotNo;
      const agg = await tx.inboundItem.aggregate({ where: { lotNo }, _sum: { weight: true }, _count: { id: true } });
      const totalWeight = Number(agg._sum.weight || 0);
      const totalPieces = Number(agg._count.id || 0);
      await tx.lot.update({ where: { lotNo }, data: { totalWeight, totalPieces } });

      return updated;
    });

    const payload = {};
    if (seq !== undefined) payload.seq = seq;
    if (weight !== undefined) payload.weight = weight;
    await logCrud({
      entityType: 'inbound_item',
      entityId: id,
      action: 'update',
      before: beforeInbound,
      after: result,
      payload: Object.keys(payload).length ? payload : undefined,
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
      await logCrud({
        entityType: 'lot',
        entityId: lotRec ? lotRec.id : null,
        action: 'delete',
        payload: {
          lotNo,
          itemId: lotRec ? lotRec.itemId : null,
          totalPieces,
          totalWeight: lotRec ? lotRec.totalWeight : null,
        },
        client: tx,
      });
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
