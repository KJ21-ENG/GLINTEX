/**
 * IssueToMachine page component for GLINTEX Inventory
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Input, Select, Pill, Pagination } from '../components';
import { IssueHistory } from './IssueHistory';
import { formatKg, todayISO } from '../utils';
import { getProcessDefinition } from '../constants/processes';
import * as api from '../api';

const ensureArray = (value) => (Array.isArray(value) ? value : []);
const normalizeBarcode = (value = '') => String(value || '').trim().toUpperCase();
const safeNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

export function IssueToMachine({ db, onIssueToMachine, refreshing, refreshDb, process = 'cutter' }) {
  const { cls } = useBrand();
  const processDef = getProcessDefinition(process);
  const isCutter = process === 'cutter';
  const isHolo = process === 'holo';
  const isConing = process === 'coning';
  const issueList = ensureArray(db[processDef.issueKey]);
  const yarnMap = useMemo(() => {
    const map = new Map();
    (db.yarns || []).forEach((yarn) => {
      if (yarn?.id) map.set(yarn.id, yarn);
    });
    return map;
  }, [db.yarns]);
  const totalUnitsIssued = issueList.reduce((sum, issue) => {
    if (process === 'holo') return sum + Number(issue.metallicBobbins || 0);
    if (process === 'coning') return sum + Number(issue.rollsIssued || 0);
    return sum;
  }, 0);
  const [holoForm, setHoloForm] = useState({
    date: todayISO(),
    machineId: '',
    operatorId: '',
    yarnId: '',
    yarnKg: '',
    note: '',
  });
  const [coningForm, setConingForm] = useState({
    date: todayISO(),
    itemId: '',
    lotNo: '',
    machineId: '',
    operatorId: '',
    rollsIssued: '',
    note: '',
    receivedRowRefs: '',
  });
  const [holoSubmitting, setHoloSubmitting] = useState(false);
  const [coningSubmitting, setConingSubmitting] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [operatorId, setOperatorId] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState([]);
  const [issuing, setIssuing] = useState(false);
  const [piecePage, setPiecePage] = useState(1);
  const [barcodeScan, setBarcodeScan] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const piecePageSize = 50;
  const [holoCrates, setHoloCrates] = useState([]);
  const [holoScanInput, setHoloScanInput] = useState('');
  const [holoScanError, setHoloScanError] = useState('');

  useEffect(() => {
    if (db.items.length && !db.items.some(i => i.id === itemId)) {
      setItemId("");
    }
  }, [db.items, itemId]);

  useEffect(() => {
    if (db.machines.length && !db.machines.some(m => m.id === machineId)) {
      setMachineId("");
    }
  }, [db.machines, machineId]);

  useEffect(() => {
    if (db.operators.length && !db.operators.some(o => o.id === operatorId)) {
      setOperatorId("");
    }
  }, [db.operators, operatorId]);

  useEffect(() => {
    if (!isHolo) return;
    const yarns = Array.isArray(db.yarns) ? db.yarns : [];
    if (yarns.length === 0) {
      if (holoForm.yarnId) {
        setHoloForm(prev => ({ ...prev, yarnId: '' }));
      }
      return;
    }
    if (holoForm.yarnId && !yarns.some(y => y.id === holoForm.yarnId)) {
      setHoloForm(prev => ({ ...prev, yarnId: '' }));
    }
  }, [db.yarns, holoForm.yarnId, isHolo]);

  const candidateLots = useMemo(() => {
    const parse = (s) => (s && typeof s === 'string') ? s : '';
    return db.lots.filter(l => l.itemId === itemId).slice().sort((a, b) => {
      // prefer ISO dates if present on lot record, fall back to raw date
      const aDate = a.date || '';
      const bDate = b.date || '';
      // normalize to ISO using simple string patterns (YYYY-MM-DD > others)
      const aIso = a.date && a.date.match(/^\d{4}-\d{2}-\d{2}$/) ? a.date : parse(aDate);
      const bIso = b.date && b.date.match(/^\d{4}-\d{2}-\d{2}$/) ? b.date : parse(bDate);
      // localeCompare on ISO-like strings gives correct chronological ordering
      return (bIso || bDate).localeCompare(aIso || aDate);
    });
  }, [db.lots, itemId]);
  const [lotNo, setLotNo] = useState("");
  const [preserveSelectionOnLotChange, setPreserveSelectionOnLotChange] = useState(false);

  const setLotNoWithOptions = (nextLot, { preserveSelection = false } = {}) => {
    if (preserveSelection) {
      setPreserveSelectionOnLotChange(true);
    }
    setLotNo(nextLot);
  };

  useEffect(() => {
    // Do not auto-select first lot; leave user to choose from Select
    if (!candidateLots.some(l => l.lotNo === lotNo)) {
      setLotNoWithOptions("");
    }
  }, [candidateLots, lotNo]);

  useEffect(() => {
    if (preserveSelectionOnLotChange) {
      setPreserveSelectionOnLotChange(false);
      return;
    }
    setSelected([]);
  }, [lotNo, preserveSelectionOnLotChange]);

  const availablePieces = useMemo(() => db.inbound_items
    .filter(ii => ii.lotNo===lotNo && ii.itemId===itemId && ii.status==='available')
    .sort((a,b)=> a.seq - b.seq), [db.inbound_items, lotNo, itemId]);

  const lastIssueForLot = useMemo(() => {
    const rows = db.issue_to_cutter_machine.filter(record => record.lotNo === lotNo).sort((a,b)=> b.date.localeCompare(a.date));
    return rows[0] || null;
  }, [db.issue_to_cutter_machine, lotNo]);

  const inboundPieceMap = useMemo(() => {
    const map = new Map();
    db.inbound_items.forEach(piece => {
      if (piece?.id) map.set(piece.id, piece);
    });
    return map;
  }, [db.inbound_items]);

  const itemMap = useMemo(() => {
    const map = new Map();
    db.items.forEach(item => {
      if (item?.id) map.set(item.id, item);
    });
    return map;
  }, [db.items]);

  const receiveRowById = useMemo(() => {
    const map = new Map();
    db.receive_from_cutter_machine_rows.forEach(row => {
      if (row?.id) map.set(row.id, row);
    });
    return map;
  }, [db.receive_from_cutter_machine_rows]);

  const receiveRowByBarcode = useMemo(() => {
    const map = new Map();
    db.receive_from_cutter_machine_rows.forEach(row => {
      if (row?.barcode) {
        map.set(normalizeBarcode(row.barcode), row);
      }
    });
    return map;
  }, [db.receive_from_cutter_machine_rows]);
  const holoDerivedMeta = useMemo(() => {
    const lotSet = new Set();
    const itemSet = new Set();
    holoCrates.forEach(crate => {
      if (crate.lotNo) lotSet.add(crate.lotNo);
      if (crate.itemId) itemSet.add(crate.itemId);
    });
    return {
      lotNo: lotSet.size === 1 ? Array.from(lotSet)[0] : '',
      itemId: itemSet.size === 1 ? Array.from(itemSet)[0] : '',
      lotConflict: lotSet.size > 1,
      itemConflict: itemSet.size > 1,
    };
  }, [holoCrates]);

  const holoTotals = useMemo(() => {
    return holoCrates.reduce((acc, crate) => {
      acc.totalRolls += Number(crate.issuedBobbins || 0);
      acc.totalWeight += Number(crate.issuedBobbinWeight || 0);
      return acc;
    }, { totalRolls: 0, totalWeight: 0 });
  }, [holoCrates]);

  function toggle(id) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function selectAll() { setSelected(availablePieces.map(p=>p.id)); }
  function clearSel() { setSelected([]); }

  async function handleBarcodeSubmit(e) {
    e.preventDefault();
    const code = barcodeScan.trim();
    if (!code) return;
    setScanLoading(true);
    try {
      const piece = await api.getInboundByBarcode(code);
      if (!piece) throw new Error('Barcode not found');
      if (piece.status !== 'available') throw new Error('Piece is not available');
      if (itemId !== piece.itemId) setItemId(piece.itemId);
      if (lotNo !== piece.lotNo) setLotNoWithOptions(piece.lotNo, { preserveSelection: true });
      setSelected(prev => (prev.includes(piece.id) ? prev : [...prev, piece.id]));
      alert(`Scanned ${piece.id} and added to selection`);
    } catch (err) {
      alert(err.message || 'Failed to lookup barcode');
    } finally {
      setBarcodeScan('');
      setScanLoading(false);
    }
  }

  function addHoloCrateFromScan() {
    if (!isHolo) return;
    const normalized = normalizeBarcode(holoScanInput);
    if (!normalized) {
      setHoloScanError('Enter or scan a receive barcode');
      return;
    }
    const row = receiveRowByBarcode.get(normalized);
    if (!row) {
      setHoloScanError('Barcode not found in the latest receive rows. Refresh data and try again.');
      return;
    }
    if (holoCrates.some(crate => crate.rowId === row.id)) {
      setHoloScanError('Crate already added');
      return;
    }
    const piece = row.pieceId ? inboundPieceMap.get(row.pieceId) : null;
    if (!piece) {
      setHoloScanError('Crate is missing the linked inbound piece. Refresh and try again.');
      return;
    }
    const lotNo = piece.lotNo || row.lotNo || '';
    const itemIdForRow = piece.itemId || '';
    if (holoCrates.length > 0) {
      const referenceLot = holoDerivedMeta.lotNo || holoCrates[0].lotNo;
      const referenceItem = holoDerivedMeta.itemId || holoCrates[0].itemId;
      if (referenceLot && lotNo && referenceLot !== lotNo) {
        setHoloScanError('This crate belongs to a different lot. Issue lot-by-lot.');
        return;
      }
      if (referenceItem && itemIdForRow && referenceItem !== itemIdForRow) {
        setHoloScanError('This crate belongs to a different item.');
        return;
      }
    }
    const baseBobbins = Number(row.bobbinQuantity || 0);
    const previouslyIssued = Number(row.issuedBobbins || 0);
    const remainingBobbins = Number.isFinite(baseBobbins) ? Math.max(0, baseBobbins - previouslyIssued) : 0;
    const defaultBobbins = remainingBobbins > 0 ? remainingBobbins : (baseBobbins > 0 ? baseBobbins : '');
    const netWeightRaw = safeNumber(row.netWt ?? row.totalKg ?? row.yarnWt);
    const previouslyIssuedWeight = safeNumber(row.issuedBobbinWeight);
    const remainingWeight = Number.isFinite(netWeightRaw) ? Math.max(0, netWeightRaw - previouslyIssuedWeight) : 0;
    const perBobbinWeight = (() => {
      const referenceBobbins = remainingBobbins > 0 ? remainingBobbins : (Number.isFinite(baseBobbins) ? baseBobbins : 0);
      if (referenceBobbins <= 0) return 0;
      const referenceWeight = remainingWeight > 0 ? remainingWeight : (netWeightRaw > 0 ? netWeightRaw : 0);
      if (!Number.isFinite(referenceWeight) || referenceWeight <= 0) return 0;
      return referenceWeight / referenceBobbins;
    })();
    const defaultWeight = Number.isFinite(perBobbinWeight) && perBobbinWeight > 0
      ? Number((perBobbinWeight * (Number(defaultBobbins) || 0)).toFixed(3))
      : (remainingWeight > 0 ? remainingWeight : (netWeightRaw > 0 ? netWeightRaw : ''));
    const crate = {
      rowId: row.id,
      barcode: row.barcode || normalized,
      vchNo: row.vchNo || '',
      pieceId: row.pieceId,
      lotNo,
      itemId: itemIdForRow,
      bobbinQuantity: Number.isFinite(baseBobbins) ? baseBobbins : null,
      rowIssuedBobbins: Number.isFinite(previouslyIssued) ? previouslyIssued : 0,
      rowIssuedWeight: Number.isFinite(previouslyIssuedWeight) ? previouslyIssuedWeight : 0,
      availableBobbins: remainingBobbins,
      availableWeight: remainingWeight,
      perBobbinWeight,
      issuedBobbins: defaultBobbins,
      issuedBobbinWeight: defaultWeight,
      netWeight: netWeightRaw,
    };
    setHoloCrates(prev => [...prev, crate]);
    setHoloScanInput('');
    setHoloScanError('');
  }

  function removeHoloCrate(rowId) {
    setHoloCrates(prev => prev.filter(crate => crate.rowId !== rowId));
  }

  function updateHoloCrate(rowId, field, rawValue) {
    if (field !== 'issuedBobbins') return;
    setHoloCrates(prev => prev.map(crate => {
      if (crate.rowId !== rowId) return crate;
      if (rawValue === '') {
        return { ...crate, issuedBobbins: '', issuedBobbinWeight: '' };
      }
      const num = Number(rawValue);
      if (!Number.isFinite(num)) return crate;
      const maxValue = Number.isFinite(crate.availableBobbins) && crate.availableBobbins > 0
        ? crate.availableBobbins
        : num;
      const clamped = Math.max(0, Math.min(num, maxValue));
      const perBobbin = Number.isFinite(crate.perBobbinWeight) ? crate.perBobbinWeight : 0;
      const computedWeight = perBobbin > 0 ? Number((perBobbin * clamped).toFixed(3)) : (clamped && crate.netWeight && crate.bobbinQuantity ? Number(((crate.netWeight / crate.bobbinQuantity) * clamped).toFixed(3)) : 0);
      return {
        ...crate,
        issuedBobbins: clamped,
        issuedBobbinWeight: computedWeight,
      };
    }));
  }

  async function issue() {
    if (!date || !itemId || !lotNo || !machineId || !operatorId || selected.length===0) return;
    const availSet = new Set(availablePieces.map(p=>p.id));
    const chosen = selected.filter(id => availSet.has(id));
    if (chosen.length===0) { alert("Nothing to issue. Selected pieces are not available."); return; }
    setIssuing(true);
    try {
      const result = await onIssueToMachine({ date, itemId, lotNo, pieceIds: chosen, note, machineId, operatorId });
      const picked = availablePieces.filter(p=> chosen.includes(p.id));
      const totalWeight = picked.reduce((s,p)=>s+p.weight,0);
      const crateSummary = result?.issueToMachine?.barcode
        ? `\nIssue barcode: ${result.issueToMachine.barcode}\nPrint multiple stickers with this code.`
        : '';
      alert(`Issued ${chosen.length} pcs from Lot ${lotNo} (Total ${formatKg(totalWeight)} kg)${crateSummary}`);
     setSelected([]);
      setNote("");
    } catch (err) {
      alert(err.message || 'Failed to issue pieces');
    } finally {
      setIssuing(false);
    }
  }

  useEffect(() => {
    if (!isHolo) return;
    setHoloForm(f => ({
      ...f,
      date: todayISO(),
      machineId: '',
      operatorId: '',
      yarnKg: '',
      note: '',
    }));
    setHoloCrates([]);
    setHoloScanInput('');
    setHoloScanError('');
  }, [isHolo]);

  useEffect(() => {
    if (!isConing) return;
    setConingForm(f => ({
      ...f,
      date: todayISO(),
      itemId: f.itemId || db.items[0]?.id || '',
      lotNo: '',
      machineId: '',
      operatorId: '',
      rollsIssued: '',
      note: '',
      receivedRowRefs: '',
    }));
  }, [isConing, db.items]);

  async function handleHoloSubmit(e) {
    e.preventDefault();
    if (!holoForm.date) {
      window.alert('Select a date');
      return;
    }
    if (!holoForm.operatorId) {
      window.alert('Select an operator');
      return;
    }
    if (!holoForm.machineId) {
      window.alert('Select a machine');
      return;
    }
    if (!holoForm.yarnId) {
      window.alert('Select a yarn quality');
      return;
    }
    if (holoCrates.length === 0) {
      window.alert('Scan at least one crate');
      return;
    }
    if (holoDerivedMeta.lotConflict || holoDerivedMeta.itemConflict) {
      window.alert('Remove crates from other lots/items before issuing.');
      return;
    }
    if (!holoDerivedMeta.lotNo || !holoDerivedMeta.itemId) {
      window.alert('Crate metadata missing lot or item information. Refresh data and retry.');
      return;
    }
    if (holoCrates.some(crate => Number(crate.issuedBobbins || 0) <= 0)) {
      window.alert('Enter bobbin quantity for every scanned crate');
      return;
    }
    if (holoTotals.totalRolls <= 0) {
      window.alert('Total bobbins must be greater than zero');
      return;
    }
    setHoloSubmitting(true);
    try {
      await api.createIssueToHoloMachine({
        date: holoForm.date,
        itemId: holoDerivedMeta.itemId,
        lotNo: holoDerivedMeta.lotNo,
        machineId: holoForm.machineId || null,
        operatorId: holoForm.operatorId || null,
        yarnId: holoForm.yarnId || null,
        metallicBobbins: holoTotals.totalRolls,
        metallicBobbinsWeight: holoTotals.totalWeight,
        yarnKg: holoForm.yarnKg ? Number(holoForm.yarnKg) : holoTotals.totalWeight,
        note: holoForm.note || null,
        crates: holoCrates.map(crate => ({
          rowId: crate.rowId,
          issuedBobbins: Number(crate.issuedBobbins || 0),
          issuedBobbinWeight: Number(crate.issuedBobbinWeight || 0),
        })),
      });
      window.alert('Issued to Holo machine');
      await refreshDb();
      setHoloForm(f => ({
        ...f,
        date: todayISO(),
        machineId: '',
        operatorId: '',
        yarnKg: '',
        note: '',
      }));
      setHoloCrates([]);
      setHoloScanInput('');
      setHoloScanError('');
    } catch (err) {
      console.error('Failed to issue to holo', err);
      window.alert(err.message || 'Failed to issue to Holo machine');
    } finally {
      setHoloSubmitting(false);
    }
  }

  async function handleConingSubmit(e) {
    e.preventDefault();
    if (!coningForm.date || !coningForm.itemId || !coningForm.lotNo) {
      window.alert('Date, item, and lot are required');
      return;
    }
    if (!coningForm.rollsIssued) {
      window.alert('Rolls issued count is required');
      return;
    }
    setConingSubmitting(true);
    try {
      await api.createIssueToConingMachine({
        date: coningForm.date,
        itemId: coningForm.itemId,
        lotNo: coningForm.lotNo,
        machineId: coningForm.machineId || null,
        operatorId: coningForm.operatorId || null,
        rollsIssued: Number(coningForm.rollsIssued),
        note: coningForm.note || null,
        receivedRowRefs: coningForm.receivedRowRefs.split(',').map(s => s.trim()).filter(Boolean),
      });
      window.alert('Issued to Coning machine');
      await refreshDb();
      setConingForm(f => ({
        ...f,
        date: todayISO(),
        lotNo: '',
        machineId: '',
        operatorId: '',
        rollsIssued: '',
        note: '',
        receivedRowRefs: '',
      }));
    } catch (err) {
      console.error('Failed to issue to coning', err);
      window.alert(err.message || 'Failed to issue to Coning machine');
    } finally {
      setConingSubmitting(false);
    }
  }

  if (!isCutter) {
    if (isHolo) {
      const yarns = Array.isArray(db.yarns) ? db.yarns : [];
      const disableIssue = holoSubmitting || refreshing || yarns.length === 0;
      return (
        <div className="space-y-6">
          <Section title="Issue to Holo (Rolls)">
            <form className="space-y-6" onSubmit={handleHoloSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={`text-xs ${cls.muted}`}>Date</label>
                  <Input type="date" value={holoForm.date} onChange={(e) => setHoloForm(prev => ({ ...prev, date: e.target.value }))} />
                </div>
                <div>
                  <label className={`text-xs ${cls.muted}`}>Operator</label>
                  <Select value={holoForm.operatorId} onChange={(e) => setHoloForm(prev => ({ ...prev, operatorId: e.target.value }))}>
                    <option value="">Select</option>
                    {db.operators.map(operator => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
                  </Select>
                </div>
                <div>
                  <label className={`text-xs ${cls.muted}`}>Machine</label>
                  <Select value={holoForm.machineId} onChange={(e) => setHoloForm(prev => ({ ...prev, machineId: e.target.value }))}>
                    <option value="">Select</option>
                    {db.machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={`text-xs ${cls.muted}`}>Yarn</label>
                  <Select value={holoForm.yarnId} onChange={(e) => setHoloForm(prev => ({ ...prev, yarnId: e.target.value }))}>
                    <option value="">Select</option>
                    {yarns.map(yarn => <option key={yarn.id} value={yarn.id}>{yarn.name}</option>)}
                  </Select>
                  {yarns.length === 0 && <p className="text-xs text-red-500 mt-1">Add yarns in Masters first.</p>}
                </div>
                <div>
                  <label className={`text-xs ${cls.muted}`}>Yarn wt. (kg)</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={holoForm.yarnKg}
                    onChange={(e) => setHoloForm(prev => ({ ...prev, yarnKg: e.target.value }))}
                    placeholder="Total yarn weight"
                    className="h-11"
                  />
                </div>
                <div>
                  <label className={`text-xs ${cls.muted}`}>Note</label>
                  <Input value={holoForm.note} onChange={(e) => setHoloForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Reference / reason" />
                </div>
              </div>

              <div className={`p-4 rounded-2xl border ${cls.cardBorder} ${cls.cardBg}`}>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium">Scan receive crates</div>
                    <p className={`text-xs ${cls.muted}`}>Scan the barcode from Receive-from-cutter rows, then adjust bobbin quantity per crate.</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Pill>Crates: {holoCrates.length}</Pill>
                    <Pill>Bobbins: {holoTotals.totalRolls}</Pill>
                    <Pill>Weight: {formatKg(holoTotals.totalWeight)} kg</Pill>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                  <div className="md:col-span-2">
                    <label className={`text-xs ${cls.muted}`}>Receive barcode</label>
                    <Input
                      value={holoScanInput}
                      onChange={(e) => { setHoloScanInput(e.target.value); if (holoScanError) setHoloScanError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHoloCrateFromScan(); } }}
                      placeholder="Scan or type REC barcode"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button type="button" onClick={addHoloCrateFromScan} disabled={!holoScanInput.trim()}>Add crate</Button>
                  </div>
                </div>
                {holoScanError && <div className="text-xs text-red-500 mt-2">{holoScanError}</div>}

                <div className="mt-4 overflow-x-auto">
                  {holoCrates.length === 0 ? (
                    <div className={`text-sm ${cls.muted}`}>No crates linked yet. Scan a barcode to begin.</div>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className={`text-left ${cls.muted}`}>
                        <tr>
                          <th className="py-2 pr-2">Crate</th>
                          <th className="py-2 pr-2">Piece / Lot</th>
                          <th className="py-2 pr-2">Available</th>
                          <th className="py-2 pr-2">Issue bobbins</th>
                          <th className="py-2 pr-2">Issue wt. (kg)</th>
                          <th className="py-2 pr-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holoCrates.map((crate) => (
                          <tr key={crate.rowId} className={`border-t ${cls.rowBorder}`}>
                            <td className="py-2 pr-2">
                              <div className="font-mono text-xs">{crate.vchNo || crate.rowId}</div>
                              <div className={`text-xs ${cls.muted}`}>{crate.barcode || '—'}</div>
                            </td>
                            <td className="py-2 pr-2 text-xs">
                              <div>Piece: <span className="font-mono">{crate.pieceId || '—'}</span></div>
                              <div>Lot: {crate.lotNo || '—'}</div>
                            </td>
                            <td className="py-2 pr-2 text-xs">
                              <div>Bobbins: {crate.availableBobbins ?? '—'} / {crate.bobbinQuantity ?? '—'}</div>
                              <div className={`${cls.muted}`}>Issued so far: {crate.rowIssuedBobbins || 0}</div>
                              <div className={`${cls.muted}`}>Issued wt: {formatKg(crate.rowIssuedWeight)} kg</div>
                              <div className={`${cls.muted}`}>Remaining wt: {formatKg(crate.availableWeight)} kg</div>
                            </td>
                            <td className="py-2 pr-2">
                              <Input type="number" min="0" step="1" value={crate.issuedBobbins} onChange={(e) => updateHoloCrate(crate.rowId, 'issuedBobbins', e.target.value)} />
                            </td>
                            <td className="py-2 pr-2 align-top">
                              <div className="font-mono text-sm">{formatKg(crate.issuedBobbinWeight)} kg</div>
                              <div className={`text-xs ${cls.muted}`}>Auto = avg × bobbins</div>
                              <div className={`text-xs ${cls.muted}`}>Net: {formatKg(crate.netWeight)} kg</div>
                            </td>
                            <td className="py-2 pr-2 text-right">
                              <button type="button" className="text-xs text-red-500 underline" onClick={() => removeHoloCrate(crate.rowId)}>Remove</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {(holoDerivedMeta.lotConflict || holoDerivedMeta.itemConflict) && (
                <div className="text-xs text-red-500">Crates must belong to a single lot and item.</div>
              )}

              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm">
                  <div>Lot: {holoDerivedMeta.lotNo || '—'}</div>
                  <div className={`${cls.muted}`}>Item ID: {holoDerivedMeta.itemId || '—'}</div>
                </div>
                <Button type="submit" disabled={disableIssue}>{holoSubmitting ? 'Issuing…' : 'Record issue'}</Button>
              </div>
            </form>
          </Section>

          <Section title="Issue history (Holo)">
            <div className="overflow-x-auto mt-4">
              <table className="min-w-full text-sm">
                <thead className={`text-left ${cls.muted}`}>
                  <tr>
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Lot</th>
                    <th className="py-2 pr-2">Yarn</th>
                    <th className="py-2 pr-2 text-right">Rolls</th>
                    <th className="py-2 pr-2 text-right">Issue wt. (kg)</th>
                    <th className="py-2 pr-2 text-right">Yarn (kg)</th>
                    <th className="py-2 pr-2">Barcode</th>
                    <th className="py-2 pr-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {issueList.length === 0 ? (
                    <tr>
                      <td className="py-3 pr-2" colSpan={8}>No issue records yet.</td>
                    </tr>
                  ) : (
                    issueList.map((issue) => (
                      <tr key={issue.id} className={`border-t ${cls.rowBorder}`}>
                        <td className="py-2 pr-2">{issue.date || '—'}</td>
                        <td className="py-2 pr-2">{issue.lotNo}</td>
                        <td className="py-2 pr-2">{issue.yarnId ? (yarnMap.get(issue.yarnId)?.name || issue.yarnId) : '—'}</td>
                        <td className="py-2 pr-2 text-right">{issue.metallicBobbins || 0}</td>
                        <td className="py-2 pr-2 text-right">{issue.metallicBobbinsWeight == null ? '—' : formatKg(issue.metallicBobbinsWeight)}</td>
                        <td className="py-2 pr-2 text-right">{issue.yarnKg == null ? '—' : issue.yarnKg}</td>
                        <td className="py-2 pr-2">{issue.barcode || '—'}</td>
                        <td className="py-2 pr-2">{issue.note || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      );
    }

    const unitLabel = 'Rolls issued';
    return (
      <div className="space-y-6">
        <Section title={`Issue to ${processDef.label}`}>
          <form className="space-y-4" onSubmit={handleConingSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={`text-xs ${cls.muted}`}>Date</label>
                <Input type="date" value={coningForm.date} onChange={(e) => setConingForm(prev => ({ ...prev, date: e.target.value }))} />
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>Item</label>
                <Select value={coningForm.itemId} onChange={(e) => setConingForm(prev => ({ ...prev, itemId: e.target.value }))}>
                  <option value="">Select</option>
                  {db.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>Lot</label>
                <Input value={coningForm.lotNo} onChange={(e) => setConingForm(prev => ({ ...prev, lotNo: e.target.value }))} placeholder="Lot number" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={`text-xs ${cls.muted}`}>Machine</label>
                <Select value={coningForm.machineId} onChange={(e) => setConingForm(prev => ({ ...prev, machineId: e.target.value }))}>
                  <option value="">Select</option>
                  {db.machines.map(machine => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
                </Select>
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>Operator</label>
                <Select value={coningForm.operatorId} onChange={(e) => setConingForm(prev => ({ ...prev, operatorId: e.target.value }))}>
                  <option value="">Select</option>
                  {db.operators.map(operator => <option key={operator.id} value={operator.id}>{operator.name}</option>)}
                </Select>
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>{unitLabel}</label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={coningForm.rollsIssued}
                  onChange={(e) => setConingForm(prev => ({ ...prev, rollsIssued: e.target.value }))}
                  placeholder={`Enter ${unitLabel.toLowerCase()}`}
                />
              </div>
            </div>

            <div>
              <label className={`text-xs ${cls.muted}`}>Received row refs (optional)</label>
              <Input value={coningForm.receivedRowRefs} onChange={(e) => setConingForm(prev => ({ ...prev, receivedRowRefs: e.target.value }))} placeholder="comma separated receive row IDs" />
            </div>

            <div>
              <label className={`text-xs ${cls.muted}`}>Note</label>
              <Input value={coningForm.note} onChange={(e) => setConingForm(prev => ({ ...prev, note: e.target.value }))} placeholder="Reference / reason" />
            </div>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={coningSubmitting}>{coningSubmitting ? 'Issuing…' : 'Record issue'}</Button>
              <Pill>{unitLabel}: {totalUnitsIssued}</Pill>
            </div>
          </form>
        </Section>

        <Section title={`Issue history (${processDef.label})`}>
          <div className="overflow-x-auto mt-4">
            <table className="min-w-full text-sm">
              <thead className={`text-left ${cls.muted}`}>
                <tr>
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Lot</th>
                  <th className="py-2 pr-2 text-right">{unitLabel}</th>
                  <th className="py-2 pr-2">Barcode</th>
                  <th className="py-2 pr-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {issueList.length === 0 ? (
                  <tr>
                    <td className="py-3 pr-2" colSpan={5}>No issue records yet.</td>
                  </tr>
                ) : (
                  issueList.map((issue) => (
                    <tr key={issue.id} className={`border-t ${cls.rowBorder}`}>
                      <td className="py-2 pr-2">{issue.date || '—'}</td>
                      <td className="py-2 pr-2">{issue.lotNo}</td>
                      <td className="py-2 pr-2 text-right">{issue.rollsIssued || 0}</td>
                      <td className="py-2 pr-2">{issue.barcode || '—'}</td>
                      <td className="py-2 pr-2">{issue.note || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Section title="Issue to machine">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          <div><label className={`text-xs ${cls.muted}`}>Date</label><Input type="date" value={date} onChange={e=>setDate(e.target.value)} /></div>
          <div><label className={`text-xs ${cls.muted}`}>Item</label><Select value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">Select</option>{db.items.length===0? <option>No items</option> : db.items.map(i=> <option key={i.id} value={i.id}>{i.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Lot</label><Select value={lotNo} onChange={e=>setLotNoWithOptions(e.target.value)}><option value="">Select</option>{candidateLots.length===0? <option>No lots</option> : candidateLots.map(l=> <option key={l.lotNo} value={l.lotNo}>{l.lotNo}</option>)}</Select></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 mt-3">
          <div><label className={`text-xs ${cls.muted}`}>Machine</label><Select value={machineId} onChange={e=>setMachineId(e.target.value)}><option value="">Select</option>{db.machines.length===0? <option>No machines</option> : db.machines.map(m=> <option key={m.id} value={m.id}>{m.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Operator</label><Select value={operatorId} onChange={e=>setOperatorId(e.target.value)}><option value="">Select</option>{db.operators.length===0? <option>No operators</option> : db.operators.map(o=> <option key={o.id} value={o.id}>{o.name}</option>)}</Select></div>
          <div><label className={`text-xs ${cls.muted}`}>Note (optional)</label><Input value={note} onChange={e=>setNote(e.target.value)} placeholder="Reference / reason" /></div>
        </div>

        <form onSubmit={handleBarcodeSubmit} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
          <div className="md:col-span-2">
            <label className={`text-xs ${cls.muted}`}>Scan roll barcode</label>
            <Input value={barcodeScan} onChange={e=>setBarcodeScan(e.target.value)} placeholder="Scan or type barcode" disabled={scanLoading} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={scanLoading || !barcodeScan.trim()}>{scanLoading ? 'Scanning…' : 'Apply'}</Button>
          </div>
        </form>

        <div className="mt-4 flex items-center gap-2">
          <Pill>Available: {availablePieces.length} pcs</Pill>
          <Pill>Selected: {selected.length} pcs</Pill>
          <SecondaryButton onClick={selectAll} disabled={availablePieces.length===0}>Select all</SecondaryButton>
          <SecondaryButton onClick={clearSel} disabled={selected.length===0}>Clear</SecondaryButton>
          <Button onClick={issue} disabled={selected.length===0 || refreshing || issuing} className="ml-auto">{issuing ? 'Issuing…' : 'Issue'}</Button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Select</th><th className="py-2 pr-2">Piece ID</th><th className="py-2 pr-2">Barcode</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
              <tbody>
                {availablePieces.length===0? <tr><td colSpan={4} className="py-4">No available pieces in this lot.</td></tr> : availablePieces.slice((piecePage-1)*piecePageSize, (piecePage-1)*piecePageSize + piecePageSize).map(p=> (
                  <tr key={p.id} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2"><input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)} /></td>
                    <td className="py-2 pr-2 font-mono">{p.id}</td>
                    <td className="py-2 pr-2">
                      {p.barcode ? (
                        <a href={api.barcodeImageUrl(p.barcode)} target="_blank" rel="noreferrer" className="underline text-xs">{p.barcode}</a>
                      ) : '—'}
                    </td>
                    <td className="py-2 pr-2 text-right">{formatKg(p.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2">
              <Pagination total={availablePieces.length} page={piecePage} setPage={setPiecePage} pageSize={piecePageSize} />
            </div>
          </div>

          <div className={`p-3 rounded-xl border ${cls.cardBorder} ${cls.cardBg}`}>
            <div className={`mb-2 font-medium`}>Last issued in this lot</div>
            {!lastIssueForLot? (
              <div className={`text-sm ${cls.muted}`}>No past issues for this lot.</div>
            ) : (
              <div className="text-sm">
                <div className={`${cls.muted} mb-1`}>{lastIssueForLot.date} · {lastIssueForLot.count} pcs · {formatKg(lastIssueForLot.totalWeight)} kg</div>
                <div className="flex flex-wrap gap-1">
                  {lastIssueForLot.pieceIds.map(id => <span key={id} className={`px-2 py-0.5 rounded-md text-xs border ${cls.pill} font-mono`}>{id}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="Issue History"><IssueHistory db={db} refreshDb={refreshDb} /></Section>
    </div>
  );
}
