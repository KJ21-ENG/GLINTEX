import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import prisma from './prismaClient.js';
import whatsapp from '../whatsapp/service.js';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 4000;

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
  const consumptions = await prisma.consumption.findMany();
  const settings = await prisma.settings.findMany();
  res.json({ items, firms, suppliers, machines, operators, lots, inbound_items, consumptions, settings });
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
  } catch (err) {
    console.error('Failed to create lot', err);
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'Lot already exists' });
    } else {
      res.status(500).json({ error: err.message || 'Failed to create lot' });
    }
  }
});

app.post('/api/consumptions', async (req, res) => {
  try {
    const { date, itemId, lotNo, pieceIds, note, machineId, operatorId } = req.body;
    if (!date || !itemId || !lotNo) {
      return res.status(400).json({ error: 'Missing required consumption fields' });
    }
    if (!Array.isArray(pieceIds) || pieceIds.length === 0) {
      return res.status(400).json({ error: 'pieceIds must be a non-empty array' });
    }

    const consumption = await prisma.$transaction(async (tx) => {
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

      return tx.consumption.create({
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

    res.json({ ok: true, consumption });
  } catch (err) {
    console.error('Failed to record consumption', err);
    res.status(400).json({ error: err.message || 'Failed to record consumption' });
  }
});

// Simple import endpoint: replaces data for simplicity
app.post('/api/import', async (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: 'Missing body' });

    // Clear existing tables (simple approach for import)
    await prisma.consumption.deleteMany();
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
    if (Array.isArray(data.consumptions)) {
      for (const c of data.consumptions) {
        await prisma.consumption.create({ data: { id: c.id, date: c.date, itemId: c.itemId, lotNo: c.lotNo, count: c.count || 0, totalWeight: Number(c.totalWeight || 0), pieceIds: Array.isArray(c.pieceIds) ? c.pieceIds.join(',') : (c.pieceIds || ''), reason: c.reason || 'internal', note: c.note || null } });
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
  const usage = await prisma.lot.count({ where: { itemId: id } }) + await prisma.inboundItem.count({ where: { itemId: id } }) + await prisma.consumption.count({ where: { itemId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Item is referenced and cannot be deleted' });
  }
  await prisma.item.delete({ where: { id } });
  res.json({ ok: true });
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

app.get('/api/machines', async (req, res) => { res.json(await prisma.machine.findMany()); });
app.post('/api/machines', async (req, res) => { const { name } = req.body; const machine = await prisma.machine.create({ data: { name } }); res.json(machine); });
app.delete('/api/machines/:id', async (req, res) => {
  const { id } = req.params;
  const usage = await prisma.consumption.count({ where: { machineId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Machine is referenced and cannot be deleted' });
  }
  await prisma.machine.delete({ where: { id } });
  res.json({ ok: true });
});

app.get('/api/operators', async (req, res) => { res.json(await prisma.operator.findMany()); });
app.post('/api/operators', async (req, res) => { const { name } = req.body; const operator = await prisma.operator.create({ data: { name } }); res.json(operator); });
app.delete('/api/operators/:id', async (req, res) => {
  const { id } = req.params;
  const usage = await prisma.consumption.count({ where: { operatorId: id } });
  if (usage > 0) {
    return res.status(400).json({ error: 'Operator is referenced and cannot be deleted' });
  }
  await prisma.operator.delete({ where: { id } });
  res.json({ ok: true });
});

app.delete('/api/consumptions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find the consumption record
    const consumption = await prisma.consumption.findUnique({ where: { id } });
    if (!consumption) {
      return res.status(404).json({ error: 'Consumption record not found' });
    }

    // Get the piece IDs from the consumption record
    const pieceIds = consumption.pieceIds ? consumption.pieceIds.split(',') : [];
    
    // Use transaction to ensure atomicity
    await prisma.$transaction(async (tx) => {
      // Delete the consumption record
      await tx.consumption.delete({ where: { id } });
      
      // Mark pieces as available again
      if (pieceIds.length > 0) {
        await tx.inboundItem.updateMany({
          where: { id: { in: pieceIds } },
          data: { status: 'available' },
        });
      }
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete consumption', err);
    res.status(500).json({ error: err.message || 'Failed to delete consumption' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const { brandPrimary, brandGold, logoDataUrl, whatsappNumber } = req.body;
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
    // Try to upsert including whatsappNumber if DB supports it, otherwise fallback without it
    try {
      const settings = await prisma.settings.upsert({
        where: { id: 1 },
        update: {
          brandPrimary: brandPrimary || '#2E4CA6',
          brandGold: brandGold || '#D4AF37',
          logoDataUrl: logoDataUrl || null,
          whatsappNumber: normalizedWhatsAppNumber || null,
        },
        create: {
          id: 1,
          brandPrimary: brandPrimary || '#2E4CA6',
          brandGold: brandGold || '#D4AF37',
          logoDataUrl: logoDataUrl || null,
          whatsappNumber: normalizedWhatsAppNumber || null,
        },
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

// Delete a lot and its inbound items and consumptions
app.delete('/api/lots/:lotNo', async (req, res) => {
  try {
    const { lotNo } = req.params;
    // Do not allow delete if any consumption exists for this lot
    const consCount = await prisma.consumption.count({ where: { lotNo } });
    if (consCount > 0) {
      return res.status(400).json({ error: 'Cannot delete lot: one or more pieces have been issued' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.inboundItem.deleteMany({ where: { lotNo } });
      await tx.lot.deleteMany({ where: { lotNo } });
    });

    res.json({ ok: true });
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

