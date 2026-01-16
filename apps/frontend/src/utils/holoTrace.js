export const buildHoloTraceContext = (db) => ({
  cutterRowById: new Map((db.receive_from_cutter_machine_rows || []).map(r => [r.id, r])),
  cutsById: new Map((db.cuts || []).map(c => [c.id, c])),
  yarnsById: new Map((db.yarns || []).map(y => [y.id, y])),
  twistsById: new Map((db.twists || []).map(t => [t.id, t])),
});

const parseRefs = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const resolveCutFromCutterRow = (cutterRow, ctx) => {
  if (!cutterRow) return '';
  const cutVal = cutterRow.cut;
  return (typeof cutVal === 'string' ? cutVal : cutVal?.name)
    || cutterRow.cutMaster?.name
    || (cutterRow.cutId ? ctx.cutsById.get(cutterRow.cutId)?.name : '')
    || '';
};

export const resolveHoloTrace = (issue, ctx) => {
  if (!issue) return { cutName: '—', yarnName: '—', twistName: '—' };

  const cutNames = new Set();
  if (issue.cutId) {
    const name = ctx.cutsById.get(issue.cutId)?.name || '';
    if (name) cutNames.add(name);
  }

  const refs = parseRefs(issue.receivedRowRefs);
  refs.forEach((ref) => {
    const rowId = ref?.rowId;
    if (!rowId) return;
    const cutterRow = ctx.cutterRowById.get(rowId);
    const cutName = resolveCutFromCutterRow(cutterRow, ctx);
    if (cutName) cutNames.add(cutName);
  });

  const joinNames = (set) => (set.size ? Array.from(set).join(', ') : '—');
  const yarnName = issue.yarnId ? ctx.yarnsById.get(issue.yarnId)?.name || '—' : '—';
  const twistName = issue.twistId ? ctx.twistsById.get(issue.twistId)?.name || '—' : '—';

  return {
    cutName: joinNames(cutNames),
    yarnName,
    twistName,
  };
};
