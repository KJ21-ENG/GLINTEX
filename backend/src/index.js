import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import prisma from './prismaClient.js';

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
  const lots = await prisma.lot.findMany();
  const inbound_items = await prisma.inboundItem.findMany();
  const consumptions = await prisma.consumption.findMany();
  const settings = await prisma.settings.findMany();
  res.json({ items, firms, suppliers, lots, inbound_items, consumptions, settings });
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
    const { date, itemId, lotNo, pieceIds, note } = req.body;
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

app.put('/api/settings', async (req, res) => {
  try {
    const { brandPrimary, brandGold, logoDataUrl } = req.body;
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
    res.json(settings);
  } catch (err) {
    console.error('Failed to update settings', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.listen(PORT, () => {
  console.log(`GLINTEX backend listening on http://localhost:${PORT}`);
});

