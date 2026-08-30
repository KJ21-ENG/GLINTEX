import { buildConingTraceContext, resolveConingTrace } from './coningTrace';
import { buildHoloTraceContext, resolveHoloTrace } from './holoTrace';

const findById = (rows, id) => (rows || []).find((row) => String(row?.id ?? '') === String(id ?? ''));

const parseRefs = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export function buildHoloReceiveLabelData({ db, row, holoTraceContext = null }) {
  const issue = row?.issue || findById(db.issue_to_holo_machine, row?.issueId);
  const serverTrace = row?.trace || row?.issue?.trace || issue?.trace || {};
  const serverCrates = Array.isArray(issue?.crates) ? issue.crates : [];
  const serverCrate = serverCrates.find((crate) => crate?.pieceId === row?.pieceId) || serverCrates[0] || null;
  const item = findById(db.items, row?.itemId || issue?.itemId);
  const rollType = findById(db.rollTypes, row?.rollTypeId);
  const box = findById(db.boxes, row?.boxId);
  const flattenedCut = row?.cutName
    || row?.issue?.cutName
    || issue?.cutName
    || serverTrace.cutName
    || serverCrate?.cutName
    || '';
  const flattenedTwist = row?.twistName
    || row?.issue?.twistName
    || issue?.twistName
    || serverTrace.twistName
    || serverCrate?.twistName
    || findById(db.twists, issue?.twistId)?.name
    || '';
  const resolved = issue && !flattenedCut
    ? resolveHoloTrace(issue, holoTraceContext || buildHoloTraceContext(db))
    : { cutName: '—', twistName: '—' };
  const cut = flattenedCut || (resolved.cutName === '—' ? '' : resolved.cutName);
  const yarnName = row?.yarnName
    || row?.issue?.yarnName
    || issue?.yarnName
    || serverTrace.yarnName
    || serverCrate?.yarnName
    || findById(db.yarns, issue?.yarnId)?.name
    || '';
  const twistName = flattenedTwist || (resolved.twistName === '—' ? '' : resolved.twistName);

  const boxWeight = Number(box?.weight || 0);
  const rollTypeWeight = Number(rollType?.weight || 0);
  const rollCount = Number(row?.rollCount || 1);
  const calculatedTare = boxWeight + (rollTypeWeight * rollCount);
  const tareWeight = Number.isFinite(row?.tareWeight) ? Number(row.tareWeight) : calculatedTare;
  const lotLabel = row?.lotLabel || row?.lotNo || serverCrate?.lotNo || row?.issue?.lotLabel || row?.issue?.lotNo || issue?.lotLabel || issue?.lotNo || '';
  const netWeight = Number.isFinite(row?.rollWeight)
    ? Number(row.rollWeight)
    : Number.isFinite(row?.netWeight)
      ? Number(row.netWeight)
      : Number.isFinite(row?.grossWeight)
        ? Math.max(0, Number(row.grossWeight) - tareWeight)
        : 0;
  const operatorName = row?.operatorName
    || row?.operator?.name
    || row?.issue?.operatorName
    || (issue?.operatorId ? findById(db.operators, issue.operatorId)?.name : '')
    || '';
  const machineName = row?.machineName
    || row?.machineNo
    || row?.machine?.name
    || row?.issue?.machineName
    || (issue?.machineId ? findById(db.machines, issue.machineId)?.name : '')
    || '';

  return {
    lotNo: lotLabel,
    itemName: row?.itemName || row?.issue?.itemName || issue?.itemName || serverTrace.itemName || serverCrate?.itemName || item?.name || '',
    rollCount,
    rollType: row?.rollTypeName || row?.rollType?.name || rollType?.name || '',
    netWeight,
    grossWeight: row?.grossWeight,
    tareWeight,
    boxName: row?.boxName || row?.box?.name || box?.name || '',
    cut,
    yarnName,
    twist: twistName,
    machineName,
    operatorName,
    shift: row?.shift || row?.issue?.shift || issue?.shift || '',
    date: row?.date || row?.createdAt,
    barcode: row?.barcode,
  };
}

