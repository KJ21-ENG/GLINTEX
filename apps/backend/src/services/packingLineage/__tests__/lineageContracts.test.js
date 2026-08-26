import assert from 'node:assert/strict';
import test from 'node:test';
import { addChild, computeStats, createTruncationMarker } from '../index.js';

test('bounded lineage appends an honest marker without treating it as a normal node', () => {
  const parent = { id: 'root', stage: 'inbound', children: [] };
  const marker = createTruncationMarker(7, 'node_limit');
  assert.doesNotThrow(() => addChild(marker, { id: 'ignored', children: [] }));
  addChild(parent, marker);
  assert.deepEqual(parent.children, [{ truncated: true, hiddenCount: 7, reason: 'node_limit' }]);
  assert.deepEqual(computeStats(parent), {
    totalNodes: 1,
    totalBranches: 0,
    maxDepth: 1,
    truncated: true,
    truncatedNodes: 7,
    stageBreakdown: { inbound: 1 },
  });
});
