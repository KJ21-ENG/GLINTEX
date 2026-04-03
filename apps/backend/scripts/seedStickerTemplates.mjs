import prisma from '../src/lib/prisma.js';

// ---------------------------------------------------------------------------
// Redesigned sticker templates — mirrors DEFAULT_STAGE_TEMPLATES in labelPrint.js.
// Single full-width column layout (no two-zone split that causes overflow).
// Combined label+value fields, title bars with black bg, consistent spacing.
// ---------------------------------------------------------------------------

const textBase = (id, x, y, value, size = 19, extra = {}) => ({
  id, type: 'text', angle: 270, pos: { x, y },
  style: {
    bold: true, size, italic: false, opacity: 1, visible: true, underline: false,
    background: { color: '#000000', enabled: false, paddingMm: 0.8, textColor: '#ffffff' },
    wrapAtCenter: false, ...extra,
  },
  value,
});

const titleBar = (id, value, { size = 21, y = 123, paddingMm = 0.9 } = {}) => ({
  id, type: 'text', angle: 270, pos: { x: 0, y },
  style: {
    bold: true, size, italic: false, opacity: 1, visible: true, underline: false,
    background: { color: '#000000', enabled: true, paddingMm, textColor: '#ffffff' },
    wrapAtCenter: false,
  },
  value,
});

const bc = (id, x, y, { heightMm = 10, moduleMm = 0.45 } = {}) => ({
  id, type: 'barcode', angle: 270, pos: { x, y },
  style: { bold: false, italic: false, heightMm, moduleMm, underline: false, humanReadable: true },
  value: '{{barcode}}',
});

const vLine = (id, x = 6, lengthMm = 125) => ({
  id, type: 'line', angle: 90, pos: { x, y: 0 },
  style: { visible: true, lengthMm, thicknessMm: 0.1 }, value: '',
});

const hLine = (id, x, y, lengthMm = 125) => ({
  id, type: 'line', angle: 0, pos: { x, y },
  style: { visible: true, lengthMm, thicknessMm: 0.5 }, value: '',
});

const dims = (offsetX = 3) => ({
  width: 75, height: 125, columns: 1, offsetX, offsetY: 0,
  fontSize: 10, marginTop: 0, pageWidth: 75, marginLeft: 0,
  orientation: 'landscape', verticalGap: 2, horizontalGap: 2,
});

