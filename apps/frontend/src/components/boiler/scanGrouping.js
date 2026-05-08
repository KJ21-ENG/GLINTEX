const DISPLAY_EMPTY = '—';

const cleanText = (value) => String(value ?? '').trim();

const displayText = (value) => cleanText(value) || DISPLAY_EMPTY;

const buildGroupKey = (item) => [
    displayText(item?.itemName),
    displayText(item?.twistName),
    displayText(item?.cutName),
].join('::');

const createStatusCounts = () => ({
    found: 0,
    loading: 0,
    alreadySteamed: 0,
    notFound: 0,
    error: 0,
});

const incrementStatus = (counts, status) => {
    if (status === 'found') counts.found += 1;
    else if (status === 'loading') counts.loading += 1;
    else if (status === 'already_steamed') counts.alreadySteamed += 1;
    else if (status === 'not_found') counts.notFound += 1;
    else if (status === 'error') counts.error += 1;
};

export const formatScanGroupValues = (values) => {
    const list = Array.from(values || [])
        .map(cleanText)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return list.length ? list.join(', ') : DISPLAY_EMPTY;
};

export const buildBoilerScanGroups = (items) => {
    const groups = new Map();

    (items || []).forEach((item, index) => {
        const key = buildGroupKey(item);
        const existing = groups.get(key) || {
            key,
            itemName: displayText(item.itemName),
            twistName: displayText(item.twistName),
            cutName: displayText(item.cutName),
            recordCount: 0,
            totalRolls: 0,
            totalNetWeight: 0,
            lots: new Set(),
            statusCounts: createStatusCounts(),
            firstIndex: index,
            rows: [],
        };

        existing.recordCount += 1;
        existing.totalRolls += Number(item.rollCount || 0);
        existing.totalNetWeight += Number(item.netWeight || 0);
        if (item.lotNo) existing.lots.add(item.lotNo);
        incrementStatus(existing.statusCounts, item.status);
        existing.rows.push(item);
        groups.set(key, existing);
    });

    return Array.from(groups.values()).sort((a, b) => a.firstIndex - b.firstIndex);
};

export const getScanGroupStatusParts = (group) => {
    const counts = group?.statusCounts || {};
    return [
        counts.found ? { key: 'found', label: 'Ready', count: counts.found } : null,
        counts.loading ? { key: 'loading', label: 'Loading', count: counts.loading } : null,
        counts.alreadySteamed ? { key: 'already_steamed', label: 'Steamed', count: counts.alreadySteamed } : null,
        counts.notFound ? { key: 'not_found', label: 'Not found', count: counts.notFound } : null,
        counts.error ? { key: 'error', label: 'Error', count: counts.error } : null,
    ].filter(Boolean);
};

export const getScanGroupTone = (group) => {
    const counts = group?.statusCounts || {};
    if (counts.error) return 'error';
    if (counts.notFound) return 'not_found';
    if (counts.loading) return 'loading';
    if (counts.alreadySteamed && !counts.found) return 'already_steamed';
    if (counts.found) return 'found';
    return 'default';
};
