// The owner's production label designs, refined for the version 2 designer: same fields,
// rows, columns, wording and title style as the designs exported from production on
// 2026-10-10, laid out on a clean grid in Inter. Writes the seed file read by
//   node apps/backend/scripts/seedStickerTemplates.mjs --file scripts/stickerTemplates.production.json
// Usage: node apps/frontend/scripts/refine-production-labels.mjs [--save]   (--save: local demo DB only)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTemplate } from '../src/utils/label/model.js';

const L75 = { widthMm: 75, heightMm: 125, orientation: 'landscape', rollWidthMm: 75, columns: 1, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 0, marginTopMm: 0, offsetXMm: 0, offsetYMm: 0, columnMode: 'repeat' };
const F = 'inter';
const base = (id, x, y, w, h, text, o = {}) => ({ id, name: o.name || id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()), type: 'text', x, y, w, h, text, fontFamily: F, fontSizePt: 11, bold: true, align: 'left', valign: 'middle', overflow: 'wrap-shrink', minFontSizePt: 6.5, lineHeight: 1.1, paddingMm: 0.4, ...o });
const titleBar = (text, { invert = true, pt = 15 } = {}) => base('title', 0, 0, 125, invert ? 8.5 : 8, text, { fontSizePt: pt, align: 'center', invert, uppercase: true, overflow: 'shrink', paddingMm: 1, letterSpacingPt: 0.4, minFontSizePt: 9 });
const rule = (id, y, x = 2, len = 121) => ({ id, name: 'Rule', type: 'line', x, y, lengthMm: len, thicknessMm: 0.3, direction: 'horizontal' });
const vrule = (id, x, y, len) => ({ id, name: 'Divider', type: 'line', x, y, lengthMm: len, thicknessMm: 0.3, direction: 'vertical' });
const barcode = (x, y, o = {}) => ({ id: 'barcode', name: 'Barcode', type: 'barcode', x, y, value: '@barcode', symbology: 'code128', moduleMm: 0.375, barHeightMm: 10, showText: true, textSizePt: 7.5, quietZoneMm: 2.5, maxWidthMm: 90, ...o });
const ROW = 7;
// Two-column grid: label and value columns on each side of a divider.
const COLS = { L: { lx: 2, lw: 17, vx: 19.5, vw: 42.5 }, R: { lx: 66, lw: 17, vx: 83.5, vw: 40 } };
const pair = (side, i, y0, label, value, o = {}) => {
  const c = COLS[side]; const y = y0 + i * ROW;
  const id = (o.id || label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase());
  return [
    base(`${id}-label`, c.lx, y, c.lw, 6.6, label, { bold: false, fontSizePt: 9.5, overflow: 'shrink', name: `${label} label` }),
    base(id, c.vx, y, c.vw, 6.6, value, { fontSizePt: o.pt || 11, name: label, ...(o.value || {}) }),
  ];
};
// Single column rows: wider label column.
const srow = (i, y0, label, value, o = {}) => {
  const y = y0 + i * (o.row || 7.5);
  const id = (o.id || label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase());
  return [
    base(`${id}-label`, 3, y, 27, 7, label, { bold: false, fontSizePt: 10.5, overflow: 'shrink', name: `${label} label` }),
    base(id, 31, y, 91, 7, value, { fontSizePt: o.pt || 12.5, name: label, ...(o.value || {}) }),
  ];
};
const big = { pt: 15 };

const T = {};

T.inbound = { version: 2, media: L75, copies: 1, elements: [
  titleBar('INBOUND', { pt: 20 }),
  ...srow(0, 12, 'Date :', '@date', { row: 8.5 }),
  ...srow(1, 12, 'Metallic :', '@itemName', { row: 8.5, pt: 13, value: { h: 8 } }),
  ...srow(2, 12, 'Roll No :', '@seq', { row: 8.5, pt: 13 }),
  ...srow(3, 12, 'Weight :', '@weight', { row: 8.5, pt: 17, value: { h: 8 } }),
  barcode(20, 52, { barHeightMm: 11 }),
]};

