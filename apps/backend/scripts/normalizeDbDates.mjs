#!/usr/bin/env node
import prisma from '../src/lib/prisma.js';

function parseDateToISO(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const s = dateStr.trim();
  const isoMatch = s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mm = isoMatch[2];
    const dd = isoMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const dmyMatch = s.match(/^(\d{2})[-\/]?(\d{2})[-\/]?(\d{4})$/);
  if (dmyMatch) {
    const dd = dmyMatch[1];
    const mm = dmyMatch[2];
    const yyyy = dmyMatch[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0,10);
  }
  return '';
}

async function normalizeLots() {
  const lots = await prisma.lot.findMany();
  let updated = 0;
  for (const lot of lots) {
    const iso = parseDateToISO(lot.date || '');
    if (iso && iso !== lot.date) {
      await prisma.lot.update({ where: { lotNo: lot.lotNo }, data: { date: iso } });
      updated++;
      console.log(`Updated lot ${lot.lotNo}: ${lot.date} -> ${iso}`);
    }
  }
  return updated;
}

async function normalizeIssues() {
  const rows = await prisma.issueToCutterMachine.findMany();
  let updated = 0;
  for (const r of rows) {
    const iso = parseDateToISO(r.date || '');
    if (iso && iso !== r.date) {
      await prisma.issueToCutterMachine.update({ where: { id: r.id }, data: { date: iso } });
      updated++;
      console.log(`Updated issue ${r.id}: ${r.date} -> ${iso}`);
    }
  }
  return updated;
}

async function normalizeReceiveRows() {
  const rows = await prisma.receiveFromCutterMachineRow.findMany();
  let updated = 0;
  for (const r of rows) {
    const iso = parseDateToISO(r.date || '');
    if (iso && iso !== r.date) {
      await prisma.receiveFromCutterMachineRow.update({ where: { id: r.id }, data: { date: iso } });
      updated++;
      console.log(`Updated receive row ${r.id}: ${r.date} -> ${iso}`);
    }
  }
  return updated;
}

async function main() {
  try {
    console.log('Starting DB date normalization...');
    const lotsUpdated = await normalizeLots();
    const issuesUpdated = await normalizeIssues();
    const receiveUpdated = await normalizeReceiveRows();
    console.log(`Done. lots: ${lotsUpdated}, issues: ${issuesUpdated}, receive_rows: ${receiveUpdated}`);
  } catch (err) {
    console.error('Normalization failed', err);
  } finally {
    await prisma.$disconnect();
  }
}

// Call main when executed directly
main();

