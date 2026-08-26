import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDispatchDocumentHtml } from '../dispatchDocumentPreview.js';

test('multi-challan document rendering keeps each authoritative challan on its own page', () => {
  const html = buildDispatchDocumentHtml([
    { challanNo: 'DC-001', customer: { name: 'Customer A' }, lines: [{ sourceBarcode: 'SRC-1', itemName: 'Item A', packageKind: 'PACKET', baseCount: 1, netWeightKg: 1 }] },
    { challanNo: 'DC-002', customer: { name: 'Customer B' }, lines: [{ sourceBarcode: 'SRC-2', itemName: 'Item B', packageKind: 'PACKET', baseCount: 2, netWeightKg: 2 }] },
  ]);

  assert.ok(html.indexOf('DC-001') < html.indexOf('DC-002'));
  assert.equal((html.match(/class="dispatch-document-page"/g) || []).length, 2);
  assert.match(html, /break-after: page/);
});
