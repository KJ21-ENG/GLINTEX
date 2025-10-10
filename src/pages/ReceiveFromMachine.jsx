/**
 * ReceiveFromMachine page component for GLINTEX Inventory
 */

import React, { useMemo, useState, useRef } from 'react';
import { useBrand } from '../context';
import { Section, Button, SecondaryButton, Pill } from '../components';
import { formatKg } from '../utils';
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

  const inboundPieceMap = useMemo(() => {
    const map = new Map();
    (db.inbound_items || []).forEach((piece) => {
      map.set(piece.id, piece);
    });
    return map;
  }, [db.inbound_items]);

  const receiveTotalsMap = useMemo(() => {
    const map = new Map();
    (db.receive_piece_totals || []).forEach((row) => {
      map.set(row.pieceId, Number(row.totalNetWeight || 0));
    });
    return map;
  }, [db.receive_piece_totals]);

  const { knownPieces, orphanPieces, totalReceivedWeight } = useMemo(() => {
    const known = [];
    const orphan = [];
    let runningTotal = 0;
    for (const [pieceId, received] of receiveTotalsMap.entries()) {
      runningTotal += received;
      const inbound = inboundPieceMap.get(pieceId) || null;
      const inboundWeight = inbound ? Number(inbound.weight || 0) : null;
      const summary = {
        pieceId,
        lotNo: inbound ? inbound.lotNo : null,
        inboundWeight,
        receivedWeight: received,
        pendingWeight: inboundWeight === null ? null : Math.max(0, inboundWeight - received),
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

  const recentUploads = useMemo(() => (db.receive_uploads || []).slice(0, 10), [db.receive_uploads]);
  const uploadLookup = useMemo(() => {
    const map = new Map();
    (db.receive_uploads || []).forEach((u) => map.set(u.id, u));
    return map;
  }, [db.receive_uploads]);
  const latestRows = useMemo(() => (db.receive_rows || []).slice(0, 50), [db.receive_rows]);

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
  const limitedKnownPieces = knownPieces.slice(0, 50);

  return (
    <div className="space-y-6">
      <Section
        title="Receive from machine"
        actions={(selectedFile || previewData) ? (
          <SecondaryButton onClick={clearSelection}>Clear selection</SecondaryButton>
        ) : null}
      >
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

          {/* tracking pills removed */}

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
              </tr>
            </thead>
            <tbody>
              {limitedKnownPieces.length === 0 ? (
                <tr>
                  <td className="py-3 pr-2" colSpan={5}>No receive data yet.</td>
                </tr>
              ) : (
                limitedKnownPieces.map((piece) => (
                  <tr key={piece.pieceId} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2 font-mono">{piece.pieceId}</td>
                    <td className="py-2 pr-2 font-mono">{piece.lotNo || '—'}</td>
                    <td className="py-2 pr-2 text-right">{piece.inboundWeight == null ? '—' : formatKg(piece.inboundWeight)}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(piece.receivedWeight)}</td>
                    <td className="py-2 pr-2 text-right">{piece.pendingWeight == null ? '—' : formatKg(piece.pendingWeight)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
                </tr>
              </thead>
              <tbody>
                {orphanPieces.map((piece) => (
                  <tr key={piece.pieceId} className={`border-t ${cls.rowBorder}`}>
                    <td className="py-2 pr-2 font-mono">{piece.pieceId}</td>
                    <td className="py-2 pr-2 text-right">{formatKg(piece.receivedWeight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              {recentUploads.length === 0 ? (
                <tr>
                  <td className="py-3 pr-2" colSpan={3}>No uploads yet.</td>
                </tr>
              ) : (
                recentUploads.map((upload) => (
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
                <th className="py-2 pr-2">CSV Date</th>
                <th className="py-2 pr-2">Imported</th>
              </tr>
            </thead>
            <tbody>
              {latestRows.length === 0 ? (
                <tr>
                  <td className="py-3 pr-2" colSpan={7}>No rows imported yet.</td>
                </tr>
              ) : (
                latestRows.map((row) => {
                  const upload = uploadLookup.get(row.uploadId);
                  return (
                    <tr key={row.id} className={`border-t ${cls.rowBorder}`}>
                      <td className="py-2 pr-2 font-mono">{row.vchNo}</td>
                      <td className="py-2 pr-2 font-mono">{row.pieceId}</td>
                      <td className="py-2 pr-2">{row.machineNo || '—'}</td>
                      <td className="py-2 pr-2">{row.employee || '—'}</td>
                      <td className="py-2 pr-2 text-right">{row.netWt == null ? '—' : formatKg(row.netWt)}</td>
                      <td className="py-2 pr-2">{row.date || '—'}</td>
                      <td className="py-2 pr-2">{formatDateTime(upload?.uploadedAt || row.createdAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
