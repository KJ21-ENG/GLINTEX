// Representative values so a designer sees the label as it will print, not as placeholders.
import { getStageVariables } from './stages.js';

const TYPICAL = {
  lotNo: '182', itemName: 'POLYESTER METALLIC SILVER', firmName: 'GLINTEX', supplierName: 'SHREE RAM POLYFILMS',
  pieceId: '182-4', seq: '4', weight: 12.345, date: '2026-10-10', barcode: 'RCO-240-003-C001', barcodeNumber: 'RCO-240-003-C001',
  inboundDate: '2026-10-02', cut: '1/64', count: 6, totalWeight: 72.4, machineName: 'CUTTER 3', operatorName: 'RAMESH KUMAR',
  netWeight: 11.82, grossWeight: 12.475, tareWeight: 0.655, bobbinQty: 20, bobbinName: 'PLASTIC 20', boxName: 'BOX 7',
  cutName: '1/64', helperName: 'SURESH', shift: 'DAY', totalRolls: 8, bobbinType: 'PLASTIC', yarnKg: 1.25, twistName: '120',
  twist: '120 TPM', yarnName: 'POLYESTER 150D', rollCount: 2, rollType: 'HOLO', coneType: 'PAPER CONE', wrapperName: 'THELI 5 KG',
  expectedCones: 24, perConeTargetG: 480, coneCount: 24, issueBarcode: 'ICO-240-003', issueBarcodeNumber: 'ICO-240-003',
  receiveBarcode: 'RCO-240-003-C001', metallicBobbins: 12, metallicBobbinsWeight: 6.5, totalPieces: 9,
};

const LONG = {
  ...TYPICAL,
  itemName: 'POLYESTER METALLIC SILVER EXTRA LONG MATERIAL NAME WITH SPECIFICATION',
  supplierName: 'SHREE RAM POLYFILMS AND PACKAGING PRIVATE LIMITED',
  operatorName: 'RAMESHCHANDRA MAHESHBHAI PATEL',
  machineName: 'CUTTER MACHINE 12 (NEW)', yarnName: 'POLYESTER 150D/48F BRIGHT',
  barcode: 'RCO-240123-003-C012', barcodeNumber: 'RCO-240123-003-C012', issueBarcode: 'ICO-240123-003',
  wrapperName: 'THELI 5 KG PRINTED', coneType: 'PLASTIC CONE LARGE', netWeight: 1234.567, grossWeight: 1235.222, totalWeight: 2469.134,
};

export const SAMPLE_VARIANTS = [
  { key: 'typical', label: 'Typical values' },
  { key: 'long', label: 'Long values' },
  { key: 'blank', label: 'Placeholders' },
];

// Real barcode formats per stage: INB/ICU/RCU use lot and sequence, IHO/RHO/ICO/RCO a series.
const STAGE_BARCODES = {
  typical: {
    inbound: 'INB-182-004', cutter_issue: 'ICU-182-004', cutter_issue_small: 'ICU-182-004', cutter_receive: 'RCU-182-004-C001',
    holo_issue: 'IHO-240', holo_receive: 'RHO-240-C001', coning_issue: 'ICO-240', coning_receive: 'RCO-240-C001', coning_receive_small: 'RCO-240-C001',
  },
  long: {
    inbound: 'INB-18234-012', cutter_issue: 'ICU-18234-012', cutter_issue_small: 'ICU-18234-012', cutter_receive: 'RCU-18234-012-C003',
    holo_issue: 'IHO-24012', holo_receive: 'RHO-24012-C012', coning_issue: 'ICO-24012', coning_receive: 'RCO-24012-C012', coning_receive_small: 'RCO-24012-C012',
  },
};

export const buildSampleData = (stageKey, variant = 'typical') => {
  if (variant === 'blank') return {};
  const source = variant === 'long' ? LONG : TYPICAL;
  const data = {};
  for (const variable of getStageVariables(stageKey)) {
    if (Object.prototype.hasOwnProperty.call(source, variable.key)) data[variable.key] = source[variable.key];
  }
  const barcode = STAGE_BARCODES[variant === 'long' ? 'long' : 'typical'][stageKey] || source.barcode;
  data.barcode = barcode;
  if ('barcodeNumber' in data) data.barcodeNumber = barcode;
  if ('issueBarcode' in data) data.issueBarcode = barcode.replace(/^R/, 'I').replace(/-C\d+$/, '');
  return data;
};