T.cutter_issue = { version: 2, media: L75, copies: 1, elements: [
  titleBar('ISSUE TO CUTTER MACHINE'),
  ...srow(0, 11.5, 'DATE', '@date', { row: 7.2 }),
  ...srow(1, 11.5, 'ITEM :', '@itemName - @seq', { row: 7.2, value: { h: 7.2 } }),
  ...srow(2, 11.5, 'CUT :', '@cut', { row: 7.2 }),
  base('lot-label', 3, 33.1, 46, 7, '@inboundDate WALA LOT', { bold: false, fontSizePt: 10.5, overflow: 'shrink', name: 'Lot date label' }),
  base('lot', 50, 33.1, 72, 7, '@lotNo', { fontSizePt: 12.5, name: 'Lot' }),
  ...srow(4, 11.5, 'MACHINE :', '@machineName', { row: 7.2 }),
  ...srow(5, 11.5, 'WEIGHT :', '@totalWeight', { row: 7.2, pt: 16, value: { h: 7.5 } }),
  barcode(17, 58, { maxWidthMm: 92 }),
]};

T.coning_issue = { version: 2, media: L75, copies: 1, elements: [
  titleBar('ISSUE TO CONING MACHINE', { invert: false, pt: 14 }), rule('rule-title', 8.6),
  vrule('divider', 63.8, 10.5, 45),
  ...pair('L', 0, 11, 'Date', '@date'),
  ...pair('L', 1, 11, 'Item', '@itemName (@cut)'),
  ...pair('L', 2, 11, 'Rolls', '@rollType (@rollCount)'),
  ...pair('L', 3, 11, 'Cone Type', '@coneType (@perConeTargetG G)'),
  ...pair('L', 4, 11, 'Net WT.', '@netWeight', { ...big, value: { h: 7 } }),
  ...pair('R', 0, 11, 'Worker', '@operatorName'),
  ...pair('R', 1, 11, 'Yarn', '@yarnName'),
  ...pair('R', 2, 11, 'Shift', '@shift'),
  ...pair('R', 3, 11, 'Theli', '@wrapperName'),
  ...pair('R', 4, 11, 'Exp Cone', '@expectedCones pcs'),
  rule('rule-bottom', 55.5),
  barcode(20, 58),
]};

T.coning_receive = { version: 2, media: L75, copies: 1, elements: [
  titleBar('RECEIVE FROM CONING MACHINE', { invert: false, pt: 14 }), rule('rule-title', 8.6),
  vrule('divider', 63.8, 10.5, 45),
  ...pair('L', 0, 11, 'Date', '@date'),
  ...pair('L', 1, 11, 'Item', '@itemName (@cut)'),
  ...pair('L', 2, 11, 'Theli', '@wrapperName'),
  ...pair('L', 3, 11, 'Cone', '@coneCount (@coneType)'),
  ...pair('L', 4, 11, 'Gross', '@grossWeight'),
  ...pair('L', 5, 11, 'Net', '@netWeight', { ...big, value: { h: 7 } }),
  ...pair('R', 0, 11, 'Operator', '@operatorName'),
  ...pair('R', 1, 11, 'Yarn', '@yarnName (@twist)'),
  ...pair('R', 2, 11, 'Machine', '@machineName'),
  rule('rule-bottom', 55.5),
  barcode(20, 58),
]};

T.holo_receive = { version: 2, media: L75, copies: 2, elements: [
  titleBar('RECEIVE FROM HOLO MACHINE'),
  vrule('divider', 63.8, 10.5, 45),
  ...pair('L', 0, 11.5, 'Date', '@date'),
  ...pair('L', 1, 11.5, 'Item', '@itemName'),
  ...pair('L', 2, 11.5, 'Rolls', '@rollType (@rollCount)'),
  ...pair('L', 3, 11.5, 'Gross', '@grossWeight'),
  ...pair('L', 4, 11.5, 'Tare', '@tareWeight'),
  ...pair('L', 5, 11.5, 'Net', '@netWeight', { ...big, value: { h: 7 } }),
  ...pair('R', 0, 11.5, 'Yarn', '@yarnName'),
  ...pair('R', 1, 11.5, 'Cut', '@cut'),
  ...pair('R', 2, 11.5, 'Operator', '@operatorName'),
  ...pair('R', 3, 11.5, 'Twist', '@twist'),
  ...pair('R', 4, 11.5, 'Machine', '@machineName'),
  rule('rule-bottom', 55.5),
  barcode(20, 58),
]};

