/**
 * ReceiveFromMachine page component for GLINTEX Inventory
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Pill, Pagination, Select, Input } from '../components';
import { formatKg, uid, todayISO } from '../utils';
import { getProcessDefinition } from '../constants/processes';
import * as api from '../api';

const ensureArray = (value) => (Array.isArray(value) ? value : []);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function padBarcodeSegment(value) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return String(Math.max(0, Math.trunc(num))).padStart(3, '0');
  }
  return String(value || '').padStart(3, '0');
}

function makeReceiveBarcodePreview({ lotNo, seq, crateIndex = 1 }) {
  if (!lotNo) return null;
  const safeLot = String(lotNo).trim();
  if (!safeLot) return null;
  const seqPart = padBarcodeSegment(seq);
  const cratePart = padBarcodeSegment(crateIndex);
  return `REC-${safeLot}-${seqPart}-C${cratePart}`;
}

function parseReceiveCrateIndex(barcode) {
  if (typeof barcode !== 'string') return null;
  const match = barcode.trim().match(/-C(\d+)$/i);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function renderIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return null;
  return (
    <ul className="list-disc list-inside mt-2 space-y-1">
      {issues.map((issue, idx) => {
        if (issue.type === 'duplicate_vch_in_db') {
          return <li key={`issue-${idx}`}>VchNo already imported: {issue.duplicates.join(', ')}</li>;
        }
        if (issue.type === 'duplicate_vch_in_file') {
          return <li key={`issue-${idx}`}>Duplicate VchNo in file: {issue.rows.join(', ')}</li>;
        }
        return <li key={`issue-${idx}`}>{issue.message || issue.type}</li>;
      })}
    </ul>
  );
}

function SummaryCard({ title, summary, meta, cls, actions }) {
  if (!summary) return null;
  const { filename, rowCount, pieceCount, totalNetWeight, pieces = [], lots = [], missingPieces = [] } = summary;
  return (
    <div className={`rounded-xl border ${cls.cardBorder} ${cls.cardBg} p-4 space-y-4`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="font-semibold text-base">{title}</div>
          <div className={`text-xs ${cls.muted}`}>
            {filename || 'File'} · {rowCount || 0} rows · {pieceCount || 0} pieces · Upload net {formatKg(totalNetWeight || 0)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className={`text-left ${cls.muted}`}>
            <tr>
              <th className="py-2 pr-2">Piece</th>
              <th className="py-2 pr-2">Lot</th>
              <th className="py-2 pr-2 text-right">Inbound (kg)</th>
              <th className="py-2 pr-2 text-right">Current received (kg)</th>
              <th className="py-2 pr-2 text-right">This upload (kg)</th>
              <th className="py-2 pr-2 text-right">Received after (kg)</th>
              <th className="py-2 pr-2 text-right">Pending after (kg)</th>
              <th className="py-2 pr-2">Status</th>
            </tr>
          </thead>
            <tbody>
            {pieces.length === 0 ? (
              <tr><td className="py-3 pr-2" colSpan={8}>No rows.</td></tr>
            ) : pieces.map(piece => {
              const missing = !piece.inboundExists;
              return (
                <tr key={piece.pieceId} className={`border-t ${cls.rowBorder}`}>
                  <td className="py-2 pr-2 font-mono">{piece.pieceId}</td>
                  <td className="py-2 pr-2 font-mono">{piece.lotNo || '—'}</td>
                  <td className="py-2 pr-2 text-right">{piece.inboundWeight == null ? '—' : formatKg(piece.inboundWeight)}</td>
                  <td className="py-2 pr-2 text-right">{formatKg(piece.currentReceivedWeight || 0)}</td>
                  <td className="py-2 pr-2 text-right">{formatKg(piece.incrementWeight || 0)}</td>
                  <td className="py-2 pr-2 text-right">{formatKg(piece.futureReceivedWeight || 0)}</td>
                  <td className="py-2 pr-2 text-right">{piece.futurePendingWeight == null ? '—' : formatKg(piece.futurePendingWeight)}</td>
                  <td className="py-2 pr-2">{missing ? <span className="text-orange-400">Inbound not found</span> : <span className="text-emerald-400">Linked</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className={`text-left ${cls.muted}`}>
            <tr>
              <th className="py-2 pr-2">Lot</th>
              <th className="py-2 pr-2 text-right">Inbound (kg)</th>
              <th className="py-2 pr-2 text-right">Current received (kg)</th>
              <th className="py-2 pr-2 text-right">This upload (kg)</th>
              <th className="py-2 pr-2 text-right">Received after (kg)</th>
              <th className="py-2 pr-2 text-right">Pending after (kg)</th>
            </tr>
          </thead>
          <tbody>
            {lots.length === 0 ? (
              <tr><td className="py-3 pr-2" colSpan={6}>No lot data.</td></tr>
            ) : lots.map(lot => (
              <tr key={lot.lotNo} className={`border-t ${cls.rowBorder}`}>
                <td className="py-2 pr-2 font-mono">{lot.lotNo}</td>
                <td className="py-2 pr-2 text-right">{formatKg(lot.inboundWeight || 0)}</td>
                <td className="py-2 pr-2 text-right">{formatKg(lot.currentReceivedWeight || 0)}</td>
                <td className="py-2 pr-2 text-right">{formatKg(lot.incrementWeight || 0)}</td>
                <td className="py-2 pr-2 text-right">{formatKg(lot.futureReceivedWeight || 0)}</td>
                <td className="py-2 pr-2 text-right">{formatKg(lot.futurePendingWeight || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {Array.isArray(missingPieces) && missingPieces.length > 0 && (
        <div className="text-sm text-orange-300">
          Missing inbound pieces: {missingPieces.join(', ')}
        </div>
      )}

      {meta && meta.uploadedAt && (
        <div className={`text-xs ${cls.muted}`}>Processed at {formatDateTime(meta.uploadedAt)}</div>
      )}
    </div>
  );
}

export function ReceiveFromMachine({ db, refreshDb, onIssueToMachine, process = 'cutter' }) {
  const { cls, brand } = useBrand();
  const processDef = getProcessDefinition(process);
  const isCutter = process === 'cutter';
  const isHolo = process === 'holo';
  const isConing = process === 'coning';
  const { receiveTotalsKey, receiveUnitField, receiveWeightField, receiveRowsKey, unitLabel, unitLabelPlural, label } = processDef;
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionIssues, setActionIssues] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [pieceReceivePage, setPieceReceivePage] = useState(1);
  const [orphanPage, setOrphanPage] = useState(1);
  const [uploadsPage, setUploadsPage] = useState(1);
  const [rowsPage, setRowsPage] = useState(1);
  const [mode, setMode] = useState('manual');
  const pageSize = 50;

  const inboundPieceMap = useMemo(() => {
    const map = new Map();
    (db.inbound_items || []).forEach((piece) => {
      map.set(piece.id, piece);
    });
    return map;
  }, [db.inbound_items]);

  // Map pieceId -> { received: number, wastage: number, totalUnits: number }
  const receiveTotalsMap = useMemo(() => {
    const map = new Map();
    const totalsList = ensureArray(db[receiveTotalsKey]);
    totalsList.forEach((row) => {
      map.set(row.pieceId, {
        received: Number(row[receiveWeightField] || 0),
        wastage: Number(row.wastageNetWeight || 0),
        totalUnits: Number(row[receiveUnitField] || 0),
      });
    });
    return map;
  }, [db, process, receiveTotalsKey, receiveWeightField, receiveUnitField]);

  // Map pieceId -> most common bobbin name from receive rows
  const pieceBobbinMap = useMemo(() => {
    if (!isCutter) return new Map();
    const map = new Map();
    const pieceBobbinCounts = new Map();
    
    ensureArray(db[receiveRowsKey]).forEach((row) => {
      if (!row.pieceId) return;
      const bobbinName = row.bobbin?.name || row.pcsTypeName || null;
      if (!bobbinName) return;
      
      const key = `${row.pieceId}|${bobbinName}`;
      const count = pieceBobbinCounts.get(key) || 0;
      pieceBobbinCounts.set(key, count + 1);
      
      // Track the most common bobbin for each piece
      const currentBest = map.get(row.pieceId);
      const currentBestCount = currentBest ? pieceBobbinCounts.get(`${row.pieceId}|${currentBest}`) || 0 : 0;
      if (count + 1 > currentBestCount) {
        map.set(row.pieceId, bobbinName);
      }
    });
    
    return map;
  }, [db, isCutter, receiveRowsKey]);

  const { knownPieces, orphanPieces, totalReceivedWeight } = useMemo(() => {
    const known = [];
    const orphan = [];
    let runningTotal = 0;
    for (const [pieceId, totals] of receiveTotalsMap.entries()) {
      const received = totals.received || 0;
      const totalUnits = totals.totalUnits || 0;
      runningTotal += received;
      const inbound = inboundPieceMap.get(pieceId) || null;
      const inboundWeight = inbound ? Number(inbound.weight || 0) : null;
      const summary = {
        pieceId,
        lotNo: inbound ? inbound.lotNo : null,
        inboundWeight,
        receivedWeight: received,
        pendingWeight: inboundWeight === null ? null : Math.max(0, inboundWeight - received),
        totalUnits,
        bobbinName: pieceBobbinMap.get(pieceId) || '—',
      };
      if (inbound) known.push(summary);
      else orphan.push(summary);
    }
    known.sort((a, b) => {
      const pendingDiff = (b.pendingWeight ?? 0) - (a.pendingWeight ?? 0);
      if (pendingDiff !== 0) return pendingDiff;
      return a.pieceId.localeCompare(b.pieceId, undefined, { numeric: true, sensitivity: 'base' });
    });
    orphan.sort((a, b) => a.pieceId.localeCompare(b.pieceId, undefined, { numeric: true, sensitivity: 'base' }));
    return { knownPieces: known, orphanPieces: orphan, totalReceivedWeight: runningTotal };
  }, [inboundPieceMap, receiveTotalsMap]);

  const recentUploads = useMemo(() => (db.receive_from_cutter_machine_uploads || []).slice(), [db.receive_from_cutter_machine_uploads]);
  const uploadLookup = useMemo(() => {
    const map = new Map();
    (db.receive_from_cutter_machine_uploads || []).forEach((u) => map.set(u.id, u));
    return map;
  }, [db.receive_from_cutter_machine_uploads]);
  const latestRows = useMemo(() => (db.receive_from_cutter_machine_rows || []).slice(), [db.receive_from_cutter_machine_rows]);

  function clearSelection() {
    setSelectedFile(null);
    setPreviewData(null);
    setActionError(null);
    setActionIssues([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    if (dragActive) setDragActive(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0] || null;
    if (file) {
      setSelectedFile(file);
      setPreviewData(null);
      setActionError(null);
      setActionIssues([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handlePreview() {
    if (!selectedFile) return;
    setPreviewing(true);
    setActionError(null);
    setActionIssues([]);
    try {
      const content = await selectedFile.text();
      const result = await api.previewReceiveFromMachine({ filename: selectedFile.name, content });
      setPreviewData(result.preview || null);
    } catch (err) {
      console.error('Failed to preview receive CSV', err);
      setActionError(err.message || 'Failed to preview CSV');
      const issues = Array.isArray(err.details?.issues) ? err.details.issues : [];
      const duplicates = Array.isArray(err.details?.duplicates) ? err.details.duplicates : [];
      const mergedIssues = [...issues];
      if (duplicates.length) {
        mergedIssues.push({ type: 'duplicate_vch_in_db', duplicates });
      }
      setActionIssues(mergedIssues);
      setPreviewData(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function handleConfirmImport() {
    if (!selectedFile) return;
    setConfirming(true);
    setActionError(null);
    setActionIssues([]);
    try {
      const content = await selectedFile.text();
      const result = await api.importReceiveFromMachine({ filename: selectedFile.name, content });
      setImportResult(result);
      setPreviewData(null);
      clearSelection();
      try {
        await refreshDb();
      } catch (refreshErr) {
        console.error('Failed to refresh after receive import', refreshErr);
      }
    } catch (err) {
      console.error('Failed to import receive CSV', err);
      setActionError(err.message || 'Failed to import CSV');
      const issues = Array.isArray(err.details?.issues) ? err.details.issues : [];
      const duplicates = Array.isArray(err.details?.duplicates) ? err.details.duplicates : [];
      const mergedIssues = [...issues];
      if (duplicates.length) {
        mergedIssues.push({ type: 'duplicate_vch_in_db', duplicates });
      }
      setActionIssues(mergedIssues);
    } finally {
      setConfirming(false);
    }
  }

  const piecesWithReceipts = receiveTotalsMap.size;

  useEffect(() => { setPieceReceivePage(1); }, [knownPieces]);
  useEffect(() => { setOrphanPage(1); }, [/* orphanPieces depends on receiveTotalsMap/inboundPieceMap */ receiveTotalsMap, inboundPieceMap]);
  useEffect(() => { setUploadsPage(1); }, [recentUploads]);
  useEffect(() => { setRowsPage(1); }, [latestRows]);

  const limitedKnownPieces = useMemo(() => {
    const start = (pieceReceivePage - 1) * pageSize;
    return knownPieces.slice(start, start + pageSize);
  }, [knownPieces, pieceReceivePage]);

  const pagedOrphanPieces = useMemo(() => {
    const start = (orphanPage - 1) * pageSize;
    return orphanPieces.slice(start, start + pageSize);
  }, [orphanPieces, orphanPage]);

  const pagedRecentUploads = useMemo(() => {
    const start = (uploadsPage - 1) * pageSize;
    return recentUploads.slice(start, start + pageSize);
  }, [recentUploads, uploadsPage]);

  const pagedLatestRows = useMemo(() => {
    const start = (rowsPage - 1) * pageSize;
    return latestRows.slice(start, start + pageSize);
  }, [latestRows, rowsPage]);

  const processReceiveRows = useMemo(() => ensureArray(db[receiveRowsKey]), [db, process, receiveRowsKey]);
  const processReceiveTotals = useMemo(() => ensureArray(db[receiveTotalsKey]), [db, process, receiveTotalsKey]);
  const totalProcessUnits = useMemo(() => processReceiveTotals.reduce((sum, entry) => sum + Number(entry[receiveUnitField] || 0), 0), [processReceiveTotals, receiveUnitField]);

  if (!isCutter) {
    if (isHolo) {
      return (
        <HoloReceiveView
          db={db}
          cls={cls}
          refreshDb={refreshDb}
          processReceiveRows={processReceiveRows}
          processReceiveTotals={processReceiveTotals}
          totalProcessUnits={totalProcessUnits}
          unitLabelPlural={unitLabelPlural}
        />
      );
    }
    if (isConing) {
      return (
        <ConingReceiveView
          db={db}
          cls={cls}
          refreshDb={refreshDb}
          processReceiveRows={processReceiveRows}
          processReceiveTotals={processReceiveTotals}
          totalProcessUnits={totalProcessUnits}
          unitLabelPlural={unitLabelPlural}
        />
      );
    }
    const rowUnitField = 'coneCount';
    const rowWeightField = 'coneWeight';
    return (
      <div className="space-y-6">
        <Section title={`Receive from ${label}`}>
          <div className="text-sm text-slate-400">
            Manual receive entries for {label} are recorded here.
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Total {unitLabelPlural}: {totalProcessUnits}
          </div>
        </Section>

        <Section title={`Latest ${unitLabelPlural}`}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className={`text-left ${cls.muted}`}>
                <tr>
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Lot</th>
                  <th className="py-2 pr-2 text-right">{unitLabelPlural}</th>
                <th className="py-2 pr-2 text-right">Weight (kg)</th>
                <th className="py-2 pr-2">Machine</th>
                <th className="py-2 pr-2">Operator</th>
                <th className="py-2 pr-2">Notes</th>
              </tr>
            </thead>
            <tbody>
                {processReceiveRows.length === 0 ? (
                  <tr>
                    <td className="py-3 pr-2" colSpan={8}>No receive records yet.</td>
                  </tr>
                ) : (
                  processReceiveRows.map((row) => {
                    const units = Number(row[rowUnitField] || 0);
                    const weightValue = row[rowWeightField];
                    return (
                      <tr key={row.id} className={`border-t ${cls.rowBorder}`}>
                        <td className="py-2 pr-2">{row.date || row.createdAt || '—'}</td>
                        <td className="py-2 pr-2 font-mono">{row.issue?.lotNo || row.issue?.barcode || '—'}</td>
                        <td className="py-2 pr-2 text-right">{units}</td>
                        <td className="py-2 pr-2 text-right">{weightValue == null ? '—' : formatKg(weightValue)}</td>
                        <td className="py-2 pr-2">{row.machineNo || '—'}</td>
                        <td className="py-2 pr-2">{row.operator?.name || '—'}</td>
                        <td className="py-2 pr-2">{row.notes || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title={`${unitLabel} totals by piece`}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className={`text-left ${cls.muted}`}>
                <tr>
                  <th className="py-2 pr-2">Piece</th>
                  <th className="py-2 pr-2 text-right">Total {unitLabelPlural}</th>
                  <th className="py-2 pr-2 text-right">Net weight (kg)</th>
                  <th className="py-2 pr-2 text-right">Wastage (kg)</th>
                </tr>
              </thead>
              <tbody>
                {processReceiveTotals.length === 0 ? (
                  <tr>
                    <td className="py-3 pr-2" colSpan={4}>No piece totals recorded yet.</td>
                  </tr>
                ) : (
                  processReceiveTotals.map((row) => (
                    <tr key={row.pieceId} className={`border-t ${cls.rowBorder}`}>
                      <td className="py-2 pr-2 font-mono">{row.pieceId}</td>
                      <td className="py-2 pr-2 text-right">{row[receiveUnitField] || 0}</td>
                      <td className="py-2 pr-2 text-right">{formatKg(row.totalNetWeight || 0)}</td>
                      <td className="py-2 pr-2 text-right">{formatKg(row.wastageNetWeight || 0)}</td>
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
      <Section
        title="Receive from machine"
        actions={mode === 'csv' && (selectedFile || previewData) ? (
          <SecondaryButton onClick={clearSelection}>Clear selection</SecondaryButton>
        ) : null}
      >
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${mode === 'manual' ? cls.navActive : `${cls.cardBorder} ${cls.navHover}`}`}
          >
            Manual entry
          </button>
          <button
            type="button"
            onClick={() => setMode('csv')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${mode === 'csv' ? cls.navActive : `${cls.cardBorder} ${cls.navHover}`}`}
          >
            CSV upload
          </button>
        </div>
        {mode === 'csv' ? (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:gap-4">
              <div className="w-full md:w-1/2">
                <label
                  htmlFor="receive-file"
                  className={`block w-full cursor-pointer rounded-lg p-4 md:p-6 border ${cls.cardBorder} ${cls.cardBg} flex items-center justify-between gap-4 ${dragActive ? 'ring-2 ring-offset-2' : ''}`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className={`${cls.muted} text-sm md:text-base`}>Drop CSV here or click to choose</div>
                  <div className="text-sm font-mono">{selectedFile ? selectedFile.name : 'No file chosen'}</div>
                  <input
                    id="receive-file"
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setSelectedFile(file);
                      setPreviewData(null);
                      setActionError(null);
                      setActionIssues([]);
                    }}
                  />
                </label>
              </div>
              <div className="flex items-center gap-2 mt-3 md:mt-0">
                <Button onClick={handlePreview} disabled={!selectedFile || previewing} className="border-2" style={{ borderColor: brand?.gold }}>
                  {previewing ? 'Previewing…' : previewData ? 'Re-preview' : 'Preview CSV'}
                </Button>
                {selectedFile && (
                  <Pill>{selectedFile.name} · {formatBytes(selectedFile.size)}</Pill>
                )}
              </div>
            </div>

            {actionError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm">
                <div className="font-medium">{actionError}</div>
                {renderIssues(actionIssues)}
              </div>
            )}

            {previewData && (
              <SummaryCard
                title="Preview"
                summary={previewData}
                cls={cls}
                actions={(
                  <>
                    <Button onClick={handleConfirmImport} disabled={confirming}>
                      {confirming ? 'Saving…' : 'Continue & save'}
                    </Button>
                    <SecondaryButton onClick={() => { setPreviewData(null); }} disabled={confirming}>Cancel preview</SecondaryButton>
                  </>
                )}
              />
            )}

            {importResult?.summary && (
              <SummaryCard
                title="Last upload summary"
                summary={importResult.summary}
                cls={cls}
                meta={importResult.upload}
              />
            )}
          </div>
        ) : (
          <ManualReceiveForm
            db={db}
            inboundPieceMap={inboundPieceMap}
            receiveTotalsMap={receiveTotalsMap}
            refreshDb={refreshDb}
            onIssueToMachine={onIssueToMachine}
            cls={cls}
          />
        )}
      </Section>

      <Section title="Piece receive totals (top 50 by pending)">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className={`text-left ${cls.muted}`}>
              <tr>
                <th className="py-2 pr-2">Piece</th>
                <th className="py-2 pr-2">Lot</th>
                <th className="py-2 pr-2 text-right">Inbound (kg)</th>
                <th className="py-2 pr-2 text-right">Received (kg)</th>
                <th className="py-2 pr-2 text-right">Pending (kg)</th>
                <th className="py-2 pr-2 text-right">Total {unitLabelPlural}</th>
                <th className="py-2 pr-2">Bobbin</th>
              </tr>
            </thead>
            <tbody>
            {limitedKnownPieces.length === 0 ? (
                <tr>
                  <td className="py-3 pr-2" colSpan={7}>No receive data yet.</td>
                </tr>
              ) : (
                limitedKnownPieces.map((piece) => (
                <tr key={piece.pieceId} className={`border-t ${cls.rowBorder}`}>
                  <td className="py-2 pr-2 font-mono">{piece.pieceId}</td>
                  <td className="py-2 pr-2 font-mono">{piece.lotNo || '—'}</td>
                  <td className="py-2 pr-2 text-right">{piece.inboundWeight == null ? '—' : formatKg(piece.inboundWeight)}</td>
                  <td className="py-2 pr-2 text-right">{formatKg(piece.receivedWeight)}</td>
                  <td className="py-2 pr-2 text-right">{piece.pendingWeight == null ? '—' : formatKg(piece.pendingWeight)}</td>
                      <td className="py-2 pr-2 text-right">{piece.totalUnits || 0}</td>
                  <td className="py-2 pr-2">{piece.bobbinName}</td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2">
          <Pagination total={knownPieces.length} page={pieceReceivePage} setPage={setPieceReceivePage} pageSize={pageSize} />
        </div>
      </Section>

          {orphanPieces.length > 0 && (
        <Section title="Pieces in receive data without inbound match">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className={`text-left ${cls.muted}`}>
                  <tr>
                    <th className="py-2 pr-2">Piece</th>
                    <th className="py-2 pr-2 text-right">Received (kg)</th>
                    <th className="py-2 pr-2 text-right">Total {unitLabelPlural}</th>
                  </tr>
              </thead>
              <tbody>
                {pagedOrphanPieces.map((piece) => (
                  <tr key={piece.pieceId} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2 font-mono">{piece.pieceId}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(piece.receivedWeight)}</td>
                    <td className="py-2 pr-2 text-right">{piece.totalUnits || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2">
            <Pagination total={orphanPieces.length} page={orphanPage} setPage={setOrphanPage} pageSize={pageSize} />
          </div>
        </Section>
      )}

          <Section title="Recent uploads">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className={`text-left ${cls.muted}`}>
              <tr>
                <th className="py-2 pr-2">Uploaded</th>
                <th className="py-2 pr-2">Filename</th>
                <th className="py-2 pr-2 text-right">Rows</th>
              </tr>
            </thead>
            <tbody>
              {pagedRecentUploads.length === 0 ? (
                <tr>
                  <td className="py-3 pr-2" colSpan={3}>No uploads yet.</td>
                </tr>
              ) : (
                pagedRecentUploads.map((upload) => (
                  <tr key={upload.id} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2">{formatDateTime(upload.uploadedAt)}</td>
                    <td className="py-2 pr-2 break-all">{upload.originalFilename}</td>
                    <td className="py-2 pr-2 text-right">{upload.rowCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2">
          <Pagination total={recentUploads.length} page={uploadsPage} setPage={setUploadsPage} pageSize={pageSize} />
        </div>
      </Section>

      <Section title="Latest received rows (max 50)">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className={`text-left ${cls.muted}`}>
              <tr>
                <th className="py-2 pr-2">Piece</th>
                <th className="py-2 pr-2">Cut</th>
                <th className="py-2 pr-2">Barcode</th>
                <th className="py-2 pr-2">Machine</th>
                <th className="py-2 pr-2">Employee</th>
                <th className="py-2 pr-2 text-right">Net Wt (kg)</th>
                <th className="py-2 pr-2 text-right">Bobbin qty</th>
                <th className="py-2 pr-2">Bobbin</th>
                <th className="py-2 pr-2">CSV Date</th>
                <th className="py-2 pr-2">Imported</th>
              </tr>
            </thead>
            <tbody>
              {pagedLatestRows.length === 0 ? (
                <tr>
                  <td className="py-3 pr-2" colSpan={10}>No rows imported yet.</td>
                </tr>
              ) : (
                pagedLatestRows.map((row) => {
                  const upload = uploadLookup.get(row.uploadId);
                  // Use bobbin relation if available, fallback to pcsTypeName for backward compatibility
                  const bobbinName = row.bobbin?.name || row.pcsTypeName || '—';
                  const cutLabel = row.cutMaster?.name || row.cut || '—';
                  return (
                    <tr key={row.id} className={`border-t ${cls.rowBorder}`}>
                      <td className="py-2 pr-2 font-mono">{row.pieceId}</td>
                      <td className="py-2 pr-2">{cutLabel}</td>
                      <td className="py-2 pr-2 font-mono">{row.barcode || '—'}</td>
                      <td className="py-2 pr-2">{row.machineNo || '—'}</td>
                      <td className="py-2 pr-2">{row.employee || '—'}</td>
                      <td className="py-2 pr-2 text-right">{row.netWt == null ? '—' : formatKg(row.netWt)}</td>
                      <td className="py-2 pr-2 text-right">{row.bobbinQuantity == null ? '—' : row.bobbinQuantity}</td>
                      <td className="py-2 pr-2">{bobbinName}</td>
                      <td className="py-2 pr-2">{row.date || '—'}</td>
                      <td className="py-2 pr-2">{formatDateTime(upload?.uploadedAt || row.createdAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2">
          <Pagination total={latestRows.length} page={rowsPage} setPage={setRowsPage} pageSize={pageSize} />
        </div>
      </Section>
    </div>
  );
}

function ConingReceiveView({ db, cls, refreshDb, processReceiveRows, processReceiveTotals, totalProcessUnits, unitLabelPlural }) {
  const [issueBarcode, setIssueBarcode] = useState('');
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [receiveDate, setReceiveDate] = useState(todayISO());
  const [cart, setCart] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const issueByBarcode = useMemo(() => {
    const map = new Map();
    ensureArray(db.issue_to_coning_machine).forEach((issue) => {
      if (issue?.barcode) map.set(issue.barcode.toUpperCase(), issue);
    });
    return map;
  }, [db.issue_to_coning_machine]);
  const coneTypeMap = useMemo(() => {
    const map = new Map();
    ensureArray(db.cone_types).forEach((ct) => { if (ct?.id) map.set(ct.id, ct); });
    return map;
  }, [db.cone_types]);
  const boxMap = useMemo(() => {
    const map = new Map();
    ensureArray(db.boxes).forEach((box) => { if (box?.id) map.set(box.id, box); });
    return map;
  }, [db.boxes]);
  const operators = ensureArray(db.operators);
  const helpers = ensureArray(db.helpers); // kept for other views; not used in coning

  const perConeNetGram = selectedIssue ? Number(selectedIssue.requiredPerConeNetWeight || 0) : 0;
  const coneTypeWeightKg = useMemo(() => {
    if (!selectedIssue) return 0;
    const coneTypeId = Array.isArray(selectedIssue.receivedRowRefs) && selectedIssue.receivedRowRefs.length
      ? selectedIssue.receivedRowRefs[0].coneTypeId
      : null;
    if (!coneTypeId) return 0;
    const ct = coneTypeMap.get(coneTypeId);
    return Number(ct?.weight || 0);
  }, [selectedIssue, coneTypeMap]);
  const coneTypeLabel = useMemo(() => {
    if (!selectedIssue) return 'n/a';
    const coneTypeId = Array.isArray(selectedIssue.receivedRowRefs) && selectedIssue.receivedRowRefs.length
      ? selectedIssue.receivedRowRefs[0].coneTypeId
      : null;
    if (!coneTypeId) return 'n/a';
    const ct = coneTypeMap.get(coneTypeId);
    if (!ct) return coneTypeId;
    const wt = Number(ct.weight || 0);
    return wt > 0 ? `${ct.name} (${formatKg(wt)} kg/pc)` : ct.name;
  }, [selectedIssue, coneTypeMap]);

  const addCartRow = () => {
    const defaultOperatorId = selectedIssue?.operatorId || '';
    setCart((prev) => [...prev, { id: uid(), coneCount: '', boxId: '', grossWeight: '', operatorId: defaultOperatorId, notes: '' }]);
  };

  const resetForm = () => {
    setSelectedIssue(null);
    setCart([]);
    setIssueBarcode('');
    setReceiveDate(todayISO());
  };

  const lookupIssue = () => {
    const normalized = (issueBarcode || '').trim().toUpperCase();
    const issue = issueByBarcode.get(normalized);
    if (!issue) {
      setError('Issue barcode not found. Check and try again.');
      setSelectedIssue(null);
      setCart([]);
      return;
    }
    setError('');
    setSelectedIssue(issue);
    const defaultOperatorId = issue.operatorId || '';
    setCart([{ id: uid(), coneCount: '', boxId: '', grossWeight: '', operatorId: defaultOperatorId, notes: '' }]);
  };

  const updateCartRow = (id, field, value) => {
    setCart((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const removeCartRow = (id) => {
    setCart((prev) => prev.filter((row) => row.id !== id));
  };

  const calcMetrics = (row) => {
    const cones = Number(row.coneCount || 0);
    const boxWeightKg = row.boxId ? Number(boxMap.get(row.boxId)?.weight || 0) : 0;
    const coneTare = coneTypeWeightKg > 0 && cones > 0 ? coneTypeWeightKg * cones : 0;
    const tare = boxWeightKg + coneTare;
    const gross = Number(row.grossWeight || 0);
    const net = gross - tare;
    return { netKg: net, tareKg: tare, grossKg: gross, boxWeightKg, coneTareKg: coneTare };
  };
  const operatorLabel = useMemo(() => {
    if (!selectedIssue?.operatorId) return '—';
    const found = operators.find((op) => op.id === selectedIssue.operatorId);
    return found?.name || selectedIssue.operatorId;
  }, [operators, selectedIssue]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedIssue) {
      setError('Scan an issue barcode first.');
      return;
    }
    if (cart.length === 0) {
      setError('Add at least one receive crate.');
      return;
    }
    if (perConeNetGram <= 0) {
      setError('Required per-cone weight missing on issue. Edit issue or re-issue.');
      return;
    }
    const invalidRow = cart.find((row) => !row.boxId || Number(row.coneCount) <= 0 || Number(row.grossWeight) <= 0);
    if (invalidRow) {
      setError('Enter cone quantity, gross weight, and select box for each crate.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      for (const row of cart) {
        const { netKg, tareKg, grossKg } = calcMetrics(row);
        if (!Number.isFinite(netKg) || netKg < 0) {
          setError('Gross weight must exceed tare weight for each crate.');
          setSaving(false);
          return;
        }
        await api.manualReceiveFromConingMachine({
          issueId: selectedIssue.id,
          pieceId: selectedIssue.id,
          coneCount: Number(row.coneCount),
          boxId: row.boxId,
          grossWeight: grossKg,
          date: receiveDate,
          operatorId: selectedIssue.operatorId || null,
          notes: row.notes || null,
        });
      }
      alert('Receive entries saved');
      await refreshDb();
      resetForm();
    } catch (err) {
      console.error('Failed to save coning receive', err);
      setError(err.message || 'Failed to save receive');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section title="Receive from Coning (Cones)">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className={`text-xs ${cls.muted}`}>Issue barcode</label>
              <Input
                value={issueBarcode}
                onChange={(e) => setIssueBarcode(e.target.value)}
                placeholder="Scan issue barcode (CN-...)"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookupIssue(); } }}
              />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={lookupIssue} disabled={!issueBarcode.trim()}>Load issue</Button>
            </div>
            <div>
              <label className={`text-xs ${cls.muted}`}>Receive date</label>
              <Input type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
            </div>
            <div className="flex items-end text-xs text-slate-500">
              {selectedIssue ? `Lot ${selectedIssue.lotNo} · Expected cones ${selectedIssue.expectedCones || 0}` : 'Awaiting barcode scan'}
            </div>
          </div>

          {selectedIssue && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-xs">
                <Pill>Lot: {selectedIssue.lotNo}</Pill>
                <Pill>Required per cone: {perConeNetGram} g</Pill>
                <Pill>Cone type: {coneTypeLabel}</Pill>
                <Pill>Operator: {operatorLabel}</Pill>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className={`text-left ${cls.muted}`}>
                    <tr>
                      <th className="py-2 pr-2">Crate</th>
                      <th className="py-2 pr-2">Box</th>
                      <th className="py-2 pr-2 text-right">Cones</th>
                      <th className="py-2 pr-2 text-right">Gross (kg)</th>
                      <th className="py-2 pr-2 text-right">Tare (kg)</th>
                      <th className="py-2 pr-2 text-right">Net (kg)</th>
                      <th className="py-2 pr-2">Notes</th>
                      <th className="py-2 pr-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.length === 0 ? (
                      <tr><td className="py-3 pr-2" colSpan={8}>Add a crate to start.</td></tr>
                    ) : (
                      cart.map((row, idx) => {
                        const metrics = calcMetrics(row);
                        return (
                          <tr key={row.id} className={`border-t ${cls.rowBorder}`}>
                            <td className="py-2 pr-2">#{idx + 1}</td>
                            <td className="py-2 pr-2">
                              <Select value={row.boxId} onChange={(e) => updateCartRow(row.id, 'boxId', e.target.value)}>
                                <option value="">Select</option>
                                {ensureArray(db.boxes).map((box) => (
                                  <option key={box.id} value={box.id}>{box.name}</option>
                                ))}
                              </Select>
                              <div className={`text-xs ${cls.muted}`}>Box wt: {formatKg(metrics.boxWeightKg || 0)}</div>
                            </td>
                            <td className="py-2 pr-2 text-right">
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={row.coneCount}
                                onChange={(e) => updateCartRow(row.id, 'coneCount', e.target.value)}
                              />
                            </td>
                            <td className="py-2 pr-2 text-right">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={row.grossWeight}
                                onChange={(e) => updateCartRow(row.id, 'grossWeight', e.target.value)}
                              />
                            </td>
                            <td className="py-2 pr-2 text-right font-mono">{formatKg(metrics.tareKg || 0)}</td>
                            <td className="py-2 pr-2 text-right font-mono">{formatKg(metrics.netKg || 0)}</td>
                            <td className="py-2 pr-2">
                              <Input value={row.notes} onChange={(e) => updateCartRow(row.id, 'notes', e.target.value)} placeholder="Optional" />
                            </td>
                            <td className="py-2 pr-2 text-right">
                              <button type="button" className="text-sm text-red-500 underline" onClick={() => removeCartRow(row.id)}>Remove</button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2">
                <Button type="button" onClick={addCartRow} disabled={!selectedIssue}>Add crate</Button>
                <Button type="submit" disabled={saving || cart.length === 0}>{saving ? 'Saving…' : 'Save receive'}</Button>
                <Pill>Total expected: {selectedIssue.expectedCones || 0} cones</Pill>
              </div>
            </div>
          )}
          {error && <div className="text-xs text-red-500">{error}</div>}
        </form>
      </Section>

      <Section title="Recent receives (Coning)">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className={`text-left ${cls.muted}`}>
              <tr>
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Receive barcode</th>
                <th className="py-2 pr-2">Issue barcode</th>
                <th className="py-2 pr-2">Lot</th>
                <th className="py-2 pr-2 text-right">Cones</th>
                <th className="py-2 pr-2 text-right">Gross (kg)</th>
                <th className="py-2 pr-2 text-right">Tare (kg)</th>
                <th className="py-2 pr-2 text-right">Net (kg)</th>
                <th className="py-2 pr-2">Box</th>
                <th className="py-2 pr-2">Operator</th>
                <th className="py-2 pr-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {processReceiveRows.length === 0 ? (
                <tr><td className="py-3 pr-2" colSpan={11}>No receive records yet.</td></tr>
              ) : (
                processReceiveRows.map((row) => (
                  <tr key={row.id} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2">{row.date || row.createdAt || '—'}</td>
                    <td className="py-2 pr-2 font-mono">{row.barcode || '—'}</td>
                    <td className="py-2 pr-2 font-mono">{row.issue?.barcode || '—'}</td>
                    <td className="py-2 pr-2">{row.issue?.lotNo || '—'}</td>
                    <td className="py-2 pr-2 text-right">{row.coneCount || 0}</td>
                    <td className="py-2 pr-2 text-right">{row.grossWeight == null ? '—' : formatKg(row.grossWeight)}</td>
                    <td className="py-2 pr-2 text-right">{row.tareWeight == null ? '—' : formatKg(row.tareWeight)}</td>
                    <td className="py-2 pr-2 text-right">{row.netWeight == null ? '—' : formatKg(row.netWeight)}</td>
                    <td className="py-2 pr-2">{row.box?.name || '—'}</td>
                    <td className="py-2 pr-2">{row.operator?.name || '—'}</td>
                    <td className="py-2 pr-2">{row.notes || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Totals">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className={`text-left ${cls.muted}`}>
              <tr>
                <th className="py-2 pr-2">Piece/Issue</th>
                <th className="py-2 pr-2 text-right">Total cones</th>
                <th className="py-2 pr-2 text-right">Net (kg)</th>
              </tr>
            </thead>
            <tbody>
              {processReceiveTotals.length === 0 ? (
                <tr><td className="py-3 pr-2" colSpan={3}>No totals yet.</td></tr>
              ) : (
                processReceiveTotals.map((row) => (
                  <tr key={row.pieceId} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2 font-mono">{row.pieceId}</td>
                    <td className="py-2 pr-2 text-right">{row.totalCones || 0}</td>
                    <td className="py-2 pr-2 text-right">{row.totalNetWeight == null ? '—' : formatKg(row.totalNetWeight)}</td>
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

function HoloReceiveView({ db, cls, refreshDb, processReceiveRows, processReceiveTotals, totalProcessUnits, unitLabelPlural }) {
  return (
    <div className="space-y-6">
      <Section title="Receive from Holo (Rolls)">
        <HoloReceiveForm db={db} cls={cls} refreshDb={refreshDb} />
      </Section>

      <Section title={`Latest ${unitLabelPlural}`}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className={`text-left ${cls.muted}`}>
              <tr>
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Lot</th>
                <th className="py-2 pr-2">Barcode</th>
                <th className="py-2 pr-2 text-right">Rolls</th>
                <th className="py-2 pr-2 text-right">Net (kg)</th>
                <th className="py-2 pr-2 text-right">Gross (kg)</th>
                <th className="py-2 pr-2 text-right">Tare (kg)</th>
                <th className="py-2 pr-2">Roll type</th>
                <th className="py-2 pr-2">Machine</th>
                <th className="py-2 pr-2">Operator</th>
                <th className="py-2 pr-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {processReceiveRows.length === 0 ? (
                <tr>
                  <td className="py-3 pr-2" colSpan={10}>No receive records yet.</td>
                </tr>
              ) : (
                processReceiveRows.map((row) => {
                  const units = Number(row.rollCount || 0);
                  const netVal = row.rollWeight;
                  const grossVal = row.grossWeight;
                  const tareVal = row.tareWeight;
                  return (
                    <tr key={row.id} className={`border-t ${cls.rowBorder}`}>
                      <td className="py-2 pr-2">{row.date || row.createdAt || '—'}</td>
                      <td className="py-2 pr-2 font-mono">{row.issue?.lotNo || '—'}</td>
                      <td className="py-2 pr-2 font-mono">{row.barcode || '—'}</td>
                      <td className="py-2 pr-2 text-right">{units}</td>
                      <td className="py-2 pr-2 text-right">{netVal == null ? '—' : formatKg(netVal)}</td>
                      <td className="py-2 pr-2 text-right">{grossVal == null ? '—' : formatKg(grossVal)}</td>
                      <td className="py-2 pr-2 text-right">{tareVal == null ? '—' : formatKg(tareVal)}</td>
                      <td className="py-2 pr-2">{row.rollType?.name || '—'}</td>
                      <td className="py-2 pr-2">{row.machineNo || '—'}</td>
                      <td className="py-2 pr-2">{row.operator?.name || '—'}</td>
                      <td className="py-2 pr-2">{row.notes || '—'}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Piece totals">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className={`text-left ${cls.muted}`}>
              <tr>
                <th className="py-2 pr-2">Piece</th>
                <th className="py-2 pr-2 text-right">Total {unitLabelPlural}</th>
                <th className="py-2 pr-2 text-right">Net weight (kg)</th>
                <th className="py-2 pr-2 text-right">Wastage (kg)</th>
              </tr>
            </thead>
            <tbody>
              {processReceiveTotals.length === 0 ? (
                <tr>
                  <td className="py-3 pr-2" colSpan={4}>No piece totals recorded yet.</td>
                </tr>
              ) : (
                processReceiveTotals.map((row) => (
                  <tr key={row.pieceId} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2 font-mono">{row.pieceId}</td>
                    <td className="py-2 pr-2 text-right">{row.totalRolls || 0}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(row.totalNetWeight || 0)}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(row.wastageNetWeight || 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-xs text-slate-500">Total {unitLabelPlural.toLowerCase()}: {totalProcessUnits}</div>
      </Section>
    </div>
  );
}

function HoloReceiveForm({ db, cls, refreshDb }) {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [issue, setIssue] = useState(null);
  const [selectedCrateId, setSelectedCrateId] = useState('');
  const [selectedPieceId, setSelectedPieceId] = useState('');
  const [rollTypeId, setRollTypeId] = useState('');
  const [rollCount, setRollCount] = useState('');
  const [grossWeight, setGrossWeight] = useState('');
  const [date, setDate] = useState(todayISO());
  const [machineId, setMachineId] = useState('');
  const [boxId, setBoxId] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const rollTypes = useMemo(() => (db.rollTypes || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })), [db.rollTypes]);
  const crateOptions = issue?.crates || [];
  const selectedCrate = crateOptions.find((c) => c.rowId === selectedCrateId) || null;
  const pieceOptions = useMemo(() => {
    const ids = issue?.pieceIds || [];
    return ids.map((id) => ({
      id,
      lotNo: issue?.lotNo || issue?.lotno || issue?.lot_no || null,
    }));
  }, [issue]);
  const workers = useMemo(() => {
    if (Array.isArray(db.workers) && db.workers.length > 0) return db.workers;
    const merged = [];
    (db.operators || []).forEach((op) => merged.push({ ...op, role: 'operator' }));
    (db.helpers || []).forEach((helper) => {
      if (!merged.some((w) => w.id === helper.id)) merged.push({ ...helper, role: 'helper' });
    });
    return merged;
  }, [db.workers, db.operators, db.helpers]);
  const operatorOptions = useMemo(() => workers.filter((w) => (w.role || 'operator') === 'operator'), [workers]);
  const machineOptions = useMemo(() => (db.machines || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })), [db.machines]);
  const boxes = useMemo(() => (db.boxes || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })), [db.boxes]);
  const rollType = rollTypes.find((r) => r.id === rollTypeId) || null;
  const rollTypeWeight = rollType && Number.isFinite(rollType.weight) ? Number(rollType.weight) : null;
  const rollCountNum = rollCount === '' ? NaN : Number(rollCount);
  const grossNum = grossWeight === '' ? NaN : Number(grossWeight);
  const selectedBox = boxes.find((b) => b.id === boxId) || null;
  const boxWeight = selectedBox && Number.isFinite(selectedBox.weight) ? Number(selectedBox.weight) : null;
  const crateTare = selectedCrate ? Number(selectedCrate.crateTare || 0) : 0;
  const tareWeight = Number.isFinite(rollCountNum) && rollCountNum > 0 && rollTypeWeight != null
    ? (rollCountNum * rollTypeWeight) + (boxWeight || 0)
    : null;
  
  // Net weight is strictly derived from Gross - Tare
  const netWeight = Number.isFinite(grossNum) && tareWeight != null
    ? grossNum - tareWeight
    : null;

  const disableSave = saving
    || !issue
    || !selectedPieceId
    || !selectedCrateId
    || !rollTypeId
    || !boxId
    || !Number.isInteger(rollCountNum) || rollCountNum <= 0
    || !Number.isFinite(grossNum) || grossNum <= 0
    || !machineId
    || tareWeight == null
    || netWeight == null
    || netWeight <= 0;

  useEffect(() => {
    if (!selectedCrate) return;
    if (selectedCrate.pieceId && selectedCrate.pieceId !== selectedPieceId) {
      setSelectedPieceId(selectedCrate.pieceId);
    }
  }, [selectedCrate, selectedPieceId]);

  async function handleScanIssue(e) {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    setScanLoading(true);
    setFormError('');
    try {
      const result = await api.getIssueByHoloBarcode(barcodeInput.trim());
      setIssue(result);
      setSelectedCrateId(result.crates?.[0]?.rowId || '');
      setSelectedPieceId(result.crates?.[0]?.pieceId || (result.pieceIds?.[0] || ''));
      setDate(result.date || todayISO());
      setMachineId(result.machineId || '');
      setOperatorId(result.operatorId || '');
    } catch (err) {
      setIssue(null);
      setSelectedCrateId('');
      setSelectedPieceId('');
      setMachineId('');
      setOperatorId('');
      setFormError(err.message || 'Failed to load issue');
    } finally {
      setScanLoading(false);
      setBarcodeInput('');
    }
  }

  async function handleSave() {
    if (disableSave) return;
    setSaving(true);
    setFormError('');
    try {
      await api.manualReceiveFromHoloMachine({
        issueId: issue.id,
        pieceId: selectedPieceId,
        rollCount: rollCountNum,
        rollTypeId,
        boxId,
        grossWeight: grossNum,
        crateTareWeight: 0,
        // rollWeight is removed; backend derives it from gross - tare
        date,
        machineNo: machineOptions.find((m) => m.id === machineId)?.name || null,
        operatorId: operatorId || null,
        notes: notes || null,
      });
      alert('Receive entry saved');
      setRollCount('');
      setGrossWeight('');
      setNotes('');
      setMachineId('');
      setBoxId('');
      setOperatorId('');
      await refreshDb();
    } catch (err) {
      setFormError(err.message || 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleScanIssue} className="grid gap-3 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className={`text-xs ${cls.muted}`}>Scan issue barcode</label>
          <Input value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} placeholder="Scan HLO- barcode" disabled={scanLoading} />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={scanLoading || !barcodeInput.trim()}>{scanLoading ? 'Loading…' : 'Load issue'}</Button>
        </div>
      </form>

      {issue ? (
        <div className={`rounded-xl border ${cls.cardBorder} ${cls.cardBg} p-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill>Lot: {issue.lotNo}</Pill>
            <Pill>Item: {issue.itemId}</Pill>
            <Pill>Bobbins issued: {issue.metallicBobbins || 0}</Pill>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label className={`text-xs ${cls.muted}`}>Crate / piece</label>
              <Select value={selectedCrateId} onChange={(e) => setSelectedCrateId(e.target.value)}>
                <option value="">Select crate</option>
                {crateOptions.map((crate) => (
                  <option key={crate.rowId} value={crate.rowId}>
                    {crate.barcode || crate.rowId} · Piece {crate.pieceId || '—'}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className={`text-xs ${cls.muted}`}>Piece</label>
              <Select value={selectedPieceId} onChange={(e) => setSelectedPieceId(e.target.value)}>
                <option value="">{issue.pieceIds?.length ? 'Select piece' : 'No linked pieces'}</option>
                {pieceOptions.map((piece) => (
                  <option key={piece.id} value={piece.id}>{piece.id} {piece.lotNo ? `· Lot ${piece.lotNo}` : ''}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div>
              <label className={`text-xs ${cls.muted}`}>Roll type</label>
              <Select value={rollTypeId} onChange={(e) => setRollTypeId(e.target.value)}>
                <option value="">Select</option>
                {rollTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>{rt.name} {rt.weight != null ? `(${formatKg(rt.weight)} kg each)` : ''}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className={`text-xs ${cls.muted}`}>Single roll weight</label>
              <div className="h-11 flex items-center px-3 rounded-lg border border-slate-600/40 bg-slate-900/40 text-sm">
                {rollTypeWeight != null ? `${formatKg(rollTypeWeight)} kg` : <span className={cls.muted}>Set on roll type</span>}
              </div>
            </div>
            <div>
              <label className={`text-xs ${cls.muted}`}>Rolls produced</label>
              <Input type="number" min="1" step="1" value={rollCount} onChange={(e) => setRollCount(e.target.value)} placeholder="e.g. 12" />
            </div>
            <div>
              <label className={`text-xs ${cls.muted}`}>Gross weight (kg)</label>
              <Input type="number" min="0" step="0.001" value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} placeholder="Weighed gross" />
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div>
              <label className={`text-xs ${cls.muted}`}>Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className={`text-xs ${cls.muted}`}>Machine</label>
              <Select value={machineId} onChange={(e) => setMachineId(e.target.value)}>
                <option value="">Select machine</option>
                {machineOptions.map((machine) => (
                  <option key={machine.id} value={machine.id}>{machine.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className={`text-xs ${cls.muted}`}>Operator</label>
              <Select value={operatorId} onChange={(e) => setOperatorId(e.target.value)}>
                <option value="">Select</option>
                {operatorOptions.map((op) => <option key={op.id} value={op.id}>{op.name}</option>)}
              </Select>
            </div>
            <div>
              <label className={`text-xs ${cls.muted}`}>Box</label>
              <Select value={boxId} onChange={(e) => setBoxId(e.target.value)}>
                <option value="">Select box</option>
                {boxes.map((box) => (
                  <option key={box.id} value={box.id}>{box.name} {box.weight != null ? `(${formatKg(box.weight)} kg)` : ''}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mt-4">
            <label className={`text-xs ${cls.muted}`}>Notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional remarks" />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className={`rounded-xl border ${cls.rowBorder} p-3`}>
              <div className="text-xs uppercase font-semibold">Tare weight</div>
              <div className="text-2xl font-semibold">{tareWeight != null ? `${formatKg(tareWeight)} kg` : '—'}</div>
              <div className={`text-xs ${cls.muted}`}>= Rolls × single roll + box {formatKg(boxWeight || 0)} kg</div>
            </div>
            <div className={`rounded-xl border ${cls.rowBorder} p-3`}>
              <div className="text-xs uppercase font-semibold">Net weight</div>
              <div className={`text-2xl font-semibold ${netWeight != null && netWeight <= 0 ? 'text-red-400' : ''}`}>{netWeight != null ? `${formatKg(netWeight)} kg` : '—'}</div>
              <div className={`text-xs ${cls.muted}`}>Gross minus tare</div>
            </div>
          </div>

          {formError && (
            <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {formError}
            </div>
          )}

          <div className="mt-4">
            <Button type="button" onClick={handleSave} disabled={disableSave}>
              {saving ? 'Saving…' : 'Save receive'}
            </Button>
          </div>
        </div>
      ) : (
        <div className={`text-sm ${cls.muted}`}>Scan an issue barcode to start a Holo receive entry.</div>
      )}
    </div>
  );
}

function ManualReceiveForm({ db, inboundPieceMap, receiveTotalsMap, refreshDb, onIssueToMachine, cls }) {
  const [lotNo, setLotNo] = useState('');
  const [pieceId, setPieceId] = useState('');
  const [bobbinId, setBobbinId] = useState('');
  const [boxId, setBoxId] = useState('');
  const [bobbinQty, setBobbinQty] = useState('');
  const [grossWeight, setGrossWeight] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [helperId, setHelperId] = useState('');
  const [cutId, setCutId] = useState('');
  const [receiveDate, setReceiveDate] = useState(todayISO());
  const [markRemainingWastage, setMarkRemainingWastage] = useState(false);
  const [cart, setCart] = useState([]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [issueBarcodeInput, setIssueBarcodeInput] = useState('');
  const [currentIssueBarcode, setCurrentIssueBarcode] = useState('');
  const [issueLookupLoading, setIssueLookupLoading] = useState(false);
  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueModalData, setIssueModalData] = useState({
    date: todayISO(),
    machineId: '',
    operatorId: '',
    note: '',
    lotNo: '',
    pieceIds: [],
    itemId: null,
  });
  const [issuingPiece, setIssuingPiece] = useState(null);
  const [issuingFromModal, setIssuingFromModal] = useState(false);
  const [pieceCrateStats, setPieceCrateStats] = useState({});
  const [crateStatsVersion, setCrateStatsVersion] = useState(0);
  const receiveRows = useMemo(() => ensureArray(db.receive_from_cutter_machine_rows), [db.receive_from_cutter_machine_rows]);
  const pieceCrateIndexMap = useMemo(() => {
    const map = new Map();
    receiveRows.forEach((row) => {
      if (!row || !row.pieceId) return;
      const crateIndex = parseReceiveCrateIndex(row.barcode);
      if (!crateIndex) return;
      const currentMax = map.get(row.pieceId) || 0;
      if (crateIndex > currentMax) {
        map.set(row.pieceId, crateIndex);
      }
    });
    return map;
  }, [receiveRows]);

  useEffect(() => {
    setCrateStatsVersion((prev) => prev + 1);
  }, [db.receive_from_cutter_machine_rows]);

  const currentPieceCrateStats = pieceId ? pieceCrateStats[pieceId] : null;

  useEffect(() => {
    if (!pieceId) return;
    if (currentPieceCrateStats && currentPieceCrateStats.status === 'loading') return;
    if (currentPieceCrateStats && currentPieceCrateStats.version === crateStatsVersion && (currentPieceCrateStats.status === 'loaded' || currentPieceCrateStats.status === 'error')) {
      return;
    }
    let cancelled = false;
    setPieceCrateStats(prev => ({
      ...prev,
      [pieceId]: { ...(prev[pieceId] || {}), status: 'loading' },
    }));
    (async () => {
      try {
        const stats = await api.getReceiveCrateStats(pieceId);
        if (cancelled) return;
        setPieceCrateStats(prev => ({
          ...prev,
          [pieceId]: { ...stats, status: 'loaded', version: crateStatsVersion },
        }));
      } catch (err) {
        console.error('Failed to load crate stats', pieceId, err);
        if (cancelled) return;
        setPieceCrateStats(prev => ({
          ...prev,
          [pieceId]: {
            ...(prev[pieceId] || {}),
            status: 'error',
            version: crateStatsVersion,
            error: err.message || 'Failed to load crate history',
          },
        }));
      }
    })();
    return () => { cancelled = true; };
  }, [pieceId, crateStatsVersion, currentPieceCrateStats]);

  const workers = useMemo(() => {
    if (Array.isArray(db.workers) && db.workers.length > 0) {
      return db.workers.map(w => ({
        ...w,
        role: (w.role || 'operator').toLowerCase() === 'helper' ? 'helper' : 'operator',
      }));
    }
    const merged = [];
    (db.operators || []).forEach(op => merged.push({ ...op, role: 'operator' }));
    (db.helpers || []).forEach(helper => {
      if (!merged.some(w => w.id === helper.id)) merged.push({ ...helper, role: 'helper' });
    });
    return merged;
  }, [db.workers, db.operators, db.helpers]);

  const workerById = useMemo(() => {
    const map = new Map();
    workers.forEach(w => map.set(w.id, w));
    return map;
  }, [workers]);

  const operatorOptions = useMemo(() => workers.filter(w => w.role === 'operator'), [workers]);
  const helperOptions = useMemo(() => workers.filter(w => w.role === 'helper'), [workers]);

  const boxes = useMemo(() => (db.boxes || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })), [db.boxes]);
  const bobbins = useMemo(() => (db.bobbins || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })), [db.bobbins]);
  const cuts = useMemo(() => (db.cuts || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })), [db.cuts]);
  const machines = useMemo(() => (db.machines || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })), [db.machines]);
  const issuedPieceIds = useMemo(() => {
    const set = new Set();
    (db.issue_to_cutter_machine || []).forEach(record => {
      const list = Array.isArray(record.pieceIds)
        ? record.pieceIds
        : String(record.pieceIds || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);
      list.forEach(id => set.add(id));
    });
    return set;
  }, [db.issue_to_cutter_machine]);
  const itemNameById = useMemo(() => {
    const map = new Map();
    (db.items || []).forEach(item => map.set(item.id, item.name || ''));
    return map;
  }, [db.items]);
  const pendingByPiece = useMemo(() => {
    const map = new Map();
    (db.inbound_items || []).forEach(item => {
      const totals = receiveTotalsMap.get(item.id) || { received: 0, wastage: 0 };
      const inboundWeight = Number(item.weight || 0);
      const pending = Math.max(0, inboundWeight - Number(totals.received || 0) - Number(totals.wastage || 0));
      map.set(item.id, pending);
    });
    return map;
  }, [db.inbound_items, receiveTotalsMap]);
  const cartNetByPiece = useMemo(() => {
    const map = new Map();
    cart.forEach(entry => {
      map.set(entry.pieceId, (map.get(entry.pieceId) || 0) + entry.netWeight);
    });
    return map;
  }, [cart]);
  const wastageLockedPieces = useMemo(() => {
    const locked = new Set();
    cart.forEach(entry => {
      if (entry.markWastage) locked.add(entry.pieceId);
    });
    return locked;
  }, [cart]);

  const lotHasEligiblePiece = useMemo(() => {
    const set = new Set();
    (db.inbound_items || []).forEach(item => {
      const pending = pendingByPiece.get(item.id) ?? 0;
      const staged = cartNetByPiece.get(item.id) || 0;
      const remaining = Math.max(0, pending - staged);
      const statusVal = String(item.status || '').toLowerCase();
      if (remaining > 0 && statusVal === 'consumed' && item.lotNo) {
        set.add(item.lotNo);
      }
    });
    return set;
  }, [db.inbound_items, pendingByPiece, cartNetByPiece]);

  const lotOptions = useMemo(() => (
    (db.lots || [])
      .filter(lot => lotHasEligiblePiece.has(lot.lotNo))
      .map(lot => ({ ...lot, itemName: itemNameById.get(lot.itemId) || '' }))
      .sort((a, b) => (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true, sensitivity: 'base' }))
  ), [db.lots, itemNameById, lotHasEligiblePiece]);

  const pieceOptions = useMemo(() => {
    if (!lotNo) return [];
    return (db.inbound_items || [])
      .filter(item => item.lotNo === lotNo)
      .map(item => {
        const pending = pendingByPiece.get(item.id) ?? 0;
        const staged = cartNetByPiece.get(item.id) || 0;
        const remaining = Math.max(0, pending - staged);
        return { ...item, pendingWeight: remaining };
      })
      .filter(item => {
        const statusVal = String(item.status || '').toLowerCase();
        const statusOk = statusVal === 'consumed';
        return statusOk && item.pendingWeight > 0;
      })
      .sort((a, b) => {
        const seqDiff = (a.seq || 0) - (b.seq || 0);
        if (seqDiff !== 0) return seqDiff;
        return (a.id || '').localeCompare(b.id || '', undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [db.inbound_items, lotNo, pendingByPiece, cartNetByPiece]);

  useEffect(() => {
    setMarkRemainingWastage(false);
  }, [pieceId]);

  useEffect(() => {
    if (lotNo && !lotOptions.some(l => l.lotNo === lotNo)) {
      setLotNo('');
      setPieceId('');
    }
  }, [lotNo, lotOptions]);

  useEffect(() => {
    if (pieceId && !pieceOptions.some(p => p.id === pieceId)) {
      setPieceId('');
    }
  }, [pieceId, pieceOptions]);

  const selectedPiece = pieceId ? inboundPieceMap.get(pieceId) : null;
  const selectedBobbin = bobbins.find(b => b.id === bobbinId) || null;
  const selectedBox = boxes.find(b => b.id === boxId) || null;
  const selectedCut = cuts.find(c => c.id === cutId) || null;
  const quantityNum = bobbinQty === '' ? NaN : Number(bobbinQty);
  const grossNum = grossWeight === '' ? NaN : Number(grossWeight);
  const bobbinWeight = selectedBobbin && selectedBobbin.weight != null ? Number(selectedBobbin.weight) : null;
  const boxWeight = selectedBox ? Number(selectedBox.weight) : null;
  const tareWeight = Number.isFinite(boxWeight) && Number.isFinite(bobbinWeight) && Number.isFinite(quantityNum)
    ? boxWeight + bobbinWeight * quantityNum
    : null;
  const netWeight = Number.isFinite(grossNum) && tareWeight != null
    ? grossNum - tareWeight
    : null;

  const pendingSummary = useMemo(() => {
    if (!pieceId) return null;
    const inbound = inboundPieceMap.get(pieceId);
    if (!inbound) return null;
    const totals = receiveTotalsMap.get(pieceId) || { received: 0, wastage: 0 };
    const inboundWeight = Number(inbound.weight || 0);
    const received = Number(totals.received || 0);
    const wastage = Number(totals.wastage || 0);
    const pendingFromDb = Math.max(0, inboundWeight - received - wastage);
    const cartNetForPiece = cartNetByPiece.get(pieceId) || 0;
    return {
      pieceId,
      lotNo: inbound.lotNo,
      inboundWeight,
      received,
      wastage,
      pendingFromDb,
      cartNet: cartNetForPiece,
      pendingAfterCart: Math.max(0, pendingFromDb - cartNetForPiece),
    };
  }, [pieceId, inboundPieceMap, receiveTotalsMap, cartNetByPiece]);

  const cartTotals = useMemo(() => cart.reduce((acc, entry) => {
    acc.totalGross += entry.grossWeight;
    acc.totalTare += entry.tareWeight;
    acc.totalNet += entry.netWeight;
    return acc;
  }, { totalGross: 0, totalTare: 0, totalNet: 0 }), [cart]);
  const cartDisplayEntries = useMemo(() => {
    const stagedCount = new Map();
    return cart.map((entry) => {
      const countForPiece = stagedCount.get(entry.pieceId) || 0;
      stagedCount.set(entry.pieceId, countForPiece + 1);
      const stats = pieceCrateStats[entry.pieceId];
      const statsReady = stats && stats.status === 'loaded';
      const statsError = stats && stats.status === 'error';
      const statsLoading = stats && stats.status === 'loading';
      const statsCrateCount = statsReady ? (stats.maxCrateIndex ?? stats.totalCrates ?? 0) : null;
      const fallbackCrates = pieceCrateIndexMap.get(entry.pieceId) || 0;
      const existingCrates = statsReady ? statsCrateCount : fallbackCrates;
      const crateIndex = existingCrates + countForPiece + 1;
      const inbound = inboundPieceMap.get(entry.pieceId);
      const lotForBarcode = inbound?.lotNo || entry.lotNo || '';
      const receiveBarcode = lotForBarcode
        ? makeReceiveBarcodePreview({ lotNo: lotForBarcode, seq: inbound?.seq, crateIndex })
        : null;
      const cratePreviewError = statsError ? (stats.error || 'Crate history unavailable') : null;
      return {
        ...entry,
        receiveBarcode,
        cratePreviewError,
        cratePreviewStatus: statsError ? 'error' : (statsLoading ? 'loading' : 'ready'),
      };
    });
  }, [cart, pieceCrateIndexMap, inboundPieceMap, pieceCrateStats]);

  const disableAdd = (
    saving ||
    !lotNo ||
    !pieceId ||
    !selectedPiece ||
    !boxId ||
    !bobbinId ||
    !operatorId ||
    !receiveDate ||
    !Number.isFinite(quantityNum) ||
    quantityNum <= 0 ||
    !Number.isInteger(quantityNum) ||
    !Number.isFinite(grossNum) ||
    grossNum <= 0 ||
    tareWeight == null ||
    netWeight == null ||
    netWeight <= 0 ||
    !pendingSummary ||
    pendingSummary.pendingAfterCart <= 0 ||
    netWeight - pendingSummary.pendingAfterCart > 1e-6 ||
    !Number.isFinite(boxWeight) ||
    !Number.isFinite(bobbinWeight) ||
    boxWeight <= 0 ||
    bobbinWeight <= 0 ||
    (pieceId && wastageLockedPieces.has(pieceId))
  );

  function resetForm() {
    setLotNo('');
    setPieceId('');
    setBobbinId('');
    setBoxId('');
    setBobbinQty('');
    setGrossWeight('');
    setOperatorId('');
    setHelperId('');
    setReceiveDate(todayISO());
    setMarkRemainingWastage(false);
    setFormError('');
    setCurrentIssueBarcode('');
    setIssueBarcodeInput('');
  }

  function handleAddEntry() {
    setFormError('');
    if (disableAdd) {
      setFormError('Fill all required fields with valid values before adding.');
      return;
    }
    if (pieceId && wastageLockedPieces.has(pieceId)) {
      setFormError('This piece is already marked for wastage in the staged entries. Remove the existing entry if you need to add more boxes.');
      return;
    }
    if (markRemainingWastage && (!pieceId || !issuedPieceIds.has(pieceId))) {
      setFormError('Cannot mark remaining pending as wastage because this piece was not issued to machine.');
      return;
    }
    const entryLot = selectedPiece?.lotNo || lotNo;
    const entry = {
      id: uid('manual'),
      lotNo: entryLot,
      pieceId,
      bobbinId,
      bobbinName: selectedBobbin?.name || '',
      bobbinWeight,
      bobbinQty: Number(quantityNum),
      boxId,
      boxName: selectedBox?.name || '',
      boxWeight,
      grossWeight: Number(grossNum),
      tareWeight,
      netWeight,
      operatorId,
      operatorName: workerById.get(operatorId)?.name || '',
      helperId: helperId || null,
      helperName: helperId ? (workerById.get(helperId)?.name || '') : '',
      receiveDate: receiveDate || todayISO(),
      markWastage: markRemainingWastage,
      issueBarcode: currentIssueBarcode || null,
      cutId: cutId || null,
      cutName: selectedCut?.name || '',
    };
    setCart(prev => [...prev, entry]);
    setGrossWeight('');
    setBobbinQty('');
    setMarkRemainingWastage(false);
  }

  async function handleIssueBarcodeSubmit(e) {
    e.preventDefault();
    const code = issueBarcodeInput.trim();
    if (!code) return;
    setIssueLookupLoading(true);
    try {
      const issue = await api.getIssueByBarcode(code);
      if (!issue) throw new Error('Issue barcode not found');
      const pieceIds = Array.isArray(issue.pieceIds) ? issue.pieceIds : (String(issue.pieceIds || '').split(',').filter(Boolean));
      if (pieceIds.length !== 1) throw new Error('Issue barcode must reference a single piece');
      setLotNo(issue.lotNo || '');
      setPieceId(pieceIds[0]);
      const normalized = code.trim().toUpperCase();
      setCurrentIssueBarcode(normalized);
      alert(`Loaded issue ${normalized} for piece ${pieceIds[0]}`);
    } catch (err) {
      alert(err.message || 'Failed to lookup issue barcode');
    } finally {
      setIssueBarcodeInput('');
      setIssueLookupLoading(false);
    }
  }

  function removeEntry(entryId) {
    if (saving) return;
    setCart(prev => prev.filter(entry => entry.id !== entryId));
  }

  function clearCart() {
    if (saving || cart.length === 0) return;
    if (!window.confirm('Clear all staged boxes?')) return;
    setCart([]);
  }

  function openIssueModalForPiece() {
    if (!pieceId || !selectedPiece || !onIssueToMachine) return;
    const itemId = selectedPiece.itemId || null;
    const lotForPiece = selectedPiece.lotNo || lotNo;
    setIssueModalData({
      date: todayISO(),
      machineId: '',
      operatorId: '',
      note: '',
      pieceIds: [pieceId],
      lotNo: lotForPiece,
      itemId,
    });
    setIssuingPiece(pieceId);
    setIssueModalOpen(true);
  }

  function closeIssueModal() {
    setIssueModalOpen(false);
    setIssuingPiece(null);
    setIssueModalData({
      date: todayISO(),
      machineId: '',
      operatorId: '',
      note: '',
      lotNo: '',
      pieceIds: [],
      itemId: null,
    });
  }

  async function handleIssueModalSubmit() {
    if (!onIssueToMachine || !issueModalData || !issuingPiece) {
      closeIssueModal();
      return;
    }
    const { lotNo: issueLotNo, itemId, pieceIds = [issuingPiece], date, machineId, operatorId, note } = issueModalData;
    if (!machineId) { alert('Select a machine before issuing.'); return; }
    if (!operatorId) { alert('Select an operator before issuing.'); return; }
    setIssuingFromModal(true);
    try {
      await onIssueToMachine({
        date,
        itemId: itemId || (selectedPiece?.itemId ?? ''),
        lotNo: issueLotNo,
        pieceIds,
        note,
        machineId,
        operatorId,
      });
      await refreshDb();
      alert(`Piece ${pieceIds.join(', ')} issued successfully.`);
      closeIssueModal();
    } catch (err) {
      alert(err.message || 'Failed to issue piece');
    } finally {
      setIssuingFromModal(false);
    }
  }

  async function handleSaveCart() {
    if (cart.length === 0 || saving) return;
    if (!window.confirm(`Conceal and save ${cart.length} entr${cart.length === 1 ? 'y' : 'ies'}?`)) return;
    setSaving(true);
    setFormError('');
    setProgressText('Starting…');
    const snapshot = cart.slice();
    const piecesToMark = Array.from(new Set(snapshot.filter(entry => entry.markWastage).map(entry => entry.pieceId)));
    const wastageWarnings = [];
    try {
      for (let idx = 0; idx < snapshot.length; idx += 1) {
        const entry = snapshot[idx];
        setProgressText(`Saving ${entry.pieceId} (${idx + 1}/${snapshot.length})`);
        await api.manualReceiveFromMachine({
          pieceId: entry.pieceId,
          lotNo: entry.lotNo,
          bobbinId: entry.bobbinId,
          boxId: entry.boxId,
          bobbinQuantity: entry.bobbinQty,
          operatorId: entry.operatorId,
          helperId: entry.helperId,
          grossWeight: entry.grossWeight,
          receiveDate: entry.receiveDate,
          issueBarcode: entry.issueBarcode,
          cutId: entry.cutId,
        });
        setCart(prev => prev.filter(item => item.id !== entry.id));
      }
      setProgressText('Refreshing data…');
      await refreshDb();
      setProgressText(piecesToMark.length ? 'Marking wastage…' : '');
      for (const piece of piecesToMark) {
        try {
          await api.markPieceWastage({ pieceId: piece });
        } catch (err) {
          console.error('Failed to mark wastage for manual entry', piece, err);
          wastageWarnings.push(`Could not mark wastage for ${piece}: ${err.message || 'Unknown error'}`);
        }
      }
      setProgressText('');
      if (wastageWarnings.length > 0) {
        setFormError(wastageWarnings.join(' '));
        alert(`Manual entries saved, but some wastage calls failed:\n${wastageWarnings.join('\n')}`);
      } else {
        setFormError('');
        alert('Manual entries saved successfully.');
      }
    } catch (err) {
      console.error('Failed to save manual entries', err);
      setFormError(err.message || 'Failed to save manual entries');
      try {
        await refreshDb();
      } catch (refreshErr) {
        console.error('Failed to refresh after error', refreshErr);
      }
    } finally {
      setProgressText('');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border ${cls.cardBorder} ${cls.cardBg} p-4`}>
        <form onSubmit={handleIssueBarcodeSubmit} className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className={`text-xs ${cls.muted}`}>Scan issue barcode</label>
            <Input value={issueBarcodeInput} onChange={(e)=>setIssueBarcodeInput(e.target.value)} placeholder="Scan ISM-MET-001" disabled={issueLookupLoading} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={issueLookupLoading || !issueBarcodeInput.trim()}>{issueLookupLoading ? 'Scanning…' : 'Load issue'}</Button>
          </div>
        </form>

      <div className="grid gap-3 md:grid-cols-3 mt-3">
        <div>
          <label className={`text-xs ${cls.muted}`}>Lot</label>
          <Select value={lotNo} onChange={(e) => { setLotNo(e.target.value); setPieceId(''); }} disabled={saving}>
            <option value="">Select lot</option>
            {lotOptions.length === 0 ? (
              <option value="">No lots available</option>
            ) : lotOptions.map(lot => (
              <option key={lot.id || lot.lotNo} value={lot.lotNo}>
                {lot.lotNo}{lot.itemName ? ` · ${lot.itemName}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={`text-xs ${cls.muted}`}>Piece</label>
          <Select value={pieceId} onChange={(e) => setPieceId(e.target.value)} disabled={!lotNo || saving}>
            <option value="">{lotNo ? 'Select piece' : 'Choose lot first'}</option>
            {pieceOptions.map(piece => (
              <option key={piece.id} value={piece.id}>
                {piece.id} · {formatKg(piece.weight)} kg · Pending {formatKg(piece.pendingWeight || 0)} kg
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className={`text-xs ${cls.muted}`}>Receive date</label>
          <Input type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} disabled={saving} />
        </div>
      </div>
      {currentIssueBarcode && (
        <div className={`text-xs mt-1 ${cls.muted}`}>
          Linked issue barcode: {currentIssueBarcode}
        </div>
      )}

      {pendingSummary ? (
          <div className={`mt-3 grid gap-3 sm:grid-cols-2`}>
            <div className={`rounded-xl border ${cls.rowBorder} p-3`}>
              <div className="text-xs font-semibold uppercase tracking-wide">Inbound</div>
              <div className="text-lg font-semibold">{formatKg(pendingSummary.inboundWeight)} kg</div>
              <div className={`text-xs ${cls.muted}`}>Received {formatKg(pendingSummary.received)} · Wastage {formatKg(pendingSummary.wastage)}</div>
            </div>
            <div className={`rounded-xl border ${cls.rowBorder} p-3`}>
              <div className="text-xs font-semibold uppercase tracking-wide">Pending after cart</div>
              <div className="text-lg font-semibold">{formatKg(pendingSummary.pendingAfterCart)} kg</div>
              <div className={`text-xs ${cls.muted}`}>Cart staged {formatKg(pendingSummary.cartNet)} kg</div>
            </div>
          </div>
        ) : (
          <div className={`mt-3 text-sm ${cls.muted}`}>Select a piece to view its pending balance.</div>
        )}

        <div className="grid gap-3 md:grid-cols-4 mt-4">
          <div>
            <label className={`text-xs ${cls.muted}`}>Bobbin</label>
            <Select value={bobbinId} onChange={(e) => setBobbinId(e.target.value)} disabled={saving}>
              <option value="">Select bobbin</option>
              {bobbins.length === 0 && (
                <option value="">Add bobbins in Masters</option>
              )}
              {bobbins.map(bobbin => (
                <option key={bobbin.id} value={bobbin.id}>
                  {bobbin.name} {bobbin.weight != null ? `(${formatKg(bobbin.weight)} kg)` : '(set weight in Masters)'}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className={`text-xs ${cls.muted}`}>Box</label>
            <Select value={boxId} onChange={(e) => setBoxId(e.target.value)} disabled={saving}>
              <option value="">Select box</option>
              {boxes.length === 0 && (
                <option value="">Add boxes in Masters</option>
              )}
              {boxes.map(box => (
                <option key={box.id} value={box.id}>
                  {box.name} ({formatKg(box.weight || 0)} kg)
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className={`text-xs ${cls.muted}`}>Cut (optional)</label>
            <Select value={cutId} onChange={(e) => setCutId(e.target.value)} disabled={saving}>
              <option value="">No cut</option>
              {cuts.length === 0 && <option value="">Add cuts in Masters</option>}
              {cuts.map(cut => (
                <option key={cut.id} value={cut.id}>{cut.name}</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2 md:col-span-2">
            <div>
              <label className={`text-xs ${cls.muted}`}>Bobbin qty</label>
              <Input type="number" min="1" step="1" value={bobbinQty} onChange={(e) => setBobbinQty(e.target.value)} disabled={saving} placeholder="e.g. 12" />
            </div>
            <div>
              <label className={`text-xs ${cls.muted}`}>Gross weight (kg)</label>
              <Input type="number" min="0" step="0.001" value={grossWeight} onChange={(e) => setGrossWeight(e.target.value)} disabled={saving} placeholder="e.g. 25.350" />
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3 mt-4">
          <div>
            <label className={`text-xs ${cls.muted}`}>Operator</label>
            <Select value={operatorId} onChange={(e) => setOperatorId(e.target.value)} disabled={saving}>
              <option value="">Select operator</option>
              {operatorOptions.length === 0 ? (
                <option value="">Add operators in Masters</option>
              ) : operatorOptions.map(op => (
                <option key={op.id} value={op.id}>{op.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className={`text-xs ${cls.muted}`}>Helper (optional)</label>
            <Select value={helperId} onChange={(e) => setHelperId(e.target.value)} disabled={saving}>
              <option value="">No helper</option>
              {helperOptions.map(helper => (
                <option key={helper.id} value={helper.id}>{helper.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1 justify-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={markRemainingWastage}
                disabled={
                  !pieceId ||
                  saving ||
                  (pieceId && wastageLockedPieces.has(pieceId))
                }
                onChange={(e) => setMarkRemainingWastage(e.target.checked)}
              />
              <span>Mark remaining pending as wastage</span>
            </label>
            {pieceId && wastageLockedPieces.has(pieceId) && (
              <span className="text-xs text-orange-300">Already marked for wastage in cart; remove staged entry to change.</span>
            )}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 mt-4">
          <div className={`rounded-xl border ${cls.rowBorder} p-3`}>
            <div className="text-xs uppercase font-semibold">Auto tare</div>
            <div className="text-2xl font-semibold">{tareWeight != null && tareWeight > 0 ? `${formatKg(tareWeight)} kg` : '—'}</div>
            <div className={`text-xs ${cls.muted}`}>Box {boxWeight != null ? formatKg(boxWeight) : '—'} + Bobbin {bobbinWeight != null ? formatKg(bobbinWeight) : '—'} × Qty {Number.isFinite(quantityNum) ? quantityNum : '—'}</div>
          </div>
          <div className={`rounded-xl border ${cls.rowBorder} p-3`}>
            <div className="text-xs uppercase font-semibold">Net (auto)</div>
            <div className={`text-2xl font-semibold ${pendingSummary && netWeight != null && netWeight - pendingSummary.pendingAfterCart > 1e-6 ? 'text-red-400' : ''}`}>
              {netWeight != null && netWeight > 0 ? `${formatKg(netWeight)} kg` : '—'}
            </div>
            <div className={`text-xs ${cls.muted}`}>Cannot exceed pending balance</div>
          </div>
        </div>

        {formError && (
          <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
            {formError}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={handleAddEntry} disabled={disableAdd}>Add box</Button>
          <SecondaryButton type="button" onClick={resetForm} disabled={saving}>Reset form</SecondaryButton>
        </div>
      </div>

      <div className={`rounded-xl border ${cls.cardBorder} ${cls.cardBg} p-4`}>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="font-semibold text-base">Staged boxes</div>
          <Pill>{cart.length} entries</Pill>
          <Pill>Total net {formatKg(cartTotals.totalNet)} kg</Pill>
          <div className="ml-auto flex gap-2">
            <SecondaryButton type="button" onClick={clearCart} disabled={saving || cart.length === 0}>Clear cart</SecondaryButton>
            <Button type="button" onClick={handleSaveCart} disabled={saving || cart.length === 0}>
              {saving ? 'Saving…' : `Conceal & save (${cart.length})`}
            </Button>
          </div>
        </div>

        {progressText && (
          <div className={`text-sm mb-3 ${cls.muted}`}>{progressText}</div>
        )}

        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className={`text-left ${cls.muted}`}>
              <tr>
                <th className="py-2 pr-2">Piece</th>
                <th className="py-2 pr-2">Lot</th>
                <th className="py-2 pr-2">Cut</th>
                <th className="py-2 pr-2">Barcode</th>
                <th className="py-2 pr-2">Bobbin</th>
                <th className="py-2 pr-2 text-right">Qty</th>
                <th className="py-2 pr-2">Box</th>
                <th className="py-2 pr-2 text-right">Gross</th>
                <th className="py-2 pr-2 text-right">Tare</th>
                <th className="py-2 pr-2 text-right">Net</th>
                <th className="py-2 pr-2">Operator / Helper</th>
                <th className="py-2 pr-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cart.length === 0 ? (
                <tr>
                  <td className="py-4 text-center text-sm" colSpan={12}>
                    No boxes staged yet. Add a box to begin.
                  </td>
                </tr>
              ) : cartDisplayEntries.map(entry => (
                <tr key={entry.id} className={`border-t ${cls.rowBorder}`}>
                  <td className="py-2 pr-2 font-mono">{entry.pieceId}</td>
                  <td className="py-2 pr-2 font-mono">{entry.lotNo}</td>
                  <td className="py-2 pr-2">{entry.cutName || '—'}</td>
                  <td className="py-2 pr-2">
                    {entry.receiveBarcode ? (
                      <span className="text-xs font-mono">{entry.receiveBarcode}</span>
                    ) : (
                      <span className={`text-xs ${cls.muted}`}>Pending</span>
                    )}
                    {entry.cratePreviewError && (
                      <div className="text-xs text-amber-300 mt-1">{entry.cratePreviewError}</div>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    {entry.bobbinName}
                    <div className={`text-xs ${cls.muted}`}>{formatKg(entry.bobbinWeight)} kg</div>
                  </td>
                  <td className="py-2 pr-2 text-right">{entry.bobbinQty}</td>
                  <td className="py-2 pr-2">
                    {entry.boxName}
                    <div className={`text-xs ${cls.muted}`}>{formatKg(entry.boxWeight)} kg</div>
                  </td>
                  <td className="py-2 pr-2 text-right">{formatKg(entry.grossWeight)}</td>
                  <td className="py-2 pr-2 text-right">{formatKg(entry.tareWeight)}</td>
                  <td className="py-2 pr-2 text-right">{formatKg(entry.netWeight)}</td>
                  <td className="py-2 pr-2">
                    <div>{entry.operatorName || '—'}</div>
                    <div className={`text-xs ${cls.muted}`}>{entry.helperName || 'No helper'}</div>
                    {entry.markWastage && (
                      <div className="text-xs text-orange-300 mt-1">Mark pending as wastage</div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <button type="button" className="text-red-400 underline text-sm" disabled={saving} onClick={() => removeEntry(entry.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {issueModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={closeIssueModal}>
          <div className={`w-full max-w-md rounded-2xl border ${cls.cardBorder} ${cls.cardBg} p-6`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-lg font-semibold">Issue piece</div>
                <div className={`text-xs ${cls.muted}`}>Lot {issueModalData.lotNo || lotNo} · Piece {issueModalData.pieceIds?.[0] || pieceId}</div>
              </div>
              <button type="button" onClick={closeIssueModal} className={`w-8 h-8 rounded-full border ${cls.cardBorder} ${cls.cardBg}`}>
                ✕
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={`text-xs ${cls.muted}`}>Date</label>
                <Input
                  type="date"
                  value={issueModalData.date}
                  onChange={(e) => setIssueModalData(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>Machine *</label>
                <Select
                  value={issueModalData.machineId}
                  onChange={(e) => setIssueModalData(prev => ({ ...prev, machineId: e.target.value }))}
                >
                  <option value="">Select machine</option>
                  {machines.map(machine => (
                    <option key={machine.id} value={machine.id}>{machine.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>Operator *</label>
                <Select
                  value={issueModalData.operatorId}
                  onChange={(e) => setIssueModalData(prev => ({ ...prev, operatorId: e.target.value }))}
                >
                  <option value="">Select operator</option>
                  {operatorOptions.map(op => (
                    <option key={op.id} value={op.id}>{op.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className={`text-xs ${cls.muted}`}>Note (optional)</label>
                <Input
                  value={issueModalData.note}
                  onChange={(e) => setIssueModalData(prev => ({ ...prev, note: e.target.value }))}
                  placeholder="Reference / reason"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <SecondaryButton type="button" onClick={closeIssueModal} className="flex-1">Cancel</SecondaryButton>
                <Button type="button" onClick={handleIssueModalSubmit} disabled={issuingFromModal} className="flex-1">
                  {issuingFromModal ? 'Issuing…' : 'Issue piece'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
