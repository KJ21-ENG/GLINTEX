// Factory label designs, version 2. Reading orientation, explicit boxes, real points.
import { LABEL_STAGE_KEYS } from './stages.js';
import { normalizeTemplate } from './model.js';

const MEDIA_75x125 = { widthMm: 75, heightMm: 125, orientation: 'landscape', rollWidthMm: 75, columns: 1, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 0, marginTopMm: 0, offsetXMm: 0, offsetYMm: 0, columnMode: 'repeat' };
const MEDIA_50x25_2UP = { widthMm: 50, heightMm: 25, orientation: 'portrait', rollWidthMm: 105, columns: 2, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 1.5, marginTopMm: 0, offsetXMm: 0, offsetYMm: 0, columnMode: 'repeat' };

const text = (id, x, y, w, h, value, o = {}) => ({ id, type: 'text', x, y, w, h, text: value, fontFamily: 'inter', fontSizePt: 10, bold: true, align: 'left', valign: 'middle', overflow: 'wrap-shrink', minFontSizePt: 6, lineHeight: 1.12, paddingMm: 0.6, ...o });
const title = (id, value) => text(id, 0, 0, 125, 8.5, value, { fontSizePt: 14, align: 'center', invert: true, uppercase: true, overflow: 'shrink', paddingMm: 1, letterSpacingPt: 0.5 });
const row = (id, y, value, o = {}) => text(id, 2, y, 121, 6.4, value, { fontSizePt: 11, ...o });
const left = (id, y, value, o = {}) => text(id, 2, y, 62, 6.4, value, { fontSizePt: 11, ...o });
const right = (id, y, value, o = {}) => text(id, 66, y, 57, 6.4, value, { fontSizePt: 11, ...o });
const rule = (id, y, x = 2, len = 121) => ({ id, type: 'line', x, y, lengthMm: len, thicknessMm: 0.3, direction: 'horizontal' });
const barcode = (id, x, y, o = {}) => ({ id, type: 'barcode', x, y, value: '{{barcode}}', symbology: 'code128', moduleMm: 0.375, barHeightMm: 11, showText: true, textSizePt: 7.5, quietZoneMm: 2.5, maxWidthMm: 82, ...o });
const bigValue = (id, value, caption) => [
  text(`${id}-caption`, 86, 51.5, 37, 4.5, caption, { fontSizePt: 8, bold: false, align: 'center', overflow: 'shrink', paddingMm: 0 }),
  text(id, 86, 56, 37, 11, value, { fontSizePt: 18, align: 'center', overflow: 'shrink', paddingMm: 0.4 }),
];

const large = (titleText, rows, bottom) => ({
  version: 2, media: MEDIA_75x125, copies: 1,
  elements: [title('title', titleText), ...rows, rule('rule-bottom', 49.5), barcode('barcode', 2, 51.5), ...bottom],
});