const templates = [
  {
    stageKey: 'inbound',
    dimensions: { ...dims(0) },
    content: { copies: 1, texts: [
      titleBar('t-inb-title', 'INBOUND', { size: 28, y: 123, paddingMm: 1.0 }),
      vLine('l-inb-vline', 7, 125),
      textBase('t-inb-date', 14, 122, 'DATE : @date', 18),
      textBase('t-inb-item', 22, 122, 'METALLIC : @itemName', 18, { wrapAtCenter: true }),
      textBase('t-inb-roll', 30, 122, 'ROLL NO : @seq', 18),
      textBase('t-inb-wt', 38, 122, 'WEIGHT : @weight KG', 18),
      hLine('l-inb-hline', 45, 0, 75),
      bc('bc-inb', 53, 100, { heightMm: 12, moduleMm: 0.35 }),
    ]},
  },
  {
    stageKey: 'cutter_issue',
    dimensions: { ...dims(3) },
    content: { copies: 1, texts: [
      titleBar('t-ci-title', 'ISSUE TO CUTTER MACHINE', { size: 19, y: 123, paddingMm: 0.8 }),
      vLine('l-ci-vline', 6, 125),
      textBase('t-ci-date', 10, 122, 'DATE : @date', 19),
      textBase('t-ci-item', 17, 122, 'ITEM : @itemName - @seq', 19, { wrapAtCenter: true }),
      textBase('t-ci-cut', 24, 122, 'CUT : @cut', 19),
      textBase('t-ci-lot', 31, 122, 'LOT : @inboundDate', 19),
      hLine('l-ci-hline', 37, 0, 125),
      textBase('t-ci-machine', 41, 122, 'MACHINE : @machineName', 19),
      textBase('t-ci-weight', 48, 122, 'WEIGHT : @totalWeight KG', 19),
      bc('bc-ci', 58, 100, { heightMm: 10, moduleMm: 0.45 }),
    ]},
  },
  {
    stageKey: 'cutter_issue_small',
    dimensions: {
      width: 50, height: 25, columns: 2, offsetX: 1, offsetY: -1,
      fontSize: 10, marginTop: 0, pageWidth: 105, marginLeft: 0,
      orientation: 'portrait', verticalGap: 2, horizontalGap: 2,
    },
    content: { copies: 1, texts: [
      { id: 't-cis-item', type: 'text', angle: 0, pos: { x: 3, y: 3 },
        style: { bold: true, size: 10, italic: false, opacity: 1, visible: true, underline: false,
          background: { color: '#000000', enabled: false, paddingMm: 0.8, textColor: '#ffffff' },
          wrapAtCenter: true }, value: '@itemName' },
      { id: 't-cis-operator', type: 'text', angle: 0, pos: { x: 3, y: 8 },
        style: { bold: false, size: 10, italic: false, opacity: 1, visible: true, underline: false,
          background: { color: '#000000', enabled: false, paddingMm: 0.8, textColor: '#ffffff' },
          wrapAtCenter: false }, value: '@operatorName' },
      { id: 't-cis-empty', type: 'text', angle: 0, pos: { x: 3, y: 15 },
        style: { bold: false, size: 10, italic: false, opacity: 1, visible: true, underline: false,
          background: { color: '#000000', enabled: false, paddingMm: 0.8, textColor: '#ffffff' },
          wrapAtCenter: false }, value: '' },
      { id: 'bc-cis', type: 'barcode', angle: 0, pos: { x: 5, y: 14 },
        style: { bold: false, italic: false, heightMm: 7, moduleMm: 0.25, underline: false, humanReadable: true },
        value: '{{barcode}}' },
      { id: 't-cis-cut', type: 'text', angle: 0, pos: { x: 29, y: 3 },
        style: { bold: true, size: 10, italic: false, opacity: 1, visible: true, underline: false,
          background: { color: '#000000', enabled: false, paddingMm: 0.8, textColor: '#ffffff' },
          wrapAtCenter: false }, value: '(@cut)' },
    ]},
  },
  {
    stageKey: 'cutter_receive',
    dimensions: { ...dims(3) },
    content: { copies: 2, texts: [
      titleBar('t-cr-title', 'RECEIVE FROM CUTTER', { size: 21, y: 123, paddingMm: 0.8 }),
      vLine('l-cr-vline', 7, 125),
      textBase('t-cr-date', 10, 122, 'DATE : @date', 17),
      textBase('t-cr-item', 16, 122, 'ITEM : @itemName', 17, { wrapAtCenter: true }),
      textBase('t-cr-cut', 22, 122, 'CUT : @cut', 17),
      textBase('t-cr-machine', 28, 122, 'MACHINE : @machineName', 17),
      textBase('t-cr-bob', 34, 122, 'BOB : @bobbinName  QTY : @bobbinQty', 17),
      hLine('l-cr-hline', 39, 0, 125),
      textBase('t-cr-gross', 42, 122, 'GROSS : @grossWeight', 17),
      textBase('t-cr-tare', 48, 122, 'TARE : @tareWeight', 17),
      textBase('t-cr-net', 54, 122, 'NET : @netWeight KG', 17),
      textBase('t-cr-operator', 42, 58, 'OPR : @operatorName', 14, { wrapAtCenter: true }),
      bc('bc-cr', 61, 100, { heightMm: 8, moduleMm: 0.42 }),
    ]},
  },
  {
    stageKey: 'holo_issue',
    dimensions: { ...dims(3) },
    content: { copies: 2, texts: [
      titleBar('t-hi-title', 'ISSUE TO HOLO MACHINE', { size: 19, y: 123, paddingMm: 0.8 }),
      vLine('l-hi-vline', 7, 125),
      textBase('t-hi-date', 10, 122, 'DATE : @date', 16),
      textBase('t-hi-shift', 10, 55, 'SHIFT : @shift', 14),
      textBase('t-hi-item', 16, 122, 'ITEM : @itemName', 16, { wrapAtCenter: true }),
      textBase('t-hi-cut', 22, 122, 'CUT : @cut', 16),
      textBase('t-hi-yarn', 28, 122, 'YARN : @yarnName', 16, { wrapAtCenter: true }),
      textBase('t-hi-machine', 34, 122, 'M/C : @machineName', 16),
      textBase('t-hi-worker', 34, 55, 'WORKER : @operatorName', 14, { wrapAtCenter: true }),
      hLine('l-hi-hline', 39, 0, 125),
      textBase('t-hi-bob', 42, 122, 'BOB : @bobbinType  QTY : @bobbinQty', 16),
      textBase('t-hi-twist', 48, 122, 'TWIST : @twistName', 16),
      textBase('t-hi-netwt', 54, 122, 'NET WT : @netWeight KG', 17),
      bc('bc-hi', 62, 105, { heightMm: 8, moduleMm: 0.55 }),
    ]},
  },
  {
    stageKey: 'holo_receive',
    dimensions: { ...dims(3) },
    content: { copies: 2, texts: [
      titleBar('t-hr-title', 'RECEIVE FROM HOLO', { size: 21, y: 123, paddingMm: 0.8 }),
      vLine('l-hr-vline', 7, 125),
      textBase('t-hr-date', 10, 122, 'DATE : @date', 17),
      textBase('t-hr-item', 16, 122, 'ITEM : @itemName', 17, { wrapAtCenter: true }),
      textBase('t-hr-cut', 22, 122, 'CUT : @cut', 17),
      textBase('t-hr-yarn', 28, 122, 'YARN : @yarnName', 17, { wrapAtCenter: true }),
      textBase('t-hr-rolls', 34, 122, 'ROLLS : @rollType (@rollCount)', 17),
      textBase('t-hr-operator', 28, 55, 'OPR : @operatorName', 14, { wrapAtCenter: true }),
      textBase('t-hr-machine', 34, 55, 'M/C : @machineName', 14),
      hLine('l-hr-hline', 39, 0, 125),
      textBase('t-hr-gross', 42, 122, 'GROSS : @grossWeight', 17),
      textBase('t-hr-tare', 48, 122, 'TARE : @tareWeight', 17),
      textBase('t-hr-net', 54, 122, 'NET : @netWeight KG', 17),
      textBase('t-hr-twist', 42, 55, 'TWIST : @twist', 14),
      bc('bc-hr', 61, 105, { heightMm: 8, moduleMm: 0.55 }),
    ]},
  },
  {
    stageKey: 'coning_issue',
    dimensions: { ...dims(3) },
    content: { copies: 1, texts: [
      titleBar('t-coi-title', 'ISSUE TO CONING MACHINE', { size: 16, y: 123, paddingMm: 0.7 }),
      vLine('l-coi-vline', 6, 125),
      textBase('t-coi-date', 9, 122, 'DATE : @date', 14),
      textBase('t-coi-worker', 9, 55, 'WORKER : @operatorName', 12, { wrapAtCenter: true }),
      textBase('t-coi-item', 14, 122, 'ITEM : @itemName (@cut)', 14, { wrapAtCenter: true }),
      textBase('t-coi-yarn', 20, 122, 'YARN : @yarnName', 14, { wrapAtCenter: true }),
      textBase('t-coi-shift', 20, 55, 'SHIFT : @shift', 12),
      textBase('t-coi-rolls', 26, 122, 'ROLLS : @rollType (@rollCount)', 14),
      textBase('t-coi-theli', 26, 55, 'THELI : @wrapperName', 12),
      hLine('l-coi-hline', 31, 0, 125),
      textBase('t-coi-cone', 34, 122, 'CONE : @coneType (@perConeTargetG G)', 14, { wrapAtCenter: true }),
      textBase('t-coi-expcone', 34, 55, 'EXP : @expectedCones pcs', 12),
      textBase('t-coi-netwt', 40, 122, 'NET WT : @netWeight KG', 15),
      bc('bc-coi', 49, 95, { heightMm: 10, moduleMm: 0.35 }),
    ]},
  },
  {
    stageKey: 'coning_receive',
    dimensions: { ...dims(3) },
    content: { copies: 1, texts: [
      titleBar('t-cor-title', 'RECEIVE FROM CONING', { size: 16, y: 123, paddingMm: 0.7 }),
      vLine('l-cor-vline', 6, 125),
      textBase('t-cor-date', 9, 122, 'DATE : @date', 14),
      textBase('t-cor-operator', 9, 55, 'OPR : @operatorName', 12, { wrapAtCenter: true }),
      textBase('t-cor-item', 15, 122, 'ITEM : @itemName (@cut)', 14, { wrapAtCenter: true }),
      textBase('t-cor-yarn', 21, 122, 'YARN : @yarnName', 14, { wrapAtCenter: true }),
      textBase('t-cor-theli', 21, 55, 'THELI : @wrapperName', 12),
      textBase('t-cor-cone', 27, 122, 'CONE : @coneCount (@coneType)', 14),
      textBase('t-cor-machine', 27, 55, 'M/C : @machineName', 12),
      hLine('l-cor-hline', 32, 0, 125),
      textBase('t-cor-net', 35, 122, 'NET WT : @netWeight KG', 15),
      bc('bc-cor', 45, 95, { heightMm: 10, moduleMm: 0.35 }),
    ]},
  },
];

async function seed() {
  for (const t of templates) {
    const id = `template-${t.stageKey}-seed`;
    await prisma.stickerTemplate.upsert({
      where: { stageKey: t.stageKey },
      update: { dimensions: t.dimensions, content: t.content },
      create: { id, stageKey: t.stageKey, dimensions: t.dimensions, content: t.content },
    });
    console.log('Upserted', t.stageKey);
  }
  const all = await prisma.stickerTemplate.findMany();
  console.log('Total sticker templates:', all.length);
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
