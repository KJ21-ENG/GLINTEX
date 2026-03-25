import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge } from '../ui';
import { formatKg, formatDateDDMMYYYY, fuzzyScore, calculateMultiTermScore, calcAvailableCountFromWeight } from '../../utils';
import { ChevronDown, ChevronRight, Flame, FlameKindling, Printer } from 'lucide-react';
import { HighlightMatch } from '../common/HighlightMatch';
import { LotPopover } from './LotPopover';
import { cn } from '../../lib/utils';
import { buildHoloTraceContext, resolveHoloTrace } from '../../utils/holoTrace';
import { LABEL_STAGE_KEYS, printStageTemplate, loadTemplate } from '../../utils/labelPrint';

const buildGroupKey = (lot) => ([
  lot.itemId || lot.itemName || '',
  lot.supplierId || lot.supplierName || '',
  lot.cutName || '',
  lot.yarnName || '',
  lot.twistName || ''
].join('::'));

const normalizeLotKeyIdentity = (rawKey) => {
  try {
    const decoded = JSON.parse(window.atob(String(rawKey || '')));
    if (!decoded || typeof decoded !== 'object') return null;
    if (decoded.process !== 'holo') return null;
    return [
      decoded.process || '',
      decoded.lotLabel || '',
      decoded.lotNoRaw || '',
      decoded.itemId || '',
      decoded.yarnId || '',
      decoded.twistId || '',
      decoded.firmId || '',
      decoded.supplierId || '',
      decoded.isMixed ? '1' : '0',
    ].join('::');
  } catch {
    return null;
  }
};

