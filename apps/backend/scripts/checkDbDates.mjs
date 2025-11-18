#!/usr/bin/env node
import prisma from '../src/lib/prisma.js';

async function main() {
  try {
    console.log('Verifying date normalization...');

    const totalIssues = await prisma.issueToCutterMachine.count();
    const issuesSample = await prisma.issueToCutterMachine.findMany({ select: { id: true, date: true }, take: 1000 });
    const isoRe = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
    const nonIsoIssues = issuesSample.filter(r => r.date && !isoRe.test(r.date));

    const totalReceive = await prisma.receiveFromCutterMachineRow.count();
    const receiveSample = await prisma.receiveFromCutterMachineRow.findMany({ select: { id: true, date: true }, take: 1000 });
    const nonIsoReceive = receiveSample.filter(r => r.date && !isoRe.test(r.date));

    const totalLots = await prisma.lot.count();
    const lotsSample = await prisma.lot.findMany({ select: { lotNo: true, date: true }, take: 1000 });
    const nonIsoLots = lotsSample.filter(r => r.date && !isoRe.test(r.date));

    console.log(`issue_to_cutter_machine: total=${totalIssues}, non-ISO samples=${nonIsoIssues.length}`);
    if (nonIsoIssues.length) console.table(nonIsoIssues.slice(0, 10));

    console.log(`receive_from_cutter_machine_rows: total=${totalReceive}, non-ISO samples=${nonIsoReceive.length}`);
    if (nonIsoReceive.length) console.table(nonIsoReceive.slice(0, 10));

    console.log(`lots: total=${totalLots}, non-ISO samples=${nonIsoLots.length}`);
    if (nonIsoLots.length) console.table(nonIsoLots.slice(0, 10));

  } catch (err) {
    console.error('Verification failed', err);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

