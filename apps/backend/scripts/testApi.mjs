#!/usr/bin/env node

async function testApi() {
  try {
    const response = await fetch('http://localhost:4000/api/db');
    const data = await response.json();
    
    const totals = data.receive_from_cutter_machine_piece_totals || [];
    const withPcs = totals.filter(t => (t.totalBob || 0) > 0);
    
    console.log('Sample receive_from_cutter_machine_piece_totals with totalBob > 0:');
    withPcs.slice(0, 10).forEach(t => {
      console.log(`  ${t.pieceId}: totalBob=${t.totalBob}, totalNetWeight=${t.totalNetWeight}`);
    });
    
    console.log(`\nTotal records: ${totals.length}`);
    console.log(`Records with totalBob > 0: ${withPcs.length}`);
    
    // Check specific pieces
    console.log('\nChecking specific pieces:');
    ['013-4', '018-4', '020-4', '017-2'].forEach(pieceId => {
      const t = totals.find(x => x.pieceId === pieceId);
      if (t) {
        console.log(`  ${pieceId}: totalBob=${t.totalBob || 0}`);
      } else {
        console.log(`  ${pieceId}: Not found`);
      }
    });
    
  } catch (err) {
    console.error('Test failed', err);
    process.exit(1);
  }
}

testApi();