export const DEFAULT_STAGE_TEMPLATES = {
  [LABEL_STAGE_KEYS.INBOUND]: large('Inbound', [
    left('date', 10, 'DATE : @date'), right('lot', 10, 'LOT : @lotNo'),
    row('item', 17, '@itemName', { fontSizePt: 13, h: 9 }),
    left('roll', 27, 'ROLL NO : @seq'), right('firm', 27, '@firmName', { bold: false }),
    row('supplier', 34, 'SUPPLIER : @supplierName', { bold: false }),
    row('piece', 41, 'PIECE : @pieceId', { bold: false }),
  ], bigValue('weight', '@weight KG', 'WEIGHT')),

  [LABEL_STAGE_KEYS.CUTTER_ISSUE]: large('Issue to cutter', [
    left('date', 10, 'DATE : @date'), right('machine', 10, 'M/C : @machineName'),
    row('item', 17, '@itemName - @seq', { fontSizePt: 13, h: 9 }),
    left('cut', 27, 'CUT : @cut', { fontSizePt: 12 }), right('lot', 27, 'LOT : @lotNo  (@inboundDate)', { bold: false }),
    left('count', 34, 'PIECES : @count', { bold: false }), right('operator', 34, 'OPR : @operatorName', { bold: false }),
  ], bigValue('weight', '@totalWeight KG', 'WEIGHT')),

  [LABEL_STAGE_KEYS.CUTTER_RECEIVE]: {
    version: 2, media: MEDIA_75x125, copies: 2,
    elements: [
      title('title', 'Receive from cutter'),
      left('date', 10, 'DATE : @date'), right('shift', 10, 'SHIFT : @shift'),
      row('item', 16.5, '@itemName', { fontSizePt: 13, h: 8.5 }),
      left('cut', 26, 'CUT : @cut', { fontSizePt: 12 }), right('machine', 26, 'M/C : @machineName'),
      left('bobbin', 32.5, 'BOB : @bobbinName × @bobbinQty', { bold: false }), right('box', 32.5, 'BOX : @boxName', { bold: false }),
      left('operator', 39, 'OPR : @operatorName', { bold: false }), right('helper', 39, 'HELPER : @helperName', { bold: false }),
      rule('rule-weights', 46),
      text('gross', 2, 47.5, 40, 5, 'GROSS @grossWeight', { fontSizePt: 9, bold: false, paddingMm: 0.3 }),
      text('tare', 43, 47.5, 40, 5, 'TARE @tareWeight', { fontSizePt: 9, bold: false, paddingMm: 0.3 }),
      barcode('barcode', 2, 53.5),
      ...bigValue('net', '@netWeight KG', 'NET WEIGHT'),
    ],
  },

  [LABEL_STAGE_KEYS.HOLO_ISSUE]: {
    version: 2, media: MEDIA_75x125, copies: 2,
    elements: [
      title('title', 'Issue to holo'),
      left('date', 10, 'DATE : @date'), right('shift', 10, 'SHIFT : @shift'),
      row('item', 16.5, '@itemName', { fontSizePt: 13, h: 8.5 }),
      left('cut', 26, 'CUT : @cut', { fontSizePt: 12 }), right('yarn', 26, 'YARN : @yarnName'),
      left('machine', 32.5, 'M/C : @machineName', { bold: false }), right('worker', 32.5, 'WORKER : @operatorName', { bold: false }),
      left('bobbin', 39, 'BOB : @bobbinType × @bobbinQty', { bold: false }), right('twist', 39, 'TWIST : @twist', { bold: false }),
      rule('rule-bottom', 49.5),
      barcode('barcode', 2, 51.5),
      ...bigValue('net', '@netWeight KG', 'NET WEIGHT'),
    ],
  },

  [LABEL_STAGE_KEYS.HOLO_RECEIVE]: {
    version: 2, media: MEDIA_75x125, copies: 2,
    elements: [
      title('title', 'Receive from holo'),
      left('date', 10, 'DATE : @date'), right('shift', 10, 'SHIFT : @shift'),
      row('item', 16.5, '@itemName', { fontSizePt: 13, h: 8.5 }),
      left('cut', 26, 'CUT : @cut', { fontSizePt: 12 }), right('yarn', 26, 'YARN : @yarnName'),
      left('rolls', 32.5, 'ROLLS : @rollType × @rollCount', { bold: false }), right('machine', 32.5, 'M/C : @machineName', { bold: false }),
      left('operator', 39, 'OPR : @operatorName', { bold: false }), right('twist', 39, 'TWIST : @twist', { bold: false }),
      rule('rule-weights', 46),
      text('gross', 2, 47.5, 40, 5, 'GROSS @grossWeight', { fontSizePt: 9, bold: false, paddingMm: 0.3 }),
      text('tare', 43, 47.5, 40, 5, 'TARE @tareWeight', { fontSizePt: 9, bold: false, paddingMm: 0.3 }),
      barcode('barcode', 2, 53.5),
      ...bigValue('net', '@netWeight KG', 'NET WEIGHT'),
    ],
  },

  [LABEL_STAGE_KEYS.CONING_ISSUE]: {
    version: 2, media: MEDIA_75x125, copies: 1,
    elements: [
      title('title', 'Issue to coning'),
      left('date', 10, 'DATE : @date'), right('shift', 10, 'SHIFT : @shift'),
      row('item', 16.5, '@itemName (@cut)', { fontSizePt: 13, h: 8.5 }),
      left('yarn', 26, 'YARN : @yarnName'), right('worker', 26, 'WORKER : @operatorName', { bold: false }),
      left('rolls', 32.5, 'ROLLS : @rollType × @rollCount', { bold: false }), right('theli', 32.5, 'THELI : @wrapperName', { bold: false }),
      left('cone', 39, 'CONE : @coneType (@perConeTargetG g)', { bold: false }), right('expected', 39, 'EXPECTED : @expectedCones pcs', { bold: false }),
      rule('rule-bottom', 49.5),
      barcode('barcode', 2, 51.5),
      ...bigValue('net', '@netWeight KG', 'NET WEIGHT'),
    ],
  },

  [LABEL_STAGE_KEYS.CONING_RECEIVE]: {
    version: 2, media: MEDIA_75x125, copies: 1,
    elements: [
      title('title', 'Receive from coning'),
      left('date', 10, 'DATE : @date'), right('shift', 10, 'SHIFT : @shift'),
      row('item', 16.5, '@itemName (@cut)', { fontSizePt: 13, h: 8.5 }),
      left('yarn', 26, 'YARN : @yarnName'), right('operator', 26, 'OPR : @operatorName', { bold: false }),
      left('cone', 32.5, 'CONES : @coneCount × @coneType'), right('theli', 32.5, 'THELI : @wrapperName', { bold: false }),
      left('rolls', 39, 'ROLLS : @rollType × @rollCount', { bold: false }), right('box', 39, 'BOX : @boxName', { bold: false }),
      rule('rule-bottom', 49.5),
      barcode('barcode', 2, 51.5),
      ...bigValue('net', '@netWeight KG', 'NET WEIGHT'),
    ],
  },

  [LABEL_STAGE_KEYS.CUTTER_ISSUE_SMALL]: {
    version: 2, media: MEDIA_50x25_2UP, copies: 1,
    elements: [
      text('item', 1.5, 1.2, 36, 8.5, '@itemName', { fontSizePt: 8.5, valign: 'top', paddingMm: 0.4, lineHeight: 1.1 }),
      text('cut', 38, 1.2, 10.5, 8.5, '@cut', { fontSizePt: 11, align: 'center', overflow: 'shrink', paddingMm: 0.3 }),
      text('operator', 1.5, 10, 47, 4, '@operatorName', { fontSizePt: 7, bold: false, overflow: 'shrink', paddingMm: 0.3 }),
      barcode('barcode', 1, 14.5, { moduleMm: 0.25, barHeightMm: 6.5, textSizePt: 6, quietZoneMm: 1.5, maxWidthMm: 48 }),
    ],
  },

  [LABEL_STAGE_KEYS.CONING_RECEIVE_SMALL]: {
    version: 2, media: MEDIA_50x25_2UP, copies: 1,
    elements: [
      text('item', 1.5, 1.2, 36, 8.5, '@itemName', { fontSizePt: 8.5, valign: 'top', paddingMm: 0.4, lineHeight: 1.1 }),
      text('cut', 38, 1.2, 10.5, 8.5, '@cut', { fontSizePt: 11, align: 'center', overflow: 'shrink', paddingMm: 0.3 }),
      text('operator', 1.5, 10, 47, 4, '@operatorName', { fontSizePt: 7, bold: false, overflow: 'shrink', paddingMm: 0.3 }),
      barcode('barcode', 1, 14.5, { moduleMm: 0.25, barHeightMm: 6.5, textSizePt: 6, quietZoneMm: 1.5, maxWidthMm: 48 }),
    ],
  },
};

export const getDefaultTemplate = (stageKey) => {
  const def = DEFAULT_STAGE_TEMPLATES[stageKey];
  return def ? normalizeTemplate(JSON.parse(JSON.stringify(def))) : null;
};

export const CALIBRATION_TEMPLATE = normalizeTemplate({
  version: 2,
  media: { ...MEDIA_75x125, orientation: 'portrait' },
  copies: 1,
  elements: [
    text('title', 2, 2, 71, 6, 'GLINTEX TEST — not a receipt', { fontSizePt: 9, overflow: 'shrink' }),
    rule('ruler', 10, 2, 50),
    text('legend', 2, 11, 60, 4, 'Line above: 50 mm from the left edge + 2 mm', { fontSizePt: 7, bold: false }),
    { id: 'frame', type: 'rect', x: 5, y: 20, w: 20, h: 20, strokeMm: 0.3, fill: false, radiusMm: 0 },
    text('frame-legend', 27, 27, 40, 6, '20 × 20 mm square', { fontSizePt: 8, bold: false }),
    barcode('barcode', 2, 45, { value: 'GLINTEX123', moduleMm: 0.25, barHeightMm: 8, maxWidthMm: 70 }),
  ],
});
