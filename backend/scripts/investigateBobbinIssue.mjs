#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

async function main() {
  try {
    console.log('Investigating bobbin assignment issue...\n');

    // Find the "Bobbin" bobbin record
    const defaultBobbin = await prisma.bobbin.findFirst({
      where: {
        name: {
          equals: 'Bobbin',
          mode: 'insensitive',
        },
      },
    });

    if (!defaultBobbin) {
      console.log('No "Bobbin" record found in database.');
      return;
    }

    console.log(`Found "Bobbin" record: ID=${defaultBobbin.id}\n`);

    // Find all receive rows linked to "Bobbin"
    const rowsWithDefaultBobbin = await prisma.receiveRow.findMany({
      where: {
        bobbinId: defaultBobbin.id,
      },
      select: {
        id: true,
        vchNo: true,
        pieceId: true,
        pcsTypeName: true,
        bobbinId: true,
        createdAt: true,
      },
      take: 50, // Sample first 50
    });

    console.log(`Found ${rowsWithDefaultBobbin.length} receive rows linked to "Bobbin" (showing first 50):\n`);

    // Analyze the pcsTypeName values
    const analysis = {
      null: 0,
      empty: 0,
      whitespace: 0,
      hasValue: 0,
      samples: [],
    };

    rowsWithDefaultBobbin.forEach((row, idx) => {
      const pcsTypeName = row.pcsTypeName;
      
      if (pcsTypeName === null || pcsTypeName === undefined) {
        analysis.null++;
        if (analysis.samples.length < 10) {
          analysis.samples.push({ vchNo: row.vchNo, pieceId: row.pieceId, pcsTypeName: null, reason: 'null' });
        }
      } else if (pcsTypeName.trim() === '') {
        analysis.empty++;
        if (analysis.samples.length < 10) {
          analysis.samples.push({ vchNo: row.vchNo, pieceId: row.pieceId, pcsTypeName: `"${pcsTypeName}"`, reason: 'empty string' });
        }
      } else if (pcsTypeName.trim() === '') {
        analysis.whitespace++;
        if (analysis.samples.length < 10) {
          analysis.samples.push({ vchNo: row.vchNo, pieceId: row.pieceId, pcsTypeName: `"${pcsTypeName}"`, reason: 'whitespace only' });
        }
      } else {
        analysis.hasValue++;
        if (analysis.samples.length < 10) {
          analysis.samples.push({ vchNo: row.vchNo, pieceId: row.pieceId, pcsTypeName: pcsTypeName, reason: 'has value but still linked to Bobbin' });
        }
      }
    });

    console.log('Analysis of rows linked to "Bobbin":');
    console.log(`  Null pcsTypeName: ${analysis.null}`);
    console.log(`  Empty string pcsTypeName: ${analysis.empty}`);
    console.log(`  Whitespace-only pcsTypeName: ${analysis.whitespace}`);
    console.log(`  Has pcsTypeName value: ${analysis.hasValue}`);
    console.log('\nSample rows:');
    console.table(analysis.samples);

    // Check total count
    const totalCount = await prisma.receiveRow.count({
      where: {
        bobbinId: defaultBobbin.id,
      },
    });

    console.log(`\nTotal receive rows linked to "Bobbin": ${totalCount}`);

    // Check if there are any other bobbins
    const allBobbins = await prisma.bobbin.findMany({
      select: {
        id: true,
        name: true,
        weight: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    console.log('\nAll bobbins in database:');
    console.table(allBobbins);

    // Check receive row counts per bobbin
    console.log('\nReceive row counts per bobbin:');
    const bobbinCounts = await Promise.all(
      allBobbins.map(async (bobbin) => {
        const count = await prisma.receiveRow.count({
          where: { bobbinId: bobbin.id },
        });
        return { name: bobbin.name, count };
      })
    );
    console.table(bobbinCounts);

  } catch (err) {
    console.error('Investigation failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