export function buildConingReceiveLabelData({ db, row, coningTraceContext = null }) {
  const issue = row?.issue || findById(db.issue_to_coning_machine, row?.issueId);
  const serverTrace = row?.trace || row?.issue?.trace || issue?.trace || {};
  const serverSources = Array.isArray(issue?.sources)
    ? issue.sources
    : (Array.isArray(issue?.crates) ? issue.crates : []);
  const serverSource = serverSources[0] || null;
  const box = findById(db.boxes, row?.boxId);
  const operator = findById(db.operators, row?.operatorId);
  const item = findById(db.items, row?.itemId || issue?.itemId);

  let coneType = row?.coneTypeName || row?.issue?.coneTypeName || issue?.coneTypeName || serverTrace.coneTypeName || serverSource?.coneTypeName || '';
  let wrapperName = row?.wrapperName || row?.issue?.wrapperName || issue?.wrapperName || serverTrace.wrapperName || serverSource?.wrapperName || '';
  let cut = row?.cutName || row?.issue?.cutName || issue?.cutName || serverTrace.cutName || serverSource?.cutName || '';
  let yarnName = row?.yarnName || row?.issue?.yarnName || issue?.yarnName || serverTrace.yarnName || serverSource?.yarnName || '';
  let rollType = row?.rollTypeName || row?.issue?.rollTypeName || issue?.rollTypeName || serverTrace.rollTypeName || serverSource?.rollTypeName || '';
  let twist = row?.twistName || row?.issue?.twistName || issue?.twistName || serverTrace.twistName || serverSource?.twistName || '';

  const refs = parseRefs(issue?.receivedRowRefs);
  if (refs.length > 0) {
    const firstRef = refs[0];
    if (!coneType && firstRef?.coneTypeId) coneType = findById(db.cone_types, firstRef.coneTypeId)?.name || '';
    if (!wrapperName && firstRef?.wrapperId) wrapperName = findById(db.wrappers, firstRef.wrapperId)?.name || '';
  }

  if (issue) {
    const resolved = (!cut || !yarnName || !twist || !rollType)
      ? resolveConingTrace(issue, coningTraceContext || buildConingTraceContext(db))
      : { cutName: '—', yarnName: '—', twistName: '—', rollTypeName: '—' };
    cut = cut || resolved.cutName;
    yarnName = yarnName || resolved.yarnName;
    twist = twist || resolved.twistName;
    rollType = rollType || resolved.rollTypeName;
  }

  const lotLabel = row?.lotLabel || row?.lotNo || serverSource?.lotNo || row?.issue?.lotLabel || row?.issue?.lotNo || issue?.lotLabel || issue?.lotNo || '';
  const netWeight = Number.isFinite(row?.netWeight)
    ? Number(row.netWeight)
    : Number.isFinite(row?.grossWeight) && Number.isFinite(row?.tareWeight)
      ? Math.max(0, Number(row.grossWeight) - Number(row.tareWeight))
      : Number(row?.grossWeight || 0);

  const cutResolved = cut === '—' ? '' : cut;
  const yarnResolved = yarnName === '—' ? '' : yarnName;
  const twistResolved = twist === '—' ? '' : twist;
  const rollTypeResolved = rollType === '—' ? '' : rollType;
  const machineName = row?.machineName
    || row?.machineNo
    || row?.machine?.name
    || row?.issue?.machineName
    || (issue?.machineId ? findById(db.machines, issue.machineId)?.name : '')
    || '';
  const operatorName = row?.operatorName
    || row?.operator?.name
    || row?.issue?.operatorName
    || operator?.name
    || (issue?.operatorId ? findById(db.operators, issue.operatorId)?.name : '')
    || '';

  return {
    barcodeNumber: row?.barcode,
    lotNo: lotLabel,
    itemName: row?.itemName || row?.issue?.itemName || issue?.itemName || serverTrace.itemName || serverSource?.itemName || item?.name || '',
    coneCount: row?.coneCount,
    grossWeight: row?.grossWeight,
    tareWeight: row?.tareWeight || 0,
    netWeight,
    boxName: row?.boxName || row?.box?.name || box?.name || '',
    cut: cutResolved || '',
    yarnName: yarnResolved || '',
    twist: twistResolved || '',
    rollType: rollTypeResolved,
    coneType,
    wrapperName,
    operatorName,
    machineName,
    shift: row?.shift || row?.issue?.shift || issue?.shift || '',
    date: row?.date || row?.createdAt,
    issueBarcode: row?.issueBarcode || row?.issue?.barcode || issue?.barcode || '',
    barcode: row?.barcode,
  };
}
