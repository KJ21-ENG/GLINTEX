import React, { useEffect, useMemo, useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import * as api from '../api';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui';
import { formatKg, todayISO, uid } from '../utils';
import { LABEL_STAGE_KEYS, loadTemplate, printStageTemplate, makeReceiveBarcode, makeHoloReceiveBarcode, makeConingReceiveBarcode } from '../utils/labelPrint';
import { Plus, Save, Trash2 } from 'lucide-react';
import { CatchWeightButton } from '../components/common/CatchWeightButton';

const STAGE_OPTIONS = [
  { id: 'inbound', label: 'Inbound (Raw rolls)' },
  { id: 'cutter', label: 'Cutter Receive (Bobbins)' },
  { id: 'holo', label: 'Holo Receive (Rolls)' },
  { id: 'coning', label: 'Coning Receive (Cones)' },
];
const SHIFT_OPTIONS = [
  { value: 'Day', label: 'Day' },
  { value: 'Night', label: 'Night' },
];

const filterByProcess = (list = [], processKey) => {
  return list.filter(item => !item?.processType || item.processType === 'all' || item.processType === processKey);
};

const round3 = (val) => {
  const num = Number(val);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000) / 1000;
};

export function OpeningStock() {
  const { db, refreshDb } = useInventory();
  const [stage, setStage] = useState('inbound');
  const [date, setDate] = useState(todayISO());
  const [itemId, setItemId] = useState('');
  const [firmId, setFirmId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [previewLotNo, setPreviewLotNo] = useState('');
  const [saving, setSaving] = useState(false);

  const [inboundEntry, setInboundEntry] = useState({
    weight: '',
    isConsumed: false,
    consumptionDate: todayISO(),
  });
  const [inboundCart, setInboundCart] = useState([]);

  const [cutterEntry, setCutterEntry] = useState({
    bobbinId: '',
    bobbinQuantity: '',
    boxId: '',
    grossWeight: '',
    operatorId: '',
    helperId: '',
    cutId: '',
    shift: '',
    machineId: '',
  });
  const [cutterCart, setCutterCart] = useState([]);

  const [holoEntry, setHoloEntry] = useState({
    rollTypeId: '',
    rollCount: '',
    boxId: '',
    grossWeight: '',
  });
  const [holoCart, setHoloCart] = useState([]);
  const [holoIssue, setHoloIssue] = useState({
    twistId: '',
    yarnId: '',
    machineId: '',
    operatorId: '',
    shift: '',
  });

  const [coningEntry, setConingEntry] = useState({
    coneCount: '',
    grossWeight: '',
    boxId: '',
  });
  const [coningCart, setConingCart] = useState([]);
  const [coningIssue, setConingIssue] = useState({
    coneTypeId: '',
    wrapperId: '',
    machineId: '',
    operatorId: '',
    shift: '',
  });

  const fetchOpeningPreview = async () => {
    try {
      const res = await api.getOpeningLotSequenceNext();
      setPreviewLotNo(res?.next || '');
    } catch (e) {
      console.error('Failed to fetch opening sequence', e);
      setPreviewLotNo('');
    }
  };

  useEffect(() => {
    fetchOpeningPreview();
  }, []);

  useEffect(() => {
    setCutterCart([]);
    setHoloCart([]);
    setConingCart([]);
    setInboundCart([]);
  }, [itemId, firmId, supplierId, date]);

  const itemName = useMemo(() => db.items?.find(i => i.id === itemId)?.name || '', [db.items, itemId]);

  const getBobbin = (id) => db.bobbins?.find(b => b.id === id);
  const getBox = (id) => db.boxes?.find(b => b.id === id);
  const getCut = (id) => db.cuts?.find(c => c.id === id);
  const getOperator = (id) => db.operators?.find(o => o.id === id);
  const getHelper = (id) => db.helpers?.find(h => h.id === id);
  const getRollType = (id) => db.rollTypes?.find(r => r.id === id);
  const getConeType = (id) => db.cone_types?.find(c => c.id === id);
  const getWrapper = (id) => db.wrappers?.find(w => w.id === id);
  const getMachine = (id) => db.machines?.find(m => m.id === id);

  const calcCutterWeights = (entry) => {
    const bobbin = getBobbin(entry.bobbinId);
    const box = getBox(entry.boxId);
    const bobbinQty = Number(entry.bobbinQuantity || 0);
    const gross = Number(entry.grossWeight || 0);
    const bobbinWeight = Number(bobbin?.weight || 0);
    const boxWeight = Number(box?.weight || 0);
    const tare = bobbinWeight * bobbinQty + boxWeight;
    const net = round3(gross - tare);
    return { net, tare };
  };

  const calcHoloWeights = (entry) => {
    const rollType = getRollType(entry.rollTypeId);
    const box = getBox(entry.boxId);
    const rollCount = Number(entry.rollCount || 0);
    const gross = Number(entry.grossWeight || 0);
    const rollWeight = Number(rollType?.weight || 0);
    const boxWeight = Number(box?.weight || 0);
    const tare = rollWeight * rollCount + boxWeight;
    const net = round3(gross - tare);
    return { net, tare };
  };

  const calcConingWeights = (entry) => {
    const coneType = getConeType(coningIssue.coneTypeId);
    const box = getBox(entry.boxId);
    const coneCount = Number(entry.coneCount || 0);
    const gross = Number(entry.grossWeight || 0);
    const coneWeight = Number(coneType?.weight || 0);
    const boxWeight = Number(box?.weight || 0);
    const tare = coneWeight * coneCount + boxWeight;
    const net = round3(gross - tare);
    return { net, tare };
  };

  const cutterTotals = useMemo(() => {
    return cutterCart.reduce((acc, row) => {
      acc.totalNet += Number(row.netWeight || 0);
      acc.totalBobbins += Number(row.bobbinQuantity || 0);
      return acc;
    }, { totalNet: 0, totalBobbins: 0 });
  }, [cutterCart]);

  const holoTotals = useMemo(() => {
    return holoCart.reduce((acc, row) => {
      acc.totalNet += Number(row.netWeight || 0);
      acc.totalRolls += Number(row.rollCount || 0);
      return acc;
    }, { totalNet: 0, totalRolls: 0 });
  }, [holoCart]);

  const coningTotals = useMemo(() => {
    return coningCart.reduce((acc, row) => {
      acc.totalNet += Number(row.netWeight || 0);
      acc.totalCones += Number(row.coneCount || 0);
      return acc;
    }, { totalNet: 0, totalCones: 0 });
  }, [coningCart]);

  const inboundTotals = useMemo(() => {
    return inboundCart.reduce((acc, row) => {
      acc.totalWeight += Number(row.weight || 0);
      if (row.isConsumed) acc.totalConsumed += 1;
      else acc.totalAvailable += 1;
      return acc;
    }, { totalWeight: 0, totalConsumed: 0, totalAvailable: 0 });
  }, [inboundCart]);

  const canSaveCommon = date && itemId && supplierId;

  const addInboundPiece = () => {
    const w = Number(inboundEntry.weight || 0);
    if (w <= 0) return;
    setInboundCart(prev => [
      ...prev,
      {
        id: uid('piece'),
        ...inboundEntry,
        weight: w,
      }
    ]);
    setInboundEntry(prev => ({
      ...prev,
      weight: '',
    }));
  };

  const addCutterCrate = async () => {
    if (!cutterEntry.cutId) {
      alert('Cut is required.');
      return;
    }
    if (!cutterEntry.bobbinId || !cutterEntry.boxId) return;
    const bobbin = getBobbin(cutterEntry.bobbinId);
    const box = getBox(cutterEntry.boxId);
    if (!Number(bobbin?.weight) || !Number(box?.weight)) {
      alert('Bobbin/box weight missing. Update masters first.');
      return;
    }
    const bobbinQty = Number(cutterEntry.bobbinQuantity || 0);
    const gross = Number(cutterEntry.grossWeight || 0);
    if (!bobbinQty || !gross) return;
    const { net, tare } = calcCutterWeights(cutterEntry);
    if (net <= 0) {
      alert('Net weight must be positive.');
      return;
    }

    // Generate barcode for immediate printing using preview lot
    const crateIndex = cutterCart.length + 1;
    const barcode = makeReceiveBarcode({ lotNo: previewLotNo || 'OP-XXX', seq: 1, crateIndex });

    const newCrate = {
      id: uid('crate'),
      ...cutterEntry,
      bobbinQuantity: bobbinQty,
      grossWeight: gross,
      netWeight: net,
      tareWeight: tare,
      barcode,
    };

    setCutterCart(prev => [...prev, newCrate]);

    // Immediate sticker printing
    const template = await loadTemplate(LABEL_STAGE_KEYS.CUTTER_RECEIVE);
    if (template) {
      const confirmPrint = window.confirm('Print sticker for this crate?');
      if (confirmPrint) {
        const cutName = cutterEntry.cutId ? getCut(cutterEntry.cutId)?.name || '' : '';
        const operatorName = cutterEntry.operatorId ? getOperator(cutterEntry.operatorId)?.name || '' : '';
        const helperName = cutterEntry.helperId ? getHelper(cutterEntry.helperId)?.name || '' : '';
        const machineName = cutterEntry.machineId ? getMachine(cutterEntry.machineId)?.name || '' : '';
        await printStageTemplate(
          LABEL_STAGE_KEYS.CUTTER_RECEIVE,
          {
            lotNo: previewLotNo || 'OP-XXX',
            itemName,
            pieceId: `${previewLotNo || 'OP-XXX'}-1`,
            barcode,
            netWeight: net,
            grossWeight: gross,
            tareWeight: tare,
            bobbinQty,
            bobbinName: bobbin?.name,
            boxName: box?.name,
            cutName,
            machineName,
            helperName,
            operatorName,
            date,
          },
          { template },
        );
      }
    }

    setCutterEntry(prev => ({
      ...prev,
      bobbinQuantity: '',
      grossWeight: '',
    }));
  };

  const addHoloCrate = async () => {
    if (!holoEntry.rollTypeId) return;
    const rollType = getRollType(holoEntry.rollTypeId);
    if (!Number(rollType?.weight)) {
      alert('Roll type weight missing. Update masters first.');
      return;
    }
    const rollCount = Number(holoEntry.rollCount || 0);
    const gross = Number(holoEntry.grossWeight || 0);
    if (!rollCount || !gross) return;
    const { net, tare } = calcHoloWeights(holoEntry);
    if (net <= 0) {
      alert('Net weight must be positive.');
      return;
    }

    // Generate barcode for immediate printing using preview lot
    const crateIndex = holoCart.length + 1;
    const barcode = makeHoloReceiveBarcode({ series: previewLotNo || 'OP-XXX', crateIndex });

    const newCrate = {
      id: uid('crate'),
      ...holoEntry,
      rollCount,
      grossWeight: gross,
      netWeight: net,
      tareWeight: tare,
      barcode,
    };

    setHoloCart(prev => [...prev, newCrate]);

    // Immediate sticker printing
    const template = await loadTemplate(LABEL_STAGE_KEYS.HOLO_RECEIVE);
    if (template) {
      const confirmPrint = window.confirm('Print sticker for this crate?');
      if (confirmPrint) {
        const rollTypeName = rollType?.name || '';
        const boxName = holoEntry.boxId ? getBox(holoEntry.boxId)?.name || '' : '';
        const operatorName = holoIssue.operatorId ? getOperator(holoIssue.operatorId)?.name || '' : '';
        const yarnName = holoIssue.yarnId ? db.yarns?.find(y => y.id === holoIssue.yarnId)?.name || '' : '';
        await printStageTemplate(
          LABEL_STAGE_KEYS.HOLO_RECEIVE,
          {
            lotNo: previewLotNo || 'OP-XXX',
            itemName,
            rollCount,
            grossWeight: gross,
            tareWeight: tare,
            netWeight: net,
            rollType: rollTypeName,
            boxName,
            yarnName,
            machineName: holoIssue.machineId ? getMachine(holoIssue.machineId)?.name || '' : '',
            operatorName,
            date,
            barcode,
          },
          { template },
        );
      }
    }

    setHoloEntry(prev => ({
      ...prev,
      rollCount: '',
      grossWeight: '',
    }));
  };

  const addConingCrate = async () => {
    if (!coningIssue.coneTypeId) {
      alert('Select cone type first.');
      return;
    }
    const coneType = getConeType(coningIssue.coneTypeId);
    if (!Number(coneType?.weight)) {
      alert('Cone type weight missing. Update masters first.');
      return;
    }
    const coneCount = Number(coningEntry.coneCount || 0);
    const gross = Number(coningEntry.grossWeight || 0);
    if (!coneCount || !gross) return;
    const { net, tare } = calcConingWeights(coningEntry);
    if (net <= 0) {
      alert('Net weight must be positive.');
      return;
    }

    // Generate barcode for immediate printing using preview lot
    const crateIndex = coningCart.length + 1;
    const barcode = makeConingReceiveBarcode({ series: previewLotNo || 'OP-XXX', crateIndex });

    const newCrate = {
      id: uid('crate'),
      ...coningEntry,
      coneCount,
      grossWeight: gross,
      netWeight: net,
      tareWeight: tare,
      barcode,
    };

    setConingCart(prev => [...prev, newCrate]);

    // Immediate sticker printing
    const template = await loadTemplate(LABEL_STAGE_KEYS.CONING_RECEIVE);
    if (template) {
      const confirmPrint = window.confirm('Print sticker for this crate?');
      if (confirmPrint) {
        const coneTypeName = coneType?.name || '';
        const wrapperName = coningIssue.wrapperId ? getWrapper(coningIssue.wrapperId)?.name || '' : '';
        const boxName = coningEntry.boxId ? getBox(coningEntry.boxId)?.name || '' : '';
        const operatorName = coningIssue.operatorId ? getOperator(coningIssue.operatorId)?.name || '' : '';
        await printStageTemplate(
          LABEL_STAGE_KEYS.CONING_RECEIVE,
          {
            lotNo: previewLotNo || 'OP-XXX',
            itemName,
            coneCount,
            grossWeight: gross,
            tareWeight: tare,
            netWeight: net,
            coneType: coneTypeName,
            wrapperName,
            boxName,
            operatorName,
            shift: coningIssue.shift || '',
            date,
            barcode,
          },
          { template },
        );
      }
    }

    setConingEntry(prev => ({
      ...prev,
      coneCount: '',
      grossWeight: '',
    }));
  };

  const handleSaveInbound = async () => {
    if (!canSaveCommon || inboundCart.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        date,
        itemId,
        firmId,
        supplierId,
        pieces: inboundCart.map(p => ({
          weight: p.weight,
          isConsumed: p.isConsumed,
          consumptionDate: p.isConsumed ? p.consumptionDate : null,
        })),
      };
      const result = await api.createOpeningInbound(payload);
      await refreshDb();
      setInboundCart([]);
      await fetchOpeningPreview();
    } catch (err) {
      alert(err.message || 'Failed to save opening inbound stock');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = (setter, id) => {
    setter(prev => prev.filter(row => row.id !== id));
  };

  const handleSaveCutter = async () => {
    if (!canSaveCommon || cutterCart.length === 0) return;
    if (cutterCart.some(row => !row.cutId)) {
      alert('Cut is required for every crate.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        date,
        itemId,
        firmId,
        supplierId,
        crates: cutterCart.map(row => ({
          bobbinId: row.bobbinId,
          boxId: row.boxId,
          bobbinQuantity: Number(row.bobbinQuantity),
          grossWeight: Number(row.grossWeight),
          operatorId: row.operatorId || null,
          helperId: row.helperId || null,
          cutId: row.cutId,
          shift: row.shift || null,
          machineNo: row.machineId ? (getMachine(row.machineId)?.name || '') : null,
        })),
      };
      const result = await api.createOpeningCutterReceive(payload);
      await refreshDb();
      setCutterCart([]);
      await fetchOpeningPreview();
    } catch (err) {
      alert(err.message || 'Failed to save opening cutter stock');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveHolo = async () => {
    if (!canSaveCommon || !holoIssue.twistId || holoCart.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        date,
        itemId,
        firmId,
        supplierId,
        twistId: holoIssue.twistId,
        yarnId: holoIssue.yarnId || null,
        machineId: holoIssue.machineId || null,
        operatorId: holoIssue.operatorId || null,
        shift: holoIssue.shift || null,
        crates: holoCart.map(row => ({
          rollTypeId: row.rollTypeId,
          rollCount: Number(row.rollCount),
          grossWeight: Number(row.grossWeight),
          boxId: row.boxId || null,
          crateTareWeight: Number(row.crateTareWeight || 0),
          operatorId: holoIssue.operatorId || null,
        })),
      };
      const result = await api.createOpeningHoloReceive(payload);
      await refreshDb();
      setHoloCart([]);
      await fetchOpeningPreview();
    } catch (err) {
      alert(err.message || 'Failed to save opening holo stock');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveConing = async () => {
    if (!canSaveCommon || !coningIssue.coneTypeId || coningCart.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        date,
        itemId,
        firmId,
        supplierId,
        coneTypeId: coningIssue.coneTypeId,
        wrapperId: coningIssue.wrapperId || null,
        machineId: coningIssue.machineId || null,
        operatorId: coningIssue.operatorId || null,
        shift: coningIssue.shift || null,
        crates: coningCart.map(row => ({
          coneCount: Number(row.coneCount),
          grossWeight: Number(row.grossWeight),
          boxId: row.boxId || null,
          operatorId: coningIssue.operatorId || null,
        })),
      };
      const result = await api.createOpeningConingReceive(payload);
      await refreshDb();
      setConingCart([]);
      await fetchOpeningPreview();
    } catch (err) {
      alert(err.message || 'Failed to save opening coning stock');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Opening Stock</h1>
          <p className="text-sm text-muted-foreground">Create OP lots and print stickers to continue normal flow.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Opening Lot Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="space-y-2">
            <Label>Stage</Label>
            <Select value={stage} onChange={e => setStage(e.target.value)}>
              {STAGE_OPTIONS.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Item</Label>
            <Select value={itemId} onChange={e => setItemId(e.target.value)}>
              <option value="">Select Item</option>
              {db.items?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Firm (Optional)</Label>
            <Select value={firmId} onChange={e => setFirmId(e.target.value)}>
              <option value="">Select Firm</option>
              {db.firms?.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Supplier</Label>
            <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">Select Supplier</option>
              {db.suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Opening Lot</Label>
            <Input value={previewLotNo || '—'} readOnly className="bg-muted" />
          </div>
        </CardContent>
      </Card>

      {stage === 'inbound' && (
        <Card>
          <CardHeader>
            <CardTitle>Opening Inbound Stock</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-2">
                <Label>Piece Weight (kg)</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    value={inboundEntry.weight}
                    onChange={e => setInboundEntry(prev => ({ ...prev, weight: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addInboundPiece()}
                    className="flex-1"
                  />
                  <CatchWeightButton onWeightCaptured={(wt) => setInboundEntry(prev => ({ ...prev, weight: wt.toFixed(3) }))} />
                </div>
              </div>
              <div className="flex items-center space-x-2 h-10">
                <input
                  type="checkbox"
                  id="isConsumed"
                  className="w-4 h-4"
                  checked={inboundEntry.isConsumed}
                  onChange={e => setInboundEntry(prev => ({ ...prev, isConsumed: e.target.checked }))}
                />
                <Label htmlFor="isConsumed" className="cursor-pointer">Mark as Consumed</Label>
              </div>
              <div className="space-y-2">
                <Label>Consumption Date (if consumed)</Label>
                <Input
                  type="date"
                  disabled={!inboundEntry.isConsumed}
                  value={inboundEntry.consumptionDate}
                  onChange={e => setInboundEntry(prev => ({ ...prev, consumptionDate: e.target.value }))}
                />
              </div>
              <Button onClick={addInboundPiece} className="gap-2">
                <Plus className="w-4 h-4" /> Add Piece
              </Button>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveInbound} disabled={!canSaveCommon || inboundCart.length === 0 || saving} className="gap-2">
                {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Opening</>}
              </Button>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seq</TableHead>
                    <TableHead>Weight (kg)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Consumption Date</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inboundCart.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">No pieces added.</TableCell>
                    </TableRow>
                  ) : inboundCart.map((row, idx) => (
                    <TableRow key={row.id}>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell>{formatKg(row.weight)}</TableCell>
                      <TableCell>
                        <span className={row.isConsumed ? 'text-orange-600 font-medium' : 'text-green-600 font-medium'}>
                          {row.isConsumed ? 'Consumed' : 'Available'}
                        </span>
                      </TableCell>
                      <TableCell>{row.isConsumed ? row.consumptionDate : '—'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(setInboundCart, row.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {inboundCart.length > 0 && (
              <div className="flex justify-between text-sm text-muted-foreground font-medium">
                <div>Total: {inboundCart.length} pieces</div>
                <div>Available: {inboundTotals.totalAvailable} | Consumed: {inboundTotals.totalConsumed}</div>
                <div>Total Weight: {formatKg(inboundTotals.totalWeight)} kg</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {stage === 'cutter' && (
        <Card>
          <CardHeader>
            <CardTitle>Opening Cutter Receive</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="space-y-2">
                <Label>Bobbin</Label>
                <Select value={cutterEntry.bobbinId} onChange={e => setCutterEntry(prev => ({ ...prev, bobbinId: e.target.value }))}>
                  <option value="">Select Bobbin</option>
                  {db.bobbins?.map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Bobbin Qty</Label>
                <Input type="number" min="0" value={cutterEntry.bobbinQuantity} onChange={e => setCutterEntry(prev => ({ ...prev, bobbinQuantity: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Box</Label>
                <Select value={cutterEntry.boxId} onChange={e => setCutterEntry(prev => ({ ...prev, boxId: e.target.value }))}>
                  <option value="">Select Box</option>
                  {filterByProcess(db.boxes, 'cutter').map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Gross Weight (kg)</Label>
                <div className="flex gap-2">
                  <Input type="number" min="0" step="0.001" value={cutterEntry.grossWeight} onChange={e => setCutterEntry(prev => ({ ...prev, grossWeight: e.target.value }))} className="flex-1" />
                  <CatchWeightButton onWeightCaptured={(wt) => setCutterEntry(prev => ({ ...prev, grossWeight: wt.toFixed(3) }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Operator (Optional)</Label>
                <Select value={cutterEntry.operatorId} onChange={e => setCutterEntry(prev => ({ ...prev, operatorId: e.target.value }))}>
                  <option value="">Select Operator</option>
                  {filterByProcess(db.operators, 'cutter').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Helper (Optional)</Label>
                <Select value={cutterEntry.helperId} onChange={e => setCutterEntry(prev => ({ ...prev, helperId: e.target.value }))}>
                  <option value="">Select Helper</option>
                  {filterByProcess(db.helpers, 'cutter').map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Cut</Label>
                <Select value={cutterEntry.cutId} onChange={e => setCutterEntry(prev => ({ ...prev, cutId: e.target.value }))}>
                  <option value="">Select Cut</option>
                  {db.cuts?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Shift (Optional)</Label>
                <Select
                  value={cutterEntry.shift}
                  onChange={e => setCutterEntry(prev => ({ ...prev, shift: e.target.value }))}
                  options={SHIFT_OPTIONS}
                  placeholder="Select Shift"
                  clearable
                  searchable={false}
                />
              </div>
              <div className="space-y-2">
                <Label>Machine (Optional)</Label>
                <Select value={cutterEntry.machineId} onChange={e => setCutterEntry(prev => ({ ...prev, machineId: e.target.value }))}>
                  <option value="">Select Machine</option>
                  {filterByProcess(db.machines, 'cutter').map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </Select>
              </div>
            </div>
            {/* Live weight preview */}
            {cutterEntry.bobbinId && cutterEntry.boxId && cutterEntry.bobbinQuantity && cutterEntry.grossWeight && (
              <div className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                Tare: <span className="font-medium">{formatKg(calcCutterWeights(cutterEntry).tare)}</span> |
                Net: <span className="font-medium">{formatKg(calcCutterWeights(cutterEntry).net)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <Button onClick={addCutterCrate} className="gap-2">
                <Plus className="w-4 h-4" /> Add Crate
              </Button>
              <Button onClick={handleSaveCutter} disabled={!canSaveCommon || cutterCart.length === 0 || saving} className="gap-2">
                {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Opening</>}
              </Button>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bobbin</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Box</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead>Cut</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cutterCart.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">No crates added.</TableCell>
                    </TableRow>
                  ) : cutterCart.map(row => (
                    <TableRow key={row.id}>
                      <TableCell>{getBobbin(row.bobbinId)?.name || '—'}</TableCell>
                      <TableCell>{row.bobbinQuantity}</TableCell>
                      <TableCell>{getBox(row.boxId)?.name || '—'}</TableCell>
                      <TableCell>{formatKg(row.grossWeight)}</TableCell>
                      <TableCell>{formatKg(row.netWeight)}</TableCell>
                      <TableCell>{row.cutId ? getCut(row.cutId)?.name || '—' : '—'}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(setCutterCart, row.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {cutterCart.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Total: {cutterTotals.totalBobbins} bobbins, {formatKg(cutterTotals.totalNet)} kg
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {stage === 'holo' && (
        <Card>
          <CardHeader>
            <CardTitle>Opening Holo Receive</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>Twist</Label>
                <Select value={holoIssue.twistId} onChange={e => setHoloIssue(prev => ({ ...prev, twistId: e.target.value }))}>
                  <option value="">Select Twist</option>
                  {db.twists?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Yarn (Optional)</Label>
                <Select value={holoIssue.yarnId} onChange={e => setHoloIssue(prev => ({ ...prev, yarnId: e.target.value }))}>
                  <option value="">Select Yarn</option>
                  {db.yarns?.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Machine (Optional)</Label>
                <Select value={holoIssue.machineId} onChange={e => setHoloIssue(prev => ({ ...prev, machineId: e.target.value }))}>
                  <option value="">Select Machine</option>
                  {filterByProcess(db.machines, 'holo').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Operator (Optional)</Label>
                <Select value={holoIssue.operatorId} onChange={e => setHoloIssue(prev => ({ ...prev, operatorId: e.target.value }))}>
                  <option value="">Select Operator</option>
                  {filterByProcess(db.operators, 'holo').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Shift (Optional)</Label>
                <Select
                  value={holoIssue.shift}
                  onChange={e => setHoloIssue(prev => ({ ...prev, shift: e.target.value }))}
                  options={SHIFT_OPTIONS}
                  placeholder="Select Shift"
                  clearable
                  searchable={false}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>Roll Type</Label>
                <Select value={holoEntry.rollTypeId} onChange={e => setHoloEntry(prev => ({ ...prev, rollTypeId: e.target.value }))}>
                  <option value="">Select Roll Type</option>
                  {db.rollTypes?.map(r => <option key={r.id} value={r.id}>{r.name} ({r.weight}kg)</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Roll Count</Label>
                <Input type="number" min="0" value={holoEntry.rollCount} onChange={e => setHoloEntry(prev => ({ ...prev, rollCount: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Box (Optional)</Label>
                <Select value={holoEntry.boxId} onChange={e => setHoloEntry(prev => ({ ...prev, boxId: e.target.value }))}>
                  <option value="">Select Box</option>
                  {filterByProcess(db.boxes, 'holo').map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Gross Weight (kg)</Label>
                <div className="flex gap-2">
                  <Input type="number" min="0" step="0.001" value={holoEntry.grossWeight} onChange={e => setHoloEntry(prev => ({ ...prev, grossWeight: e.target.value }))} className="flex-1" />
                  <CatchWeightButton onWeightCaptured={(wt) => setHoloEntry(prev => ({ ...prev, grossWeight: wt.toFixed(3) }))} />
                </div>
              </div>
            </div>
            {/* Live weight preview */}
            {holoEntry.rollTypeId && holoEntry.rollCount && holoEntry.grossWeight && (
              <div className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                Tare: <span className="font-medium">{formatKg(calcHoloWeights(holoEntry).tare)}</span> |
                Net: <span className="font-medium">{formatKg(calcHoloWeights(holoEntry).net)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <Button onClick={addHoloCrate} className="gap-2">
                <Plus className="w-4 h-4" /> Add Crate
              </Button>
              <Button onClick={handleSaveHolo} disabled={!canSaveCommon || !holoIssue.twistId || holoCart.length === 0 || saving} className="gap-2">
                {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Opening</>}
              </Button>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Roll Type</TableHead>
                    <TableHead>Count</TableHead>
                    <TableHead>Box</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holoCart.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">No crates added.</TableCell>
                    </TableRow>
                  ) : holoCart.map(row => (
                    <TableRow key={row.id}>
                      <TableCell>{getRollType(row.rollTypeId)?.name || '—'}</TableCell>
                      <TableCell>{row.rollCount}</TableCell>
                      <TableCell>{row.boxId ? getBox(row.boxId)?.name || '—' : '—'}</TableCell>
                      <TableCell>{formatKg(row.grossWeight)}</TableCell>
                      <TableCell>{formatKg(row.netWeight)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(setHoloCart, row.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {holoCart.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Total: {holoTotals.totalRolls} rolls, {formatKg(holoTotals.totalNet)} kg
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {stage === 'coning' && (
        <Card>
          <CardHeader>
            <CardTitle>Opening Coning Receive</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>Cone Type</Label>
                <Select value={coningIssue.coneTypeId} onChange={e => setConingIssue(prev => ({ ...prev, coneTypeId: e.target.value }))}>
                  <option value="">Select Cone Type</option>
                  {db.cone_types?.map(c => <option key={c.id} value={c.id}>{c.name} ({c.weight}kg)</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Wrapper (Optional)</Label>
                <Select value={coningIssue.wrapperId} onChange={e => setConingIssue(prev => ({ ...prev, wrapperId: e.target.value }))}>
                  <option value="">Select Wrapper</option>
                  {db.wrappers?.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Machine (Optional)</Label>
                <Select value={coningIssue.machineId} onChange={e => setConingIssue(prev => ({ ...prev, machineId: e.target.value }))}>
                  <option value="">Select Machine</option>
                  {filterByProcess(db.machines, 'coning').map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Operator (Optional)</Label>
                <Select value={coningIssue.operatorId} onChange={e => setConingIssue(prev => ({ ...prev, operatorId: e.target.value }))}>
                  <option value="">Select Operator</option>
                  {filterByProcess(db.operators, 'coning').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Shift (Optional)</Label>
                <Select
                  value={coningIssue.shift}
                  onChange={e => setConingIssue(prev => ({ ...prev, shift: e.target.value }))}
                  options={SHIFT_OPTIONS}
                  placeholder="Select Shift"
                  clearable
                  searchable={false}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Cone Count</Label>
                <Input type="number" min="0" value={coningEntry.coneCount} onChange={e => setConingEntry(prev => ({ ...prev, coneCount: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Box (Optional)</Label>
                <Select value={coningEntry.boxId} onChange={e => setConingEntry(prev => ({ ...prev, boxId: e.target.value }))}>
                  <option value="">Select Box</option>
                  {filterByProcess(db.boxes, 'coning').map(b => <option key={b.id} value={b.id}>{b.name} ({b.weight}kg)</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Gross Weight (kg)</Label>
                <div className="flex gap-2">
                  <Input type="number" min="0" step="0.001" value={coningEntry.grossWeight} onChange={e => setConingEntry(prev => ({ ...prev, grossWeight: e.target.value }))} className="flex-1" />
                  <CatchWeightButton onWeightCaptured={(wt) => setConingEntry(prev => ({ ...prev, grossWeight: wt.toFixed(3) }))} />
                </div>
              </div>
            </div>
            {/* Live weight preview */}
            {coningIssue.coneTypeId && coningEntry.coneCount && coningEntry.grossWeight && (
              <div className="text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                Tare: <span className="font-medium">{formatKg(calcConingWeights(coningEntry).tare)}</span> |
                Net: <span className="font-medium">{formatKg(calcConingWeights(coningEntry).net)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <Button onClick={addConingCrate} className="gap-2">
                <Plus className="w-4 h-4" /> Add Crate
              </Button>
              <Button onClick={handleSaveConing} disabled={!canSaveCommon || !coningIssue.coneTypeId || coningCart.length === 0 || saving} className="gap-2">
                {saving ? 'Saving...' : <><Save className="w-4 h-4" /> Save Opening</>}
              </Button>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cones</TableHead>
                    <TableHead>Box</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {coningCart.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">No crates added.</TableCell>
                    </TableRow>
                  ) : coningCart.map(row => (
                    <TableRow key={row.id}>
                      <TableCell>{row.coneCount}</TableCell>
                      <TableCell>{row.boxId ? getBox(row.boxId)?.name || '—' : '—'}</TableCell>
                      <TableCell>{formatKg(row.grossWeight)}</TableCell>
                      <TableCell>{formatKg(row.netWeight)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleRemove(setConingCart, row.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {coningCart.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Total: {coningTotals.totalCones} cones, {formatKg(coningTotals.totalNet)} kg
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
