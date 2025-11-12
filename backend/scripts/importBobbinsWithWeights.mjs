#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

// Bobbins from the image with their weights
const bobbinsData = [
  { name: 'BLUE FIRKI', weight: 0.014 },
  { name: 'REGULAR BOBIN', weight: 0.061 },
  { name: 'BIG BOBIN', weight: 0.089 },
  { name: 'MAHAVIR BOBIN', weight: 0.000 },
  { name: 'SUMILON BOBIN', weight: 0.055 },
  { name: 'MD BOBIN', weight: 0.037 },
  { name: 'JILL MILL BOBIN', weight: 0.062 },
  { name: 'MAHAVIR NEW BOBIN', weight: 0.057 },
  { name: 'MD BLACK BOBIN', weight: 0.053 },
  { name: 'MD BIG BOBIN', weight: 0.083 },
  { name: 'HILAM BOBIN', weight: 0.059 },
  { name: 'BLUE BOBIN', weight: 0.083 },
];

async function main() {
  try {
    console.log('Importing bobbins with weights...\n');

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const { name, weight } of bobbinsData) {
      // Find existing bobbin (case-insensitive)
      const existing = await prisma.bobbin.findFirst({
        where: {
          name: {
            equals: name,
            mode: 'insensitive',
          },
        },
      });

      if (existing) {
        // Update if weight is different or null
        if (existing.weight !== weight) {
          await prisma.bobbin.update({
            where: { id: existing.id },
            data: { weight },
          });
          console.log(`Updated: "${name}" - weight: ${weight} kg`);
          updated++;
        } else {
          console.log(`Skipped: "${name}" - already has weight ${weight} kg`);
          skipped++;
        }
      } else {
        // Create new bobbin
        await prisma.bobbin.create({
          data: { name, weight },
        });
        console.log(`Created: "${name}" - weight: ${weight} kg`);
        created++;
      }
    }

    console.log('\nSummary:');
    console.log(`  Created: ${created}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Total processed: ${bobbinsData.length}`);

    console.log('\nImport completed successfully!');

  } catch (err) {
    console.error('Import failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

