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

export function buildHoloReceiveLabelData({ db, row, holoTraceContext = buildHoloTraceContext(db) }) {
  const issue = row?.issue || findById(db.issue_to_holo_machine, row?.issueId);
  const item = findById(db.items, issue?.itemId);
  const rollType = findById(db.rollTypes, row?.rollTypeId);
  const box = findById(db.boxes, row?.boxId);
  const yarnName = findById(db.yarns, issue?.yarnId)?.name || '';
  const resolved = issue ? resolveHoloTrace(issue, holoTraceContext) : { cutName: '—', twistName: '—' };
  const cut = resolved.cutName === '—' ? '' : resolved.cutName;
  const twistName = resolved.twistName === '—' ? '' : resolved.twistName;

  const boxWeight = Number(box?.weight || 0);
  const rollTypeWeight = Number(rollType?.weight || 0);
  const rollCount = Number(row?.rollCount || 1);
  const calculatedTare = boxWeight + (rollTypeWeight * rollCount);
  const tareWeight = Number.isFinite(row?.tareWeight) ? Number(row.tareWeight) : calculatedTare;
  const lotLabel = issue?.lotLabel || issue?.lotNo || row?.issue?.lotNo || '';
  const netWeight = Number.isFinite(row?.rollWeight)
    ? Number(row.rollWeight)
    : Number.isFinite(row?.netWeight)
      ? Number(row.netWeight)
      : Number.isFinite(row?.grossWeight)
        ? Math.max(0, Number(row.grossWeight) - tareWeight)
        : 0;
  const operatorName = row?.operator?.name
    || (issue?.operatorId ? findById(db.operators, issue.operatorId)?.name : '')
    || '';
  const machineName = row?.machineNo || row?.machine?.name
    || (issue?.machineId ? findById(db.machines, issue.machineId)?.name : '')
    || '';

  return {
    lotNo: lotLabel,
    itemName: item?.name || '',
    rollCount,
    rollType: rollType?.name || '',
    netWeight,
    grossWeight: row?.grossWeight,
    tareWeight,
    boxName: box?.name || row?.box?.name || '',
    cut,
    yarnName,
    twist: twistName,
    machineName,
    operatorName,
    shift: issue?.shift || row?.shift || '',
    date: row?.date || row?.createdAt,
    barcode: row?.barcode,
  };
}

export function buildConingReceiveLabelData({ db, row, coningTraceContext = buildConingTraceContext(db) }) {
  const issue = row?.issue || findById(db.issue_to_coning_machine, row?.issueId);
  const box = findById(db.boxes, row?.boxId);
  const operator = findById(db.operators, row?.operatorId);
  const item = findById(db.items, issue?.itemId);

  let coneType = '';
  let wrapperName = '';
  let cut = '';
  let yarnName = '';
  let rollType = '';
  let twist = '';

  const refs = parseRefs(issue?.receivedRowRefs);
  if (refs.length > 0) {
    const firstRef = refs[0];
    if (firstRef?.coneTypeId) coneType = findById(db.cone_types, firstRef.coneTypeId)?.name || '';
    if (firstRef?.wrapperId) wrapperName = findById(db.wrappers, firstRef.wrapperId)?.name || '';
  }

  if (issue) {
    const resolved = resolveConingTrace(issue, coningTraceContext);
    cut = resolved.cutName;
    yarnName = resolved.yarnName;
    twist = resolved.twistName;
    rollType = resolved.rollTypeName;
  }

  const lotLabel = issue?.lotLabel || issue?.lotNo || row?.issue?.lotNo || row?.lotNo || '';
  const netWeight = Number.isFinite(row?.netWeight)
    ? Number(row.netWeight)
    : Number.isFinite(row?.grossWeight) && Number.isFinite(row?.tareWeight)
      ? Math.max(0, Number(row.grossWeight) - Number(row.tareWeight))
      : Number(row?.grossWeight || 0);

  const cutResolved = cut === '—' ? '' : cut;
  const yarnResolved = yarnName === '—' ? '' : yarnName;
  const twistResolved = twist === '—' ? '' : twist;
  const rollTypeResolved = rollType === '—' ? '' : rollType;
  const machineName = row?.machineNo
    || row?.machine?.name
    || (issue?.machineId ? findById(db.machines, issue.machineId)?.name : '')
    || '';
  const operatorName = operator?.name
    || row?.operator?.name
    || (issue?.operatorId ? findById(db.operators, issue.operatorId)?.name : '')
    || '';

  return {
    lotNo: lotLabel,
    itemName: row?.itemName || item?.name || '',
    coneCount: row?.coneCount,
    grossWeight: row?.grossWeight,
    tareWeight: row?.tareWeight || 0,
    netWeight,
    boxName: box?.name || row?.box?.name || '',
    cut: row?.cutName || (cutResolved || ''),
    yarnName: row?.yarnName || (yarnResolved || ''),
    twist: row?.twistName || (twistResolved || ''),
    rollType: rollTypeResolved,
    coneType: row?.coneTypeName || coneType,
    wrapperName,
    operatorName,
    machineName,
    shift: issue?.shift || row?.shift || '',
    date: row?.date || row?.createdAt,
    barcode: row?.barcode,
  };
}
