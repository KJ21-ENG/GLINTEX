#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

function parseDateToISO(s) {
  if (!s || typeof s !== 'string') return '';
  const str = s.trim();
  // DD or D - MM or M - YYYY
  let m = str.match(/^(\d{1,2})[-\/]?(\d{1,2})[-\/]?(\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  // ISO-like
  m = str.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0,10);
  return '';
}

async function main() {
  try {
    console.log('Scanning issueToMachine for non-ISO dates...');
    const all = await prisma.issueToMachine.findMany({ select: { id: true, date: true } });
    const isoRe = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
    let fixes = 0;
    for (const r of all) {
      if (r.date && !isoRe.test(r.date)) {
        const iso = parseDateToISO(r.date);
        console.log(`Record ${r.id}: '${r.date}' => parsed '${iso}'`);
        if (iso) {
          await prisma.issueToMachine.update({ where: { id: r.id }, data: { date: iso } });
          console.log(`Updated ${r.id} -> ${iso}`);
          fixes++;
        } else {
          console.log(`Could not parse ${r.id} (${r.date})`);
        }
      }
    }
    console.log(`Done. Fixed ${fixes} records.`);
  } catch (err) {
    console.error('Error', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();


