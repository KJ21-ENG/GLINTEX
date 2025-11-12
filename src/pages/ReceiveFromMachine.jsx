/**
 * ReceiveFromMachine page component for GLINTEX Inventory
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Pill, Pagination, Select, Input } from '../components';
import { formatKg, uid, todayISO } from '../utils';
import * as api from '../api';

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

export function ReceiveFromMachine({ db, refreshDb }) {
  const { cls, brand } = useBrand();
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
  const [mode, setMode] = useState('csv');
  const pageSize = 50;

  const inboundPieceMap = useMemo(() => {
    const map = new Map();
    (db.inbound_items || []).forEach((piece) => {
      map.set(piece.id, piece);
    });
    return map;
  }, [db.inbound_items]);

  // Map pieceId -> { received: number, wastage: number, totalPieces: number }
  const receiveTotalsMap = useMemo(() => {
    const map = new Map();
    (db.receive_piece_totals || []).forEach((row) => {
      map.set(row.pieceId, {
        received: Number(row.totalNetWeight || 0),
        wastage: Number(row.wastageNetWeight || 0),
        totalPieces: Number(row.totalPieces || 0),
      });
    });
    return map;
  }, [db.receive_piece_totals]);

  // Map pieceId -> most common bobbin name from receive rows
  const pieceBobbinMap = useMemo(() => {
    const map = new Map();
    const pieceBobbinCounts = new Map();
    
    (db.receive_rows || []).forEach((row) => {
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
  }, [db.receive_rows]);

  const { knownPieces, orphanPieces, totalReceivedWeight } = useMemo(() => {
    const known = [];
    const orphan = [];
    let runningTotal = 0;
    for (const [pieceId, totals] of receiveTotalsMap.entries()) {
      const received = totals.received || 0;
      const totalPieces = totals.totalPieces || 0;
      runningTotal += received;
      const inbound = inboundPieceMap.get(pieceId) || null;
      const inboundWeight = inbound ? Number(inbound.weight || 0) : null;
      const summary = {
        pieceId,
        lotNo: inbound ? inbound.lotNo : null,
        inboundWeight,
        receivedWeight: received,
        pendingWeight: inboundWeight === null ? null : Math.max(0, inboundWeight - received),
        totalPieces,
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

  const recentUploads = useMemo(() => (db.receive_uploads || []).slice(), [db.receive_uploads]);
  const uploadLookup = useMemo(() => {
    const map = new Map();
    (db.receive_uploads || []).forEach((u) => map.set(u.id, u));
    return map;
  }, [db.receive_uploads]);
  const latestRows = useMemo(() => (db.receive_rows || []).slice(), [db.receive_rows]);

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
            onClick={() => setMode('csv')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${mode === 'csv' ? cls.navActive : `${cls.cardBorder} ${cls.navHover}`}`}
          >
            CSV upload
          </button>
          <button
            type="button"
            onClick={() => setMode('manual')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${mode === 'manual' ? cls.navActive : `${cls.cardBorder} ${cls.navHover}`}`}
          >
            Manual entry
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
                <th className="py-2 pr-2 text-right">Total Pcs</th>
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
                  <td className="py-2 pr-2 text-right">{piece.totalPieces || 0}</td>
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
                    <th className="py-2 pr-2 text-right">Total Pcs</th>
                  </tr>
              </thead>
              <tbody>
                {pagedOrphanPieces.map((piece) => (
                  <tr key={piece.pieceId} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2 font-mono">{piece.pieceId}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(piece.receivedWeight)}</td>
                    <td className="py-2 pr-2 text-right">{piece.totalPieces || 0}</td>
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
                <th className="py-2 pr-2">VchNo</th>
                <th className="py-2 pr-2">Piece</th>
                <th className="py-2 pr-2">Machine</th>
                <th className="py-2 pr-2">Employee</th>
                <th className="py-2 pr-2 text-right">Net Wt (kg)</th>
                <th className="py-2 pr-2 text-right">Pcs</th>
                <th className="py-2 pr-2">Bobbin</th>
                <th className="py-2 pr-2">CSV Date</th>
                <th className="py-2 pr-2">Imported</th>
              </tr>
            </thead>
            <tbody>
              {pagedLatestRows.length === 0 ? (
                <tr>
                  <td className="py-3 pr-2" colSpan={9}>No rows imported yet.</td>
                </tr>
              ) : (
                pagedLatestRows.map((row) => {
                  const upload = uploadLookup.get(row.uploadId);
                  // Use bobbin relation if available, fallback to pcsTypeName for backward compatibility
                  const bobbinName = row.bobbin?.name || row.pcsTypeName || '—';
                  return (
                    <tr key={row.id} className={`border-t ${cls.rowBorder}`}>
                      <td className="py-2 pr-2 font-mono">{row.vchNo}</td>
                      <td className="py-2 pr-2 font-mono">{row.pieceId}</td>
                      <td className="py-2 pr-2">{row.machineNo || '—'}</td>
                      <td className="py-2 pr-2">{row.employee || '—'}</td>
                      <td className="py-2 pr-2 text-right">{row.netWt == null ? '—' : formatKg(row.netWt)}</td>
                      <td className="py-2 pr-2 text-right">{row.pcs == null ? '—' : row.pcs}</td>
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

function ManualReceiveForm({ db, inboundPieceMap, receiveTotalsMap, refreshDb, cls }) {
  const [lotNo, setLotNo] = useState('');
  const [pieceId, setPieceId] = useState('');
  const [bobbinId, setBobbinId] = useState('');
  const [boxId, setBoxId] = useState('');
  const [bobbinQty, setBobbinQty] = useState('');
  const [grossWeight, setGrossWeight] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [helperId, setHelperId] = useState('');
  const [receiveDate, setReceiveDate] = useState(todayISO());
  const [markRemainingWastage, setMarkRemainingWastage] = useState(false);
  const [cart, setCart] = useState([]);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [progressText, setProgressText] = useState('');

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
  const issuedPieceIds = useMemo(() => {
    const set = new Set();
    (db.issue_to_machine || []).forEach(record => {
      const list = Array.isArray(record.pieceIds)
        ? record.pieceIds
        : String(record.pieceIds || '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean);
      list.forEach(id => set.add(id));
    });
    return set;
  }, [db.issue_to_machine]);
  const itemNameById = useMemo(() => {
    const map = new Map();
    (db.items || []).forEach(item => map.set(item.id, item.name || ''));
    return map;
  }, [db.items]);
  const lotOptions = useMemo(() => (
    (db.lots || [])
      .map(lot => ({ ...lot, itemName: itemNameById.get(lot.itemId) || '' }))
      .sort((a, b) => (a.lotNo || '').localeCompare(b.lotNo || '', undefined, { numeric: true, sensitivity: 'base' }))
  ), [db.lots, itemNameById]);
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
        const statusOk = !item.status || String(item.status).toLowerCase() === 'available';
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
    };
    setCart(prev => [...prev, entry]);
    setGrossWeight('');
    setBobbinQty('');
    setMarkRemainingWastage(false);
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
        <div className="text-sm mb-3">
          Add each box to the staging cart, then click <strong>Conceal & save</strong> to create receive entries. Net weight is auto-calculated as Gross − (Box + Bobbin×Qty). Use the wastage checkbox if you want to mark the remaining pending balance the same way as the Stock page’s “Mark wastage” action.
        </div>
        <div className="grid gap-3 md:grid-cols-3">
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

        <div className="grid gap-3 md:grid-cols-3 mt-4">
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
          <div className="grid grid-cols-2 gap-2">
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
                  !issuedPieceIds.has(pieceId) ||
                  (pieceId && wastageLockedPieces.has(pieceId))
                }
                onChange={(e) => setMarkRemainingWastage(e.target.checked)}
              />
              <span>Mark remaining pending as wastage</span>
            </label>
            {!pieceId ? null : issuedPieceIds.has(pieceId) ? (
              wastageLockedPieces.has(pieceId) ? (
                <span className="text-xs text-orange-300">Already marked for wastage in cart; remove staged entry to change.</span>
              ) : (
                <span className={`text-xs ${cls.muted}`}>Same as Stock → Mark wastage.</span>
              )
            ) : (
              <span className="text-xs text-orange-300">Piece was not issued to a machine; cannot mark as wastage.</span>
            )}
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
                  <td className="py-4 text-center text-sm" colSpan={11}>
                    No boxes staged yet. Add a box to begin.
                  </td>
                </tr>
              ) : cart.map(entry => (
                <tr key={entry.id} className={`border-t ${cls.rowBorder}`}>
                  <td className="py-2 pr-2 font-mono">{entry.pieceId}</td>
                  <td className="py-2 pr-2 font-mono">{entry.lotNo}</td>
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
    </div>
  );
}