export function HoloView({ db, filters, search = '', groupBy = false, onApplyFilter, onDataChange, v2 = null }) {
  const EPSILON = 1e-9;
  const [expandedLot, setExpandedLot] = useState(null);
  const [reprintingId, setReprintingId] = useState(null);
  useEffect(() => { setExpandedLot(null); }, [groupBy]);
  const v2Lots = v2?.lots;
  const v2RowsByKey = v2?.rowsByKey || {};
  const v2LoadLotRows = v2?.loadLotRows;
  const barcodeHitKeys = v2?.barcodeHitKeys;
  const lastAutoExpandRef = useRef(null);
  const v2LotKeyByIdentity = useMemo(() => {
    if (!Array.isArray(v2Lots)) return new Map();
    const map = new Map();
    v2Lots.forEach((lot) => {
      const id = normalizeLotKeyIdentity(lot?.lotKey);
      if (id && !map.has(id)) map.set(id, lot.lotKey);
    });
    return map;
  }, [v2Lots]);
  const barcodeHitIdentitySet = useMemo(() => {
    if (!barcodeHitKeys || typeof barcodeHitKeys.forEach !== 'function') return new Set();
    const set = new Set();
    barcodeHitKeys.forEach((key) => {
      const id = normalizeLotKeyIdentity(key);
      if (id) set.add(id);
    });
    return set;
  }, [barcodeHitKeys]);

  const traceContext = useMemo(() => buildHoloTraceContext(db), [db]);
  const hasActiveRollAvailability = (row) => {
    const rolls = Number(row?.availableRolls || 0);
    const weight = Number(row?.availableWeight || 0);
    return rolls > 0 || weight > EPSILON;
  };

  // --- Data Prep ---

  // 1. Map Issue Metadata (to link back to Lot)
  const holoIssueMap = useMemo(() => {
    const map = new Map();
    (db.issue_to_holo_machine || []).forEach((issue) => { if (issue?.id) map.set(issue.id, issue); });
    return map;
  }, [db.issue_to_holo_machine]);

  const cutByIssueId = useMemo(() => {
    const map = new Map();
    (db.issue_to_holo_machine || []).forEach((issue) => {
      if (!issue?.id) return;
      const resolved = resolveHoloTrace(issue, traceContext);
      map.set(issue.id, resolved.cutName || '—');
    });
    return map;
  }, [db.issue_to_holo_machine, traceContext]);

  // 2. Map Lot Metadata
  const lotMetaMap = useMemo(() => {
    const map = new Map();
    (db.lots || []).forEach((lot) => {
      const item = db.items.find(i => i.id === lot.itemId);
      const firm = db.firms.find(f => f.id === lot.firmId);
      const supplier = db.suppliers.find(s => s.id === lot.supplierId);
      map.set(lot.lotNo, {
        ...lot,
        itemName: item?.name || lot.itemName || '—',
        firmName: firm?.name || lot.firmName || '—',
        supplierName: supplier?.name || lot.supplierName || '—',
      });
    });
    return map;
  }, [db.lots, db.items, db.firms, db.suppliers]);

  // 3. Process Rows
  const holoRows = useMemo(() => {
    if (Array.isArray(v2Lots)) return [];
    return (db.receive_from_holo_machine_rows || []).map((row) => {
      const issue = row?.issueId ? holoIssueMap.get(row.issueId) : null;
      const lotNoRaw = issue?.lotNo || '';
      const lotLabel = issue?.lotLabel || lotNoRaw || '';
      const lotNos = Array.isArray(issue?.lotNos) ? issue.lotNos : (lotNoRaw ? [lotNoRaw] : []);
      const lotMeta = lotNoRaw ? lotMetaMap.get(lotNoRaw) : null;
      const hasMixedLots = Array.isArray(issue?.lotNos) && issue.lotNos.length > 1;

      const yarn = db.yarns?.find(y => y.id === issue?.yarnId);
      const twist = db.twists?.find(t => t.id === issue?.twistId);
      const itemName = lotMeta?.itemName || db.items?.find(i => i.id === issue?.itemId)?.name || '—';
      const firmName = lotMeta?.firmName || (hasMixedLots ? 'Mixed' : '—');
      const supplierName = lotMeta?.supplierName || (hasMixedLots ? 'Mixed' : '—');

      const baseNetWeight = Number.isFinite(row.rollWeight)
        ? Number(row.rollWeight)
        : (Number(row.grossWeight || 0) - Number(row.tareWeight || 0));
      const dispatchedRolls = Number(row.dispatchedCount || 0);
      const dispatchedWeight = Number(row.dispatchedWeight || 0);
      const issuedToConingRolls = Number(row.issuedToConingRolls || 0);
      const issuedToConingWeight = Number(row.issuedToConingWeight || 0);
      const availableWeightRaw = Math.max(0, baseNetWeight - dispatchedWeight - issuedToConingWeight);
      const availableWeight = availableWeightRaw > EPSILON ? availableWeightRaw : 0;
      const availableRolls = calcAvailableCountFromWeight({
        totalCount: Number(row.rollCount || 0),
        issuedCount: issuedToConingRolls,
        dispatchedCount: dispatchedRolls,
        totalWeight: baseNetWeight,
        availableWeight,
      }) || 0;

      return {
        ...row,
        lotNo: lotLabel,
        lotNoRaw,
        lotNos,
        itemId: issue?.itemId || lotMeta?.itemId || '',
        itemName,
        firmId: lotMeta?.firmId || '',
        firmName,
        supplierId: lotMeta?.supplierId || '',
        supplierName,
        yarnId: issue?.yarnId || '',
        yarnName: yarn?.name || '—',
        twistName: twist?.name || '—',
        cutName: row.issue?.cut?.name || (issue?.id ? cutByIssueId.get(issue.id) : null) || '—',
        rollCount: Number(row.rollCount || 0),
        dispatchedRolls,
        availableRolls,
        rollWeight: Number(row.rollWeight || 0),
        netWeight: baseNetWeight,
        availableWeight,
        issuedToConingRolls,
        issuedToConingWeight,
        isSteamed: !!row.isSteamed,
        steamedAt: row.steamedAt || null,
      };
    });
  }, [db.receive_from_holo_machine_rows, holoIssueMap, lotMetaMap, db.items, db.yarns, db.twists, cutByIssueId, v2Lots]);

  // 4. Group by Lot
  const holoLots = useMemo(() => {
    if (Array.isArray(v2Lots)) {
      return v2Lots.map((lot) => {
        const lotNosArr = Array.isArray(lot.lotNos) ? lot.lotNos : [];
        const cutNamesArr = Array.isArray(lot.cutNames) ? lot.cutNames : [];
        const cutNamesSet = new Set(cutNamesArr.length ? cutNamesArr : [lot.cutName].filter(Boolean));
        return {
          ...lot,
          lotNos: lotNosArr,
          lotSearch: lotNosArr.join(' '),
          barcodeStr: '',
          barcodes: [],
          cutNames: cutNamesSet,
          rows: [], // expanded rows are fetched on-demand in v2 mode
        };
      });
    }
    const map = new Map();
    holoRows.forEach((row) => {
      const lotKey = [
        row.lotNo || '(No Lot)',
        row.itemId || '',
        row.yarnId || '',
        row.cutName || '',
        row.twistName || '',
        row.supplierId || ''
      ].join('::');
      const existing = map.get(lotKey) || {
        lotKey,
        lotNo: row.lotNo || '(No Lot)',
        twistKey: row.twistName || '—',
        itemId: row.itemId || '',
        firmId: row.firmId || '',
        supplierId: row.supplierId || '',
        yarnId: row.yarnId || '',
        itemName: row.itemName,
        firmName: row.firmName,
        supplierName: row.supplierName,
        yarnName: row.yarnName,
        twistName: row.twistName,
        cutNames: new Set(),
        totalRolls: 0,
        totalWeight: 0,
        steamedRolls: 0,
        steamedWeight: 0,
        lotNos: new Set(),
        rows: [],
        barcodes: [],
        notes: [],
      };

      existing.rows.push(row);
      existing.totalRolls += row.availableRolls;
      existing.totalWeight += row.availableWeight;
      existing.cutNames.add(row.cutName || '—');
      (row.lotNos || []).forEach(lot => existing.lotNos.add(lot));
      if (row.barcode) existing.barcodes.push(row.barcode);
      if (row.notes) existing.notes.push(row.notes);
      // Track steamed status
      if (row.isSteamed) {
        existing.steamedRolls += row.availableRolls;
        existing.steamedWeight += row.availableWeight;
      }
      map.set(lotKey, existing);
    });
    return Array.from(map.values()).map((lot) => {
      const cutName = lot.cutNames.size > 1 ? 'Mixed' : Array.from(lot.cutNames)[0] || '—';
      const lotNosArr = Array.from(lot.lotNos || []);
      const { lotNos, ...rest } = lot;
      // Determine steamed status type for filtering
      const steamedStatusType = rest.steamedRolls === 0 ? 'not_steamed'
        : rest.steamedRolls >= rest.totalRolls ? 'steamed'
          : 'partial';
      return {
        ...rest,
        lotKey: rest.lotKey || lot.lotKey,
        cutName,
        cutNames: lot.cutNames,
        lotNos: lotNosArr,
        lotSearch: lotNosArr.join(' '),
        barcodeStr: (lot.barcodes || []).join(' '),
        notesStr: (lot.notes || []).join(' '),
        statusType: rest.totalWeight > EPSILON ? 'active' : 'inactive',
        steamedStatusType,
        date: rest.rows?.[0]?.date || rest.rows?.[0]?.createdAt || '',
      };
    });
  }, [holoRows]);

  // Auto-expand on a single barcode hit (keeps barcode UX consistent without shipping all barcodes).
  useEffect(() => {
    if (!Array.isArray(v2Lots)) return;
    if (!barcodeHitKeys || typeof barcodeHitKeys.size !== 'number') return;
    if (barcodeHitKeys.size !== 1) return;
    const sourceKey = Array.from(barcodeHitKeys)[0];
    if (!sourceKey) return;
    const sourceIdentity = normalizeLotKeyIdentity(sourceKey);
    const resolvedKey = (sourceIdentity && v2LotKeyByIdentity.get(sourceIdentity)) || sourceKey;
    if (!resolvedKey) return;
    if (lastAutoExpandRef.current === resolvedKey) return;
    lastAutoExpandRef.current = resolvedKey;

    if (v2RowsByKey[resolvedKey]) {
      setExpandedLot(resolvedKey);
      return;
    }
    if (typeof v2LoadLotRows === 'function') {
      v2LoadLotRows(resolvedKey).then(() => setExpandedLot(resolvedKey)).catch(() => { });
    }
  }, [v2Lots, barcodeHitKeys, v2RowsByKey, v2LoadLotRows, v2LotKeyByIdentity]);

  // 5. Filter
  const filteredLots = useMemo(() => {
    let list = holoLots.map(l => {
      let score = 0;
      if (search) {
        const formattedDate = formatDateDDMMYYYY(l.date);
        const searchableFields = [
          'lotNo', 'lotSearch', 'itemName', 'cutName', 'yarnName', 'twistName', 'firmName', 'supplierName',
          'totalRolls', 'totalWeight', 'barcodeStr', 'notesStr'
        ];
        const tempItem = {
          ...l,
          dateStr: formattedDate,
          totalRolls: String(l.totalRolls || 0),
          totalWeight: String(l.totalWeight || 0)
        };
        score = calculateMultiTermScore(tempItem, search, [...searchableFields, 'dateStr']);
      } else {
        score = 1;
      }
      // Check for direct barcode or notes hit (v2 uses server lookup for barcodes; notes checked client-side).
      const searchLower = search ? search.trim().toLowerCase() : '';
      const hasBarcodeHit = Array.isArray(v2Lots)
        ? (
          (barcodeHitKeys ? barcodeHitKeys.has(l.lotKey) : false)
          || barcodeHitIdentitySet.has(normalizeLotKeyIdentity(l.lotKey))
        )
        : (searchLower.length >= 6 && (l.barcodes || []).some(b => String(b || '').toLowerCase().includes(searchLower)))
          || (searchLower.length >= 3 && (l.notes || []).some(n => String(n || '').toLowerCase().includes(searchLower)));
      return { ...l, searchScore: score, hasBarcodeHit };
    });

    if (search) {
      const minScore = search.trim().length >= 8 ? 40 : 1;
      list = list.filter(l => l.searchScore >= minScore || l.hasBarcodeHit);
    }

    return list.filter(l => {
      if (filters.item && String(l.itemId) !== String(filters.item)) return false;
      if (filters.cut) {
        const cutName = db?.cuts?.find(c => String(c.id) === String(filters.cut))?.name;
        if (cutName && !l.cutNames?.has(cutName)) return false;
      }
      if (filters.yarn && String(l.yarnId) !== String(filters.yarn)) return false;
      if (filters.firm && String(l.firmId) !== String(filters.firm)) return false;
      if (filters.supplier && String(l.supplierId) !== String(filters.supplier)) return false;
      if (filters.from && l.date < filters.from) return false;
      if (filters.to && l.date > filters.to) return false;
      if (filters.status !== 'all' && l.statusType !== filters.status) return false;
      // Steamed filter support
      if (filters.steamed && filters.steamed !== 'all') {
        if (filters.steamed === 'steamed' && l.steamedStatusType !== 'steamed') return false;
        if (filters.steamed === 'not_steamed' && l.steamedStatusType !== 'not_steamed') return false;
        if (filters.steamed === 'partial' && l.steamedStatusType !== 'partial') return false;
      }
      return true;
    }).sort((a, b) => {
      if (search && a.searchScore !== b.searchScore) {
        return b.searchScore - a.searchScore;
      }
      return (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true });
    });
  }, [holoLots, filters, search, db.cuts, v2Lots, barcodeHitKeys, barcodeHitIdentitySet]);


  const displayLots = useMemo(() => {
    if (!groupBy) return filteredLots;
    const map = new Map();
    filteredLots.forEach((lot) => {
      const key = buildGroupKey(lot);
      const existing = map.get(key) || {
        lotNo: '', // grouped rows show dash in lot column
        groupKey: key,
        itemId: lot.itemId,
        itemName: lot.itemName,
        firmId: lot.firmId,
        firmName: lot.firmName,
        supplierId: lot.supplierId,
        supplierName: lot.supplierName,
        yarnName: lot.yarnName,
        twistName: lot.twistName,
        cutNames: new Set(),
        totalRolls: 0,
        totalWeight: 0,
        rows: [],
        lots: [],
        statusType: lot.statusType,
      };
      existing.totalRolls += lot.totalRolls;
      existing.totalWeight += lot.totalWeight;
      existing.statusType = existing.totalWeight > EPSILON ? 'active' : 'inactive';
      existing.rows = []; // collapse detail when grouped
      existing.lots.push(lot.lotNo);
      existing.cutNames.add(lot.cutName || '—');
      map.set(key, existing);
    });
    return Array.from(map.values()).map((lot) => {
      const cutName = lot.cutNames.size > 1 ? 'Mixed' : Array.from(lot.cutNames)[0] || '—';
      const { cutNames, ...rest } = lot;
      return { ...rest, cutName };
    });
  }, [filteredLots, groupBy]);

  // Bubble up data for export (pass displayed data which respects groupBy)
  useEffect(() => {
    if (onDataChange) onDataChange(displayLots);
  }, [displayLots, onDataChange]);

  const tableColumnCount = groupBy ? 10 : 11;

  // Grand Totals
  const grandTotals = useMemo(() => {
    return displayLots.reduce((acc, lot) => ({
      totalRolls: acc.totalRolls + (lot.totalRolls || 0),
      totalWeight: acc.totalWeight + (lot.totalWeight || 0),
      steamedRolls: acc.steamedRolls + (lot.steamedRolls || 0),
    }), { totalRolls: 0, totalWeight: 0, steamedRolls: 0 });
  }, [displayLots]);

  const handleReprintRow = async (r) => {
    if (reprintingId) return;
    setReprintingId(r.id);
    try {
      const fullRow = db.receive_from_holo_machine_rows?.find(x => x.id === r.id) || r;
      const issue = db.issue_to_holo_machine?.find(i => i.id === (fullRow.issueId || fullRow.issue?.id));
      const item = db.items?.find(i => i.id === issue?.itemId);
      const rollType = db.rollTypes?.find(rt => rt.id === fullRow.rollTypeId) || fullRow.rollType;
      const box = db.boxes?.find(b => b.id === fullRow.boxId) || fullRow.box;
      const yarnName = db.yarns?.find(y => y.id === issue?.yarnId)?.name || '';
      const resolved = issue ? resolveHoloTrace(issue, traceContext) : { cutName: '—', twistName: '—' };
      const cut = resolved.cutName === '—' ? '' : resolved.cutName;
      const twistName = resolved.twistName === '—' ? '' : resolved.twistName;
      const boxWeight = Number(box?.weight || 0);
      const rollTypeWeight = Number(rollType?.weight || 0);
      const rollCount = Number(fullRow.rollCount || r.availableRolls || 1);
      const calculatedTare = boxWeight + (rollTypeWeight * rollCount);
      const tareWeight = Number.isFinite(fullRow.tareWeight) ? Number(fullRow.tareWeight) : calculatedTare;
      const lotLabel = issue?.lotLabel || issue?.lotNo || fullRow.issue?.lotNo || '';
      const grossWeight = fullRow.grossWeight ?? r.grossWeight ?? null;
      const netWeight = Number.isFinite(fullRow.rollWeight)
        ? Number(fullRow.rollWeight)
        : Number.isFinite(fullRow.netWeight)
          ? Number(fullRow.netWeight)
          : Number.isFinite(r.netWeight)
            ? Number(r.netWeight)
            : Number.isFinite(grossWeight)
              ? Math.max(0, Number(grossWeight) - tareWeight)
              : 0;
      const operatorName = fullRow.operator?.name
        || (issue?.operatorId ? db.operators?.find(o => o.id === issue.operatorId)?.name : '')
        || '';
      const machineName = fullRow.machineNo || r.machineNo
        || fullRow.machine?.name
        || (issue?.machineId ? db.machines?.find(m => m.id === issue.machineId)?.name : '')
        || '';
      const data = {
        lotNo: lotLabel,
        itemName: item?.name || '',
        rollCount,
        rollType: rollType?.name || r.rollTypeName || '',
        netWeight,
        grossWeight,
        tareWeight,
        boxName: box?.name || fullRow.box?.name || '',
        cut,
        yarnName,
        twist: twistName,
        machineName,
        operatorName,
        shift: issue?.shift || fullRow.shift || '',
        date: fullRow.date || r.date || fullRow.createdAt,
        barcode: fullRow.barcode || r.barcode,
      };
      const template = await loadTemplate(LABEL_STAGE_KEYS.HOLO_RECEIVE);
      if (!template) { alert('No sticker template found for Holo Receive. Configure it in Label Designer.'); return; }
      await printStageTemplate(LABEL_STAGE_KEYS.HOLO_RECEIVE, data, { template });
    } catch (err) {
      alert(err.message || 'Failed to reprint sticker');
    } finally {
      setReprintingId(null);
    }
  };

  return (
    <>
      <div className="hidden sm:block rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px]"></TableHead>
              <TableHead>Lot No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Cut</TableHead>
              <TableHead>Yarn / Twist</TableHead>
              {!groupBy ? <TableHead>Firm</TableHead> : null}
              <TableHead>Supplier</TableHead>
              <TableHead className="">Available Rolls</TableHead>
              <TableHead className="">Net Weight</TableHead>
              <TableHead className="">Steamed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayLots.length === 0 ? (
              <TableRow><TableCell colSpan={tableColumnCount} className="text-center py-4 text-muted-foreground">No holo stock found.</TableCell></TableRow>
            ) : (
              displayLots.map((l, idx) => {
                // Keys must be unique and stable. Using only lotNo/twistName collides when the same lot is present
                // with multiple yarns/cuts, which can cause stale rows to remain visible after filtering.
                const rowKey = groupBy ? (l.groupKey || idx) : (l.lotKey || idx);
                const hasBarcodeHit = !!l.hasBarcodeHit;
                const rowsForLot = Array.isArray(v2Lots) ? (v2RowsByKey[l.lotKey] || []) : (l.rows || []);
                const isExpanded = !groupBy && (
                  expandedLot === l.lotKey
                  || (hasBarcodeHit && (!Array.isArray(v2Lots) || rowsForLot.length > 0))
                );
                const expandedRows = rowsForLot.filter(hasActiveRollAvailability);
                return (
                  <React.Fragment key={rowKey}>
                    <TableRow
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        if (groupBy) return;
                        if (!Array.isArray(v2Lots)) {
                          setExpandedLot(isExpanded ? null : l.lotKey);
                          return;
                        }
                        if (isExpanded) {
                          setExpandedLot(null);
                          return;
                        }
                        if (v2RowsByKey[l.lotKey]) {
                          setExpandedLot(l.lotKey);
                          return;
                        }
                        if (typeof v2LoadLotRows === 'function') {
                          v2LoadLotRows(l.lotKey).then(() => setExpandedLot(l.lotKey)).catch(() => { });
                        }
                      }}
                    >
                      <TableCell>
                        {!groupBy && (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {groupBy ? (
                          <LotPopover lots={l.lots || []} onApplyFilter={onApplyFilter} />
                        ) : (
                          <HighlightMatch text={l.lotNo || '—'} query={search} />
                        )}
                      </TableCell>
                      <TableCell>{formatDateDDMMYYYY(l.date) || '—'}</TableCell>
                      <TableCell>
                        <HighlightMatch text={l.itemName} query={search} />
                      </TableCell>
                      <TableCell>
                        <HighlightMatch text={l.cutName || '—'} query={search} />
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <HighlightMatch text={l.yarnName} query={search} />
                          <span>/</span>
                          <HighlightMatch text={l.twistName} query={search} />
                        </div>
                      </TableCell>
                      {!groupBy ? (
                        <TableCell>
                          <HighlightMatch text={l.firmName} query={search} />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <HighlightMatch text={l.supplierName} query={search} />
                      </TableCell>
                      <TableCell className="">{l.totalRolls}</TableCell>
                      <TableCell className="">{formatKg(l.totalWeight)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            l.steamedStatusType === 'steamed' && "bg-green-500/10 text-green-600 border-green-500/50",
                            l.steamedStatusType === 'partial' && "bg-orange-500/10 text-orange-600 border-orange-500/50",
                            l.steamedStatusType === 'not_steamed' && "bg-gray-500/10 text-gray-500 border-gray-500/30"
                          )}
                        >
                          {l.steamedStatusType === 'steamed' && <Flame className="w-3 h-3 mr-1" />}
                          {l.steamedStatusType === 'partial' && <FlameKindling className="w-3 h-3 mr-1" />}
                          {l.steamedRolls} / {l.totalRolls}
                        </Badge>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/30">
                        <TableCell colSpan={10} className="p-4">
                          <div className="border rounded-md bg-background overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Barcode</TableHead>
                                  <TableHead>Date</TableHead>
                                  <TableHead>Roll Type</TableHead>
                                  <TableHead className="">Available Rolls</TableHead>
                                  <TableHead className="">Net Wt</TableHead>
                                  <TableHead className="">Gross Wt</TableHead>
                                  <TableHead>Machine</TableHead>
                                  <TableHead>Steamed</TableHead>
                                  <TableHead>Notes</TableHead>
                                  <TableHead className="w-8"></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {expandedRows.length === 0 ? (
                                  <TableRow>
                                    <TableCell colSpan={10} className="py-4 text-center text-muted-foreground">
                                      No active roll rows.
                                    </TableCell>
                                  </TableRow>
                                ) : expandedRows.map(r => {
                                  const rollMatch = search && (
                                    (search.trim().length >= 6 && String(r.barcode || '').toLowerCase().includes(search.trim().toLowerCase()))
                                    || (search.trim().length >= 3 && String(r.notes || '').toLowerCase().includes(search.trim().toLowerCase()))
                                  );
                                  return (
                                    <TableRow key={r.id} className={cn(r.isSteamed ? 'bg-green-500/5' : '', rollMatch && 'bg-primary/10')}>
                                      <TableCell className="font-mono text-xs"><HighlightMatch text={r.barcode || ''} query={search} /></TableCell>
                                      <TableCell>{formatDateDDMMYYYY(r.date)}</TableCell>
                                      <TableCell>{r.rollType?.name || r.rollTypeName || '—'}</TableCell>
                                      <TableCell className="">{r.availableRolls}</TableCell>
                                      <TableCell className="">{formatKg(r.availableWeight)}</TableCell>
                                      <TableCell className="">{formatKg(r.grossWeight)}</TableCell>
                                      <TableCell>{r.machineNo}</TableCell>
                                      <TableCell>
                                        {r.isSteamed ? (
                                          <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/50">
                                            <Flame className="w-3 h-3 mr-1" />
                                            Steamed
                                          </Badge>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground"><HighlightMatch text={r.notes || '—'} query={search} /></TableCell>
                                      <TableCell className="p-1">
                                        <button onClick={(e) => { e.stopPropagation(); handleReprintRow(r); }} disabled={reprintingId === r.id} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40" title="Reprint label">
                                          <Printer className="w-3.5 h-3.5" />
                                        </button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })
            )}
            {/* Grand Total Row */}
            {displayLots.length > 0 && (
              <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/20">
                <TableCell></TableCell>
                <TableCell className="font-bold text-primary">Grand Total</TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                {!groupBy ? <TableCell></TableCell> : null}
                <TableCell></TableCell>
                <TableCell className="font-bold text-primary">{grandTotals.totalRolls}</TableCell>
                <TableCell className="font-bold text-primary">{formatKg(grandTotals.totalWeight)}</TableCell>
                <TableCell className="font-bold text-primary">{grandTotals.steamedRolls} / {grandTotals.totalRolls}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile Card View for Holo Stock */}
      <div className="block sm:hidden space-y-3">
        {displayLots.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No holo stock found.</div>
        ) : (
          displayLots.map((l, idx) => {
            const rowKey = groupBy ? (l.groupKey || idx) : (l.lotKey || idx);
            const hasBarcodeHit = !!l.hasBarcodeHit;
            const rowsForLot = Array.isArray(v2Lots) ? (v2RowsByKey[l.lotKey] || []) : (l.rows || []);
            const isExpanded = !groupBy && (
              expandedLot === l.lotKey
              || (hasBarcodeHit && (!Array.isArray(v2Lots) || rowsForLot.length > 0))
            );
            const expandedRows = rowsForLot.filter(hasActiveRollAvailability);

            return (
              <div key={rowKey} className="border rounded-lg bg-card shadow-sm overflow-hidden text-sm">
                <div
                  className="p-4"
                  onClick={() => {
                    if (groupBy) return;
                    if (!Array.isArray(v2Lots)) {
                      setExpandedLot(isExpanded ? null : l.lotKey);
                      return;
                    }
                    if (isExpanded) {
                      setExpandedLot(null);
                      return;
                    }
                    if (v2RowsByKey[l.lotKey]) {
                      setExpandedLot(l.lotKey);
                      return;
                    }
                    if (typeof v2LoadLotRows === 'function') {
                      v2LoadLotRows(l.lotKey).then(() => setExpandedLot(l.lotKey)).catch(() => { });
                    }
                  }}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold flex items-center gap-2">
                        {groupBy ? (
                          <LotPopover lots={l.lots || []} onApplyFilter={onApplyFilter} />
                        ) : (
                          <HighlightMatch text={l.lotNo || '—'} query={search} />
                        )}
                        {!groupBy && (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
                      </div>
                      <p className="font-medium mt-1">
                        <HighlightMatch text={l.itemName} query={search} />
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDateDDMMYYYY(l.date) || '—'} • {l.cutName}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-semibold">{formatKg(l.totalWeight)}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{l.totalRolls} rolls</div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] mt-1",
                          l.steamedStatusType === 'steamed' && "bg-green-500/10 text-green-600 border-green-500/50",
                          l.steamedStatusType === 'partial' && "bg-orange-500/10 text-orange-600 border-orange-500/50",
                          l.steamedStatusType === 'not_steamed' && "bg-gray-500/10 text-gray-500 border-gray-500/30"
                        )}
                      >
                        {l.steamedStatusType === 'steamed' && <Flame className="w-3 h-3 mr-1" />}
                        {l.steamedRolls}/{l.totalRolls} steamed
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Twist: {l.twistName}</span>
                    <span>Supplier: <HighlightMatch text={l.supplierName} query={search} /></span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t bg-muted/30 p-3 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Roll Details</p>
                    {expandedRows.length === 0 ? (
                      <div className="text-xs text-muted-foreground">No active roll rows.</div>
                    ) : expandedRows.map(r => {
                      const rollMatch = search && (
                        (search.trim().length >= 6 && String(r.barcode || '').toLowerCase().includes(search.trim().toLowerCase()))
                        || (search.trim().length >= 3 && String(r.notes || '').toLowerCase().includes(search.trim().toLowerCase()))
                      );
                      return (
                        <div key={r.id} className={cn("bg-background border rounded p-2 space-y-1", r.isSteamed && "border-green-500/30", rollMatch && "bg-primary/10")}>
                          <div className="flex justify-between font-mono text-xs">
                            <span className="font-semibold text-primary"><HighlightMatch text={r.barcode} query={search} /></span>
                            <span className="flex items-center gap-1.5">
                              <span>{formatKg(r.availableWeight)}</span>
                              <button onClick={(e) => { e.stopPropagation(); handleReprintRow(r); }} disabled={reprintingId === r.id} className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40" title="Reprint label">
                                <Printer className="w-3 h-3" />
                              </button>
                            </span>
                          </div>
                          <div className="flex justify-between text-[11px] text-muted-foreground">
                            <span>{(r.rollType?.name || r.rollTypeName || '—')} • Rolls: {r.availableRolls}</span>
                            <span className="flex items-center gap-1">
                              {r.isSteamed && <Flame className="w-3 h-3 text-green-600" />}
                              Mac: {r.machineNo}
                            </span>
                          </div>
                          {r.notes && <div className="text-[11px] text-muted-foreground">Note: <HighlightMatch text={r.notes} query={search} /></div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
        {/* Mobile Grand Total Card */}
        {displayLots.length > 0 && (
          <div className="border-2 border-primary/30 rounded-lg bg-primary/5 p-4 mt-2">
            <div className="flex justify-between items-center">
              <span className="font-bold text-primary">Grand Total</span>
              <div className="text-right">
                <div className="font-mono font-bold text-primary">{formatKg(grandTotals.totalWeight)}</div>
                <div className="text-xs text-muted-foreground">{grandTotals.totalRolls} rolls • {grandTotals.steamedRolls} steamed</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
