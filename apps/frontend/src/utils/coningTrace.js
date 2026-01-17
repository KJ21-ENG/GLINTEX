export const buildConingTraceContext = (db) => ({
  holoRowsById: new Map((db.receive_from_holo_machine_rows || []).map(r => [r.id, r])),
  coningRowsById: new Map((db.receive_from_coning_machine_rows || []).map(r => [r.id, r])),
  holoIssueById: new Map((db.issue_to_holo_machine || []).map(i => [i.id, i])),
  coningIssueById: new Map((db.issue_to_coning_machine || []).map(i => [i.id, i])),
  cutterRowById: new Map((db.receive_from_cutter_machine_rows || []).map(r => [r.id, r])),
  cutsById: new Map((db.cuts || []).map(c => [c.id, c])),
  yarnsById: new Map((db.yarns || []).map(y => [y.id, y])),
  twistsById: new Map((db.twists || []).map(t => [t.id, t])),
  rollTypesById: new Map(((db.rollTypes || db.roll_types) || []).map(r => [r.id, r])),
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

const resolveFromHoloIssue = (holoIssue, ctx) => {
  let cutName = holoIssue?.cutId ? ctx.cutsById.get(holoIssue.cutId)?.name || '' : '';
  const yarnName = holoIssue?.yarnId ? ctx.yarnsById.get(holoIssue.yarnId)?.name || '' : '';
  const twistName = holoIssue?.twistId ? ctx.twistsById.get(holoIssue.twistId)?.name || '' : '';

  if (!cutName && holoIssue?.receivedRowRefs) {
    const refs = parseRefs(holoIssue.receivedRowRefs);
    const cutterRowId = refs[0]?.rowId;
    if (cutterRowId) {
      cutName = resolveCutFromCutterRow(ctx.cutterRowById.get(cutterRowId), ctx);
    }
  }

  return { cutName, yarnName, twistName };
};

export const resolveConingTrace = (issue, ctx, visitedIssues = new Set()) => {
  const cutNames = new Set();
  const yarnNames = new Set();
  const twistNames = new Set();
  const rollTypeNames = new Set();

  const addName = (set, val) => {
    const name = String(val || '').trim();
    if (name && name !== '—') set.add(name);
  };

  const addFromIssueFields = (issueToUse) => {
    if (!issueToUse) return;
    addName(cutNames, issueToUse.cut?.name || (issueToUse.cutId ? ctx.cutsById.get(issueToUse.cutId)?.name : ''));
    addName(yarnNames, issueToUse.yarn?.name || (issueToUse.yarnId ? ctx.yarnsById.get(issueToUse.yarnId)?.name : ''));
    addName(twistNames, issueToUse.twist?.name || (issueToUse.twistId ? ctx.twistsById.get(issueToUse.twistId)?.name : ''));
  };

  const walkIssue = (issueToWalk) => {
    addFromIssueFields(issueToWalk);
    if (!issueToWalk?.receivedRowRefs) return;
    if (issueToWalk?.id) visitedIssues.add(issueToWalk.id);
    const refs = parseRefs(issueToWalk.receivedRowRefs);
    refs.forEach((ref) => {
      const rowId = ref?.rowId;
      if (!rowId) return;

      const holoRow = ctx.holoRowsById.get(rowId);
      if (holoRow) {
        if (holoRow.rollTypeId) {
          addName(rollTypeNames, ctx.rollTypesById.get(holoRow.rollTypeId)?.name || '');
        }
        const holoIssue = ctx.holoIssueById.get(holoRow.issueId);
        if (holoIssue) {
          const resolved = resolveFromHoloIssue(holoIssue, ctx);
          addName(cutNames, resolved.cutName);
          addName(yarnNames, resolved.yarnName);
          addName(twistNames, resolved.twistName);
        }
        return;
      }

      const coningRow = ctx.coningRowsById.get(rowId);
      if (coningRow?.issueId && !visitedIssues.has(coningRow.issueId)) {
        visitedIssues.add(coningRow.issueId);
        const parentIssue = ctx.coningIssueById.get(coningRow.issueId);
        if (parentIssue) walkIssue(parentIssue);
      }
    });
  };

  addFromIssueFields(issue);
  walkIssue(issue);

  const joinNames = (set) => (set.size ? Array.from(set).join(', ') : '—');
  return {
    cutName: joinNames(cutNames),
    yarnName: joinNames(yarnNames),
    twistName: joinNames(twistNames),
    rollTypeName: joinNames(rollTypeNames),
  };
};
