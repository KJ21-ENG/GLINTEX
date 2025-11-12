#!/usr/bin/env node
import prisma from '../src/prismaClient.js';

async function main() {
  try {
    console.log('Investigating CSV PcsTypeName values...\n');

    // Get all receive uploads with their rows
    const uploads = await prisma.receiveUpload.findMany({
      orderBy: { uploadedAt: 'desc' },
      include: {
        rows: {
          select: {
            id: true,
            vchNo: true,
            pieceId: true,
            pcsTypeName: true,
            bobbinId: true,
            createdAt: true,
          },
        },
      },
    });

    console.log(`Found ${uploads.length} uploads\n`);

    // Analyze each upload
    const uploadAnalysis = [];

    for (const upload of uploads) {
      const rows = upload.rows || [];
      const totalRows = rows.length;
      
      if (totalRows === 0) continue;

      const nullPcsTypeName = rows.filter(r => r.pcsTypeName === null || r.pcsTypeName === undefined).length;
      const emptyPcsTypeName = rows.filter(r => r.pcsTypeName !== null && r.pcsTypeName !== undefined && r.pcsTypeName.trim() === '').length;
      const hasPcsTypeName = rows.filter(r => r.pcsTypeName !== null && r.pcsTypeName !== undefined && r.pcsTypeName.trim() !== '').length;

      // Get unique PcsTypeName values from this upload
      const uniquePcsTypeNames = [...new Set(
        rows
          .map(r => r.pcsTypeName)
          .filter(p => p !== null && p !== undefined && p.trim() !== '')
      )];

      // Count bobbin assignments
      const bobbinCounts = {};
      rows.forEach(row => {
        if (row.bobbinId) {
          // We'll need to fetch bobbin names separately
        }
      });

      uploadAnalysis.push({
        uploadId: upload.id,
        filename: upload.originalFilename,
        uploadedAt: upload.uploadedAt,
        totalRows,
        nullPcsTypeName,
        emptyPcsTypeName,
        hasPcsTypeName,
        uniquePcsTypeNames: uniquePcsTypeNames.length,
        pcsTypeNameValues: uniquePcsTypeNames.slice(0, 5), // First 5 unique values
        nullPercentage: ((nullPcsTypeName / totalRows) * 100).toFixed(1) + '%',
      });
    }

    console.log('Upload Analysis:\n');
    console.table(uploadAnalysis.map(u => ({
      filename: u.filename,
      uploadedAt: u.uploadedAt.toISOString().split('T')[0],
      totalRows: u.totalRows,
      nullPcsTypeName: u.nullPcsTypeName,
      hasPcsTypeName: u.hasPcsTypeName,
      nullPercentage: u.nullPercentage,
      uniqueValues: u.uniquePcsTypeNames,
      sampleValues: u.pcsTypeNameValues.join(', ') || 'N/A',
    })));

    // Overall statistics
    const allRows = await prisma.receiveRow.findMany({
      select: {
        pcsTypeName: true,
        bobbinId: true,
        uploadId: true,
        createdAt: true,
      },
    });

    const totalRows = allRows.length;
    const nullPcsTypeName = allRows.filter(r => r.pcsTypeName === null || r.pcsTypeName === undefined).length;
    const emptyPcsTypeName = allRows.filter(r => r.pcsTypeName !== null && r.pcsTypeName !== undefined && r.pcsTypeName.trim() === '').length;
    const hasPcsTypeName = allRows.filter(r => r.pcsTypeName !== null && r.pcsTypeName !== undefined && r.pcsTypeName.trim() !== '').length;

    console.log('\n=== Overall Statistics ===');
    console.log(`Total receive rows: ${totalRows}`);
    console.log(`Rows with null PcsTypeName: ${nullPcsTypeName} (${((nullPcsTypeName / totalRows) * 100).toFixed(1)}%)`);
    console.log(`Rows with empty PcsTypeName: ${emptyPcsTypeName} (${((emptyPcsTypeName / totalRows) * 100).toFixed(1)}%)`);
    console.log(`Rows with PcsTypeName value: ${hasPcsTypeName} (${((hasPcsTypeName / totalRows) * 100).toFixed(1)}%)`);

    // Get all unique PcsTypeName values
    const allUniquePcsTypeNames = [...new Set(
      allRows
        .map(r => r.pcsTypeName)
        .filter(p => p !== null && p !== undefined && p.trim() !== '')
    )].sort();

    console.log(`\nUnique PcsTypeName values found: ${allUniquePcsTypeNames.length}`);
    console.log('Values:', allUniquePcsTypeNames.join(', ') || 'None');

    // Check bobbin assignments
    const bobbinAssignments = {};
    for (const row of allRows) {
      if (row.bobbinId) {
        bobbinAssignments[row.bobbinId] = (bobbinAssignments[row.bobbinId] || 0) + 1;
      }
    }

    // Get bobbin names
    const bobbinIds = Object.keys(bobbinAssignments);
    const bobbins = await prisma.bobbin.findMany({
      where: { id: { in: bobbinIds } },
      select: { id: true, name: true },
    });

    const bobbinNameMap = new Map(bobbins.map(b => [b.id, b.name]));

    console.log('\n=== Bobbin Assignments ===');
    const bobbinStats = Object.entries(bobbinAssignments)
      .map(([id, count]) => ({
        bobbinName: bobbinNameMap.get(id) || 'Unknown',
        count,
        percentage: ((count / totalRows) * 100).toFixed(1) + '%',
      }))
      .sort((a, b) => b.count - a.count);

    console.table(bobbinStats);

    // Check if null PcsTypeName rows are from older uploads
    const nullRowsByDate = allRows
      .filter(r => r.pcsTypeName === null || r.pcsTypeName === undefined)
      .map(r => ({
        date: r.createdAt.toISOString().split('T')[0],
        uploadId: r.uploadId,
      }));

    const dateGroups = {};
    nullRowsByDate.forEach(r => {
      dateGroups[r.date] = (dateGroups[r.date] || 0) + 1;
    });

    console.log('\n=== Null PcsTypeName by Upload Date ===');
    const dateStats = Object.entries(dateGroups)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10); // Last 10 dates

    console.table(dateStats);

    // Sample rows with null PcsTypeName
    console.log('\n=== Sample Rows with Null PcsTypeName ===');
    const sampleNullRows = await prisma.receiveRow.findMany({
      where: {
        pcsTypeName: null,
      },
      select: {
        vchNo: true,
        pieceId: true,
        pcsTypeName: true,
        createdAt: true,
        upload: {
          select: {
            originalFilename: true,
            uploadedAt: true,
          },
        },
      },
      take: 10,
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.table(sampleNullRows.map(r => ({
      vchNo: r.vchNo,
      pieceId: r.pieceId,
      pcsTypeName: r.pcsTypeName,
      filename: r.upload?.originalFilename || 'N/A',
      uploadedAt: r.createdAt.toISOString().split('T')[0],
    })));

  } catch (err) {
    console.error('Investigation failed', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();