T.holo_issue = { version: 2, media: L75, copies: 2, elements: [
  titleBar('ISSUE TO HOLO MACHINE'),
  vrule('divider', 63.8, 10.5, 45),
  ...pair('L', 0, 11.5, 'DATE', '@date'),
  ...pair('L', 1, 11.5, 'ITEM', '@itemName'),
  ...pair('L', 2, 11.5, 'CUT', '@cut'),
  ...pair('L', 3, 11.5, 'BOB', '@bobbinType'),
  ...pair('L', 4, 11.5, 'NET WT', '@netWeight', { ...big, value: { h: 7 } }),
  ...pair('R', 0, 11.5, 'SHIFT', '@shift'),
  ...pair('R', 1, 11.5, 'YARN', '@yarnName'),
  ...pair('R', 2, 11.5, 'TWIST', '@twistName'),
  ...pair('R', 3, 11.5, 'MACHINE', '@machineName'),
  ...pair('R', 4, 11.5, 'WORKER', '@operatorName'),
  ...pair('R', 5, 11.5, 'BOBIN QT', '@bobbinQty'),
  rule('rule-bottom', 55.5),
  barcode(20, 58),
]};

T.cutter_receive = { version: 2, media: L75, copies: 2, elements: [
  titleBar('RECEIVE FROM CUTTER MACHINE'),
  vrule('divider', 63.8, 10.5, 45),
  ...pair('L', 0, 11.5, 'Date', '@date'),
  ...pair('L', 1, 11.5, 'Item', '@itemName'),
  ...pair('L', 2, 11.5, 'Bob', '@bobbinName'),
  ...pair('L', 3, 11.5, 'Gross', '@grossWeight'),
  ...pair('L', 4, 11.5, 'Tare', '@tareWeight'),
  ...pair('L', 5, 11.5, 'Net', '@netWeight', { ...big, value: { h: 7 } }),
  ...pair('R', 0, 11.5, 'Machine', '@machineName'),
  ...pair('R', 1, 11.5, 'Shift', '@shift'),
  ...pair('R', 2, 11.5, 'Cut', '@cut'),
  ...pair('R', 3, 11.5, 'Bob QTY', '@bobbinQty'),
  ...pair('R', 4, 11.5, 'Operator', '@operatorName'),
  rule('rule-bottom', 55.5),
  barcode(20, 58),
]};

T.cutter_issue_small = { version: 2, media: { widthMm: 50, heightMm: 25, orientation: 'portrait', rollWidthMm: 105, columns: 2, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 0, marginTopMm: 0, offsetXMm: 1, offsetYMm: -1, columnMode: 'repeat' }, copies: 1, elements: [
  barcode(0.5, 6.5, { moduleMm: 0.25, barHeightMm: 10, textSizePt: 7, quietZoneMm: 1.5, maxWidthMm: 48.5 }),
]};

T.coning_receive_small = { version: 2, media: { widthMm: 15.8, heightMm: 15, orientation: 'portrait', rollWidthMm: 92.8, columns: 5, columnGapMm: 1.8, rowGapMm: 2.9, marginLeftMm: 1.9, marginTopMm: 0, offsetXMm: 1.3, offsetYMm: 1.7, columnMode: 'repeat' }, copies: 5, elements: [
  { id: 'qr', name: 'QR code', type: 'qr', x: 2.7, y: 0.2, value: '@barcode', sizeMm: 10.4, ecLevel: 'M' },
  base('code', 0, 10.8, 15.8, 2.4, '@barcodeNumber', { fontSizePt: 4, align: 'center', overflow: 'shrink', minFontSizePt: 3, paddingMm: 0, lineHeight: 1 }),
]};

const refined = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, normalizeTemplate(v)]));
const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, '../../backend/scripts/stickerTemplates.production.json');
const templates = Object.entries(refined).map(([stage, template]) => ({ stage, stageKey: `v2:${stage}`, dimensions: { version: 2, ...template.media }, content: template }));
fs.writeFileSync(target, `${JSON.stringify({ generatedBy: 'apps/frontend/scripts/refine-production-labels.mjs', source: 'production sticker templates exported 2026-10-10, same fields and formation', templates }, null, 1)}\n`);
console.log(`wrote ${templates.length} production designs -> ${path.relative(process.cwd(), target)}`);
if (process.argv.includes('--save')) {
  // Local testing only: upsert the designs into the demo database this process is pointed at.
  const prisma = (await import('../../backend/src/lib/prisma.js')).default;
  const [{ db }] = await prisma.$queryRaw`select current_database() as db`;
  if (!String(db).includes('label_demo')) throw new Error(`refusing to write designs into ${db}; --save is for a *label_demo* database`);
  for (const t of templates) {
    await prisma.stickerTemplate.upsert({ where: { stageKey: t.stageKey }, update: { dimensions: t.dimensions, content: t.content }, create: { id: `template-${t.stageKey}-seed`, stageKey: t.stageKey, dimensions: t.dimensions, content: t.content } });
  }
  console.log('saved as v2 rows in', db);
  await prisma.$disconnect();
}
