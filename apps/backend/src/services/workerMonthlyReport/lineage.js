import { quantities } from './quantities.js';

export const MAX_TRACE_DEPTH = 32;
export function parseRefs(value, { allowConeMetadata = false } = {}) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return { refs: [], malformed: true }; } }
  if (value == null) return { refs: [], malformed: false };
  if (!Array.isArray(value)) return { refs: [], malformed: true };
  // Own-stage opening writers persist one metadata-only placeholder. It is
  // not a source ref; accept only that exact shape, never an empty object or
  // an unidentified entry mixed into otherwise available source lineage.
  const metadataOnly = allowConeMetadata && value.length === 1 && value[0]
    && Object.prototype.hasOwnProperty.call(value[0], 'coneTypeId')
    && Object.keys(value[0]).every(key => ['coneTypeId', 'wrapperId'].includes(key))
    && Object.values(value[0]).every(entry => entry === null || typeof entry === 'string');
  return { refs: value, malformed: !metadataOnly && value.some(ref => !ref || typeof ref !== 'object'
    || typeof ref.rowId !== 'string' || !ref.rowId.trim()) };
}
export function refIds(value) {
  return [...new Set(parseRefs(value).refs.map(ref => ref?.rowId).filter(id => typeof id === 'string' && id.trim()))].sort();
}

export function sourceSelection(row) {
  const issueRefs = parseRefs(row.issue?.receivedRowRefs, { allowConeMetadata: true });
  const issueIds = refIds(row.issue?.receivedRowRefs);
  const source = parseRefs(row.sourceRowRefs);
  const sourceIds = refIds(row.sourceRowRefs);
  if (!source.refs.length && !source.malformed) return { ids: issueIds, basis: 'issue_refs', uncertain: issueRefs.malformed };
  const weight = quantities(row).netKg;
  const sum = source.refs.reduce((total, ref) => total + (typeof ref?.weight === 'number' ? ref.weight : NaN), 0);
  const reliable = !source.malformed && sourceIds.length > 0 && source.refs.every(ref =>
    typeof ref?.rowId === 'string' && issueIds.includes(ref.rowId) && typeof ref.weight === 'number' && Number.isFinite(ref.weight) && ref.weight > 0)
    && weight !== null && Math.abs(sum - weight) <= 0.001;
  return reliable ? { ids: sourceIds, basis: 'receive_source_refs', uncertain: issueRefs.malformed }
    : { ids: [...new Set([...issueIds, ...sourceIds])].sort(), basis: 'unreliable_receive_refs', uncertain: true };
}

// Batched graph hydration occurs outside the resolver. Resolution has no database I/O.
// Cache by row and remaining depth. A cycle never becomes a direct-cut fallback.
export function createCutResolver(graph, field = 'cutId') {
  const cache = new Map();
  const dimensionName = field.replace(/Id$/, '');
  const missing = (flag, path = []) => ({ ids: [], unresolved: true, available: true, flags: [flag], paths: path });
  const merge = (results) => ({ ids: [...new Set(results.flatMap(r => r.ids))].sort(),
    unresolved: results.some(r => r.unresolved), available: results.some(r => r.available),
    flags: [...new Set(results.flatMap(r => r.flags))].sort(), paths: [...new Set(results.flatMap(r => r.paths))].sort() });
  const terminal = (id, path) => ({ ids: id ? [id] : [], unresolved: !id, available: true, flags: id ? [] : [`missing_${dimensionName}`], paths: [path] });

  function walk(id, stack, depth) {
    if (stack.has(id)) return missing('lineage_cycle', [id]);
    if (depth >= MAX_TRACE_DEPTH) return missing('lineage_depth_limit', [id]);
    const key = `${id}:${depth}`;
    if (cache.has(key)) return cache.get(key);
    const node = graph.get(id);
    if (!node) return { ids: [], unresolved: true, available: false, flags: ['missing_source'], paths: [id] };
    const { row, stage } = node;
    if (row.isDeleted || row.issue?.isDeleted) return missing('deleted_source', [id]);
    const next = new Set(stack); next.add(id);
    let result;
    if (stage === 'cutter') result = terminal(row[field] || row.issue?.[field], id);
    else if (!row.issue) result = missing('missing_source_issue', [id]);
    else if (stage === 'holo' && row.issue[field]) result = terminal(row.issue[field], id);
    else {
      const selection = stage === 'coning' ? sourceSelection(row) : { ids: refIds(row.issue.receivedRowRefs), uncertain: parseRefs(row.issue.receivedRowRefs).malformed };
      result = resolveSelection(row.issue, selection, next, depth + 1);
      result = { ...result, paths: [...new Set([id, ...result.paths])].sort() };
    }
    // Results involving a cycle depend on the current ancestor path.
    if (!result.flags.includes('lineage_cycle')) cache.set(key, result);
    return result;
  }
  function resolveSelection(issue, selection, stack, depth) {
    const traced = merge(selection.ids.map(id => walk(id, stack, depth)));
    if (selection.uncertain) return { ...traced, available: true, unresolved: true, flags: [...traced.flags, 'unreliable_source_refs'] };
    if (!traced.available) {
      const fallback = terminal(issue?.[field], `issue:${issue?.id || 'missing'}`);
      return { ...fallback, flags: [...traced.flags, `direct_${dimensionName}_fallback`], paths: [...traced.paths, ...fallback.paths] };
    }
    return traced;
  }
  return (row) => {
    const selection = sourceSelection(row);
    const traced = resolveSelection(row.issue, selection, new Set([row.id]), 0);
    const state = traced.unresolved ? (traced.ids.length ? 'partial' : 'unresolved') : traced.ids.length > 1 ? 'mixed' : 'resolved';
    return { ...traced, state, basis: selection.basis, sourceRowIds: selection.ids };
  };
}
