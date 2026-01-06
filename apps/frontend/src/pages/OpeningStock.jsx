import React, { useEffect, useMemo, useState, useRef } from 'react';
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
import { formatKg, todayISO, uid, formatDateDDMMYYYY } from '../utils';
import { LABEL_STAGE_KEYS, loadTemplate, printStageTemplate, makeReceiveBarcode, makeHoloReceiveBarcode, makeConingReceiveBarcode } from '../utils/labelPrint';
import { Plus, Save, Trash2, Upload, Download, X, History } from 'lucide-react';
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
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleDownloadTemplate = async () => {
    try {
      // Build API base URL - same logic as api/client.js
      const apiBase = import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:4001`;
      const res = await fetch(`${apiBase}/api/opening_stock/template?stage=${stage}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to download');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Dynamic filename based on stage
      const stageName = stage.charAt(0).toUpperCase() + stage.slice(1);
      a.download = `Opening_Stock_${stageName}_Template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to download template');
    }
  };

  const handleBulkUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSaving(true);
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const content = evt.target.result;
          const payload = {
            fileContent: content,
            fileType: file.name.endsWith('.csv') ? 'csv' : 'xlsx',
            date, itemId, firmId, supplierId,
            twistId: stage === 'holo' ? holoIssue.twistId : undefined,
            yarnId: stage === 'holo' ? holoIssue.yarnId : undefined,
            machineId: stage === 'holo' ? holoIssue.machineId : (stage === 'coning' ? coningIssue.machineId : undefined),
            operatorId: stage === 'holo' ? holoIssue.operatorId : (stage === 'coning' ? coningIssue.operatorId : undefined),
            shift: stage === 'holo' ? holoIssue.shift : (stage === 'coning' ? coningIssue.shift : undefined),
            coneTypeId: stage === 'coning' ? coningIssue.coneTypeId : undefined,
            wrapperId: stage === 'coning' ? coningIssue.wrapperId : undefined,
          };

          // First, get preview of what will be created
          const preview = await api.previewOpeningStock(stage, payload);

          // Build confirmation message - show errors at TOP for visibility
          let confirmMsg = `📦 File: ${file.name}\n`;

          // Always show errors line - show details only when actual errors exist
          if (preview.errors && preview.errors.length > 0) {
            confirmMsg += `❌ Errors: ${preview.errors.length}${preview.hasMoreErrors ? '+' : ''} rows have issues!\n`;
            preview.errors.slice(0, 5).forEach(err => { confirmMsg += `   • ${err}\n`; });
            if (preview.errors.length > 5) confirmMsg += `   ... and ${preview.errors.length - 5} more errors\n`;
            confirmMsg += '\n';
          } else {
            confirmMsg += `✅ Errors: None\n`;
          }

          // Show warnings (missing masters like Twist, Yarn, Cut)
          if (preview.warnings && preview.warnings.length > 0) {
            confirmMsg += `⚠️ Warnings: ${preview.warnings.length}${preview.hasMoreWarnings ? '+' : ''} missing masters\n`;
            preview.warnings.slice(0, 3).forEach(w => { confirmMsg += `   • ${w}\n`; });
            if (preview.warnings.length > 3) confirmMsg += `   ... and ${preview.warnings.length - 3} more\n`;
          }
          confirmMsg += '\n';
          confirmMsg += `📊 Total Rows: ${preview.totalRows}\n`;
          confirmMsg += `🏷️ Lots to Create: ${preview.lotsToCreate}\n\n`;

          if (preview.lotAssignments && preview.lotAssignments.length > 0) {
            const showCount = Math.min(preview.lotAssignments.length, 8); // Show max 8 lots
            confirmMsg += `── Lot Assignments ──\n`;
            preview.lotAssignments.slice(0, showCount).forEach(a => {
              confirmMsg += `• ${a.lotNo}: ${a.itemName} + ${a.supplierName} (${a.rowCount})\n`;
            });
            if (preview.lotAssignments.length > showCount) {
              confirmMsg += `... and ${preview.lotAssignments.length - showCount} more lots\n`;
            }
          }

          confirmMsg += `\nProceed with upload?`;

          if (!window.confirm(confirmMsg)) {
            setSaving(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }

          // Proceed with actual upload
          const res = await api.uploadOpeningStock(stage, payload);
          const message = res.lotsCreated > 1
            ? `Uploaded successfully! Created ${res.lotsCreated} Lots: ${res.lotNos.join(', ')} (Total: ${res.totalCount} entries)`
            : `Uploaded successfully! Lot: ${res.lotNos?.[0] || res.lotNo}, Count: ${res.totalCount || res.count}`;
          alert(message);
          await refreshDb();
          await fetchOpeningPreview();
        } catch (err) {
          console.error(err);
          alert(`Upload failed: ${err.message || 'Unknown error'}`);
        } finally {
          setSaving(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setSaving(false);
      alert('Failed to read file');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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

  // History data for opening stock entries
  const openingHistory = useMemo(() => {
    const result = { inbound: [], cutter: [], holo: [], coning: [] };

    // Inbound: filter by isOpeningStock flag
    result.inbound = (db.inbound_items || []).filter(p => p.isOpeningStock).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // Cutter Receive: filter by lotNo starting with OP-
    result.cutter = (db.receive_from_cutter_machine_rows || []).filter(r => !r.isDeleted && (r.pieceId || '').startsWith('OP-')).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // Holo Receive: filter by lotNo starting with OP-
    result.holo = (db.receive_from_holo_machine_rows || []).filter(r => {
      const issue = db.issue_to_holo_machine?.find(i => i.id === r.issueId);
      return issue && (issue.lotNo || '').startsWith('OP-');
    }).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    // Coning Receive: filter by lotNo starting with OP-
    result.coning = (db.receive_from_coning_machine_rows || []).filter(r => {
      const issue = db.issue_to_coning_machine?.find(i => i.id === r.issueId);
      return issue && (issue.lotNo || '').startsWith('OP-');
    }).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    return result;
  }, [db]);

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
            cut: cutName,
            machineName,
            helperName,
            operatorName,
            shift: cutterEntry.shift || '',
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
            cut: '',
            twist: holoIssue.twistId ? (db.twists?.find(t => t.id === holoIssue.twistId)?.name || '') : '',
            twistName: holoIssue.twistId ? (db.twists?.find(t => t.id === holoIssue.twistId)?.name || '') : '',
            shift: holoIssue.shift || '',
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
            cut: '',
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

  const currentStageName = STAGE_OPTIONS.find(s => s.id === stage)?.label || stage;

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // Clear input value so selecting the same file again triggers onChange
      e.target.value = '';
    }
  };

  const handleModalUpload = async () => {
    if (!selectedFile) return;
    // Create a synthetic event to match existing handleBulkUpload signature
    const syntheticEvent = { target: { files: [selectedFile], value: selectedFile.name } };
    await handleBulkUpload(syntheticEvent);
    setSelectedFile(null);
    setShowBulkModal(false);
  };

  return (
    <div className="space-y-6 fade-in">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".csv,.xlsx,.xls"
        onChange={handleFileSelect}
      />
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Opening Stock</h1>
          <p className="text-sm text-muted-foreground">Create OP lots and print stickers to continue normal flow.</p>
        </div>
        <Button variant="outline" onClick={() => setShowBulkModal(true)} className="gap-2">
          <Upload className="w-4 h-4" /> Bulk Upload
        </Button>
      </div>

      {/* Bulk Upload Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setShowBulkModal(false); setSelectedFile(null); }}>
          <div className="bg-background rounded-lg shadow-xl w-full max-w-2xl mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Bulk Upload — {currentStageName}</h2>
              <Button variant="ghost" size="icon" onClick={() => { setShowBulkModal(false); setSelectedFile(null); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
              {/* Left Panel: Download */}
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <Download className="w-5 h-5" />
                  <span className="font-medium">Download Template</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Download the Excel template for the selected stage. Fill in your data and upload it on the right.
                </p>
                <div className="text-sm bg-muted/50 rounded-md px-3 py-2">
                  Current Stage: <span className="font-medium">{currentStageName}</span>
                </div>
                <Button variant="outline" onClick={handleDownloadTemplate} className="w-full gap-2">
                  <Download className="w-4 h-4" /> Download Template
                </Button>
              </div>
              {/* Right Panel: Upload */}
              <div className="p-6 space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <Upload className="w-5 h-5" />
                  <span className="font-medium">Upload File</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Upload your filled template to create entries in bulk.
                </p>
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {selectedFile ? (
                    <div className="space-y-1">
                      <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center mx-auto text-primary">
                        <Upload className="w-5 h-5" />
                      </div>
                      <p className="font-medium text-primary text-sm truncate px-2">{selectedFile.name}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">File Selected — Click to Change</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Click to select file</p>
                        <p className="text-xs text-muted-foreground">.csv, .xlsx, .xls</p>
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  onClick={handleModalUpload}
                  disabled={!selectedFile || saving}
                  className="w-full gap-2"
                >
                  {saving ? 'Uploading...' : <><Upload className="w-4 h-4" /> Upload</>}
                </Button>
                {!canSaveCommon && (
                  <p className="text-xs text-amber-600 text-center">Note: Lot details not selected. Ensure Item Name and Supplier Name are in your file.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
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

            <div className="hidden sm:block rounded-md border overflow-x-auto">
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

            {/* Mobile Card View */}
            <div className="block sm:hidden space-y-2">
              {inboundCart.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No pieces added.</div>
              ) : inboundCart.map((row, idx) => (
                <div key={row.id} className="border rounded-lg bg-card p-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground w-6">#{idx + 1}</span>
                    <div>
                      <div className="font-medium">{formatKg(row.weight)}</div>
                      <div className="text-xs">
                        <span className={row.isConsumed ? 'text-orange-600' : 'text-green-600'}>
                          {row.isConsumed ? 'Consumed' : 'Available'}
                        </span>
                        {row.isConsumed && row.consumptionDate && (
                          <span className="text-muted-foreground ml-2">{row.consumptionDate}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleRemove(setInboundCart, row.id)}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
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
            <div className="hidden sm:block rounded-md border overflow-x-auto">
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

            {/* Mobile Card View */}
            <div className="block sm:hidden space-y-2">
              {cutterCart.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No crates added.</div>
              ) : cutterCart.map(row => (
                <div key={row.id} className="border rounded-lg bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{getBobbin(row.bobbinId)?.name || '—'} × {row.bobbinQuantity}</div>
                      <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-1">
                        <span>Box: {getBox(row.boxId)?.name || '—'}</span>
                        <span>Cut: {row.cutId ? getCut(row.cutId)?.name || '—' : '—'}</span>
                        <span>Gross: {formatKg(row.grossWeight)}</span>
                        <span className="font-medium text-foreground">Net: {formatKg(row.netWeight)}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handleRemove(setCutterCart, row.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
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
            <div className="hidden sm:block rounded-md border overflow-x-auto">
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

            {/* Mobile Card View */}
            <div className="block sm:hidden space-y-2">
              {holoCart.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No crates added.</div>
              ) : holoCart.map(row => (
                <div key={row.id} className="border rounded-lg bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{getRollType(row.rollTypeId)?.name || '—'} × {row.rollCount}</div>
                      <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-1">
                        <span>Box: {row.boxId ? getBox(row.boxId)?.name || '—' : '—'}</span>
                        <span>Gross: {formatKg(row.grossWeight)}</span>
                        <span className="font-medium text-foreground col-span-2">Net: {formatKg(row.netWeight)}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handleRemove(setHoloCart, row.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
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
            <div className="hidden sm:block rounded-md border overflow-x-auto">
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

            {/* Mobile Card View */}
            <div className="block sm:hidden space-y-2">
              {coningCart.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No crates added.</div>
              ) : coningCart.map(row => (
                <div key={row.id} className="border rounded-lg bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{row.coneCount} cones</div>
                      <div className="text-xs text-muted-foreground mt-1 grid grid-cols-2 gap-1">
                        <span>Box: {row.boxId ? getBox(row.boxId)?.name || '—' : '—'}</span>
                        <span>Gross: {formatKg(row.grossWeight)}</span>
                        <span className="font-medium text-foreground col-span-2">Net: {formatKg(row.netWeight)}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => handleRemove(setConingCart, row.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {coningCart.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Total: {coningTotals.totalCones} cones, {formatKg(coningTotals.totalNet)} kg
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* History Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Recent Opening Stock Entries ({STAGE_OPTIONS.find(s => s.id === stage)?.label})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stage === 'inbound' && (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Piece</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openingHistory.inbound.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground">No opening inbound entries found.</TableCell>
                    </TableRow>
                  ) : openingHistory.inbound.slice(0, 50).map(row => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(row.createdAt)}</TableCell>
                      <TableCell>{row.lotNo}</TableCell>
                      <TableCell>{db.items?.find(i => i.id === row.itemId)?.name || '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{row.id}</TableCell>
                      <TableCell>{formatKg(row.weight)}</TableCell>
                      <TableCell>
                        <span className={row.status === 'available' ? 'text-green-600 font-medium' : 'text-orange-600 font-medium'}>
                          {row.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {stage === 'cutter' && (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Bobbin</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Cut</TableHead>
                    <TableHead>Net Wt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openingHistory.cutter.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">No opening cutter receive entries found.</TableCell>
                    </TableRow>
                  ) : openingHistory.cutter.slice(0, 50).map(row => {
                    // Get item name from inbound_items via pieceId
                    const inboundItem = db.inbound_items?.find(p => p.id === row.pieceId);
                    const itemName = row.itemName || (inboundItem ? db.items?.find(i => i.id === inboundItem.itemId)?.name : null) || '—';
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(row.date || row.createdAt)}</TableCell>
                        <TableCell>{row.pieceId?.split('-').slice(0, 2).join('-')}</TableCell>
                        <TableCell>{itemName}</TableCell>
                        <TableCell className="font-mono text-xs">{row.barcode || row.vchNo}</TableCell>
                        <TableCell>{row.bobbin?.name || getBobbin(row.bobbinId)?.name || '—'}</TableCell>
                        <TableCell>{row.bobbinQuantity || 0}</TableCell>
                        <TableCell>{row.cutMaster?.name || row.cut || getCut(row.cutId)?.name || '—'}</TableCell>
                        <TableCell>{formatKg(row.netWt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {stage === 'holo' && (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Roll Type</TableHead>
                    <TableHead>Rolls</TableHead>
                    <TableHead>Cut</TableHead>
                    <TableHead>Net Wt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openingHistory.holo.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground">No opening holo receive entries found.</TableCell>
                    </TableRow>
                  ) : openingHistory.holo.slice(0, 50).map(row => {
                    const issue = db.issue_to_holo_machine?.find(i => i.id === row.issueId);
                    const itemName = issue?.itemId ? db.items?.find(i => i.id === issue.itemId)?.name : '—';
                    const cutName = issue?.cutId ? db.cuts?.find(c => c.id === issue.cutId)?.name : '—';
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(row.date || row.createdAt)}</TableCell>
                        <TableCell>{issue?.lotNo || '—'}</TableCell>
                        <TableCell>{itemName || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{row.barcode || '—'}</TableCell>
                        <TableCell>{row.rollType?.name || getRollType(row.rollTypeId)?.name || '—'}</TableCell>
                        <TableCell>{row.rollCount || 0}</TableCell>
                        <TableCell>{cutName || '—'}</TableCell>
                        <TableCell>{formatKg(row.rollWeight || (row.grossWeight - (row.tareWeight || 0)))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {stage === 'coning' && (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead>Cones</TableHead>
                    <TableHead>Cut</TableHead>
                    <TableHead>Net Wt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openingHistory.coning.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">No opening coning receive entries found.</TableCell>
                    </TableRow>
                  ) : openingHistory.coning.slice(0, 50).map(row => {
                    const issue = db.issue_to_coning_machine?.find(i => i.id === row.issueId);
                    const itemName = issue?.itemId ? db.items?.find(i => i.id === issue.itemId)?.name : '—';
                    // Trace back through holo for cut
                    let cutName = '—';
                    try {
                      const refs = typeof issue?.receivedRowRefs === 'string' ? JSON.parse(issue.receivedRowRefs) : issue?.receivedRowRefs;
                      if (Array.isArray(refs) && refs.length > 0) {
                        const holoRow = db.receive_from_holo_machine_rows?.find(r => r.id === refs[0].rowId);
                        if (holoRow) {
                          const holoIssue = db.issue_to_holo_machine?.find(i => i.id === holoRow.issueId);
                          if (holoIssue?.cutId) cutName = db.cuts?.find(c => c.id === holoIssue.cutId)?.name || '—';
                        }
                      }
                    } catch (e) { /* ignore */ }
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap">{formatDateDDMMYYYY(row.date || row.createdAt)}</TableCell>
                        <TableCell>{issue?.lotNo || '—'}</TableCell>
                        <TableCell>{itemName || '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{row.barcode || '—'}</TableCell>
                        <TableCell>{row.coneCount || 0}</TableCell>
                        <TableCell>{cutName}</TableCell>
                        <TableCell>{formatKg(row.netWeight)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
