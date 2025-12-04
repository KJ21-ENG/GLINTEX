import React, { useMemo, useRef, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { formatKg } from '../../utils';
import * as api from '../../api';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
  Badge,
} from '../ui';
import { Upload, FileUp, RefreshCw, FileWarning } from 'lucide-react';

const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

function IssuesList({ issues }) {
  if (!issues?.length) return null;
  return (
    <ul className="list-disc list-inside space-y-1 text-sm text-destructive">
      {issues.map((issue, idx) => {
        if (issue.type === 'duplicate_vch_in_db') {
          return <li key={`issue-${idx}`}>Voucher already imported: {issue.duplicates?.join(', ')}</li>;
        }
        if (issue.type === 'duplicate_vch_in_file') {
          return <li key={`issue-${idx}`}>Duplicate voucher in file rows: {issue.rows?.join(', ')}</li>;
        }
        return <li key={`issue-${idx}`}>{issue.message || issue.type}</li>;
      })}
    </ul>
  );
}

function SummaryCard({ title, summary, actions }) {
  if (!summary) return null;
  const { filename, rowCount, pieceCount, totalNetWeight, pieces = [], lots = [], missingPieces = [], meta } = summary;

  return (
    <Card className="border-dashed">
      <CardHeader className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <div className="text-sm text-muted-foreground">
            {filename || 'File'} · {rowCount || 0} rows · {pieceCount || 0} pieces · Upload net {formatKg(totalNetWeight || 0)}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Piece</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead className="text-right">Inbound (kg)</TableHead>
                <TableHead className="text-right">Current received (kg)</TableHead>
                <TableHead className="text-right">This upload (kg)</TableHead>
                <TableHead className="text-right">Received after (kg)</TableHead>
                <TableHead className="text-right">Pending after (kg)</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pieces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    No rows.
                  </TableCell>
                </TableRow>
              ) : (
                pieces.map((piece) => {
                  const missing = !piece.inboundExists;
                  return (
                    <TableRow key={piece.pieceId}>
                      <TableCell className="font-mono text-xs">{piece.pieceId}</TableCell>
                      <TableCell className="font-mono text-xs">{piece.lotNo || '—'}</TableCell>
                      <TableCell className="text-right">{piece.inboundWeight == null ? '—' : formatKg(piece.inboundWeight)}</TableCell>
                      <TableCell className="text-right">{formatKg(piece.currentReceivedWeight || 0)}</TableCell>
                      <TableCell className="text-right">{formatKg(piece.incrementWeight || 0)}</TableCell>
                      <TableCell className="text-right">{formatKg(piece.futureReceivedWeight || 0)}</TableCell>
                      <TableCell className="text-right">{piece.futurePendingWeight == null ? '—' : formatKg(piece.futurePendingWeight)}</TableCell>
                      <TableCell className="text-xs">
                        {missing ? <span className="text-amber-600">Inbound not found</span> : <span className="text-emerald-600">Linked</span>}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lot</TableHead>
                <TableHead className="text-right">Inbound (kg)</TableHead>
                <TableHead className="text-right">Current received (kg)</TableHead>
                <TableHead className="text-right">This upload (kg)</TableHead>
                <TableHead className="text-right">Received after (kg)</TableHead>
                <TableHead className="text-right">Pending after (kg)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lots.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No lot data.
                  </TableCell>
                </TableRow>
              ) : (
                lots.map((lot) => (
                  <TableRow key={lot.lotNo}>
                    <TableCell className="font-mono text-xs">{lot.lotNo}</TableCell>
                    <TableCell className="text-right">{formatKg(lot.inboundWeight || 0)}</TableCell>
                    <TableCell className="text-right">{formatKg(lot.currentReceivedWeight || 0)}</TableCell>
                    <TableCell className="text-right">{formatKg(lot.incrementWeight || 0)}</TableCell>
                    <TableCell className="text-right">{formatKg(lot.futureReceivedWeight || 0)}</TableCell>
                    <TableCell className="text-right">{formatKg(lot.futurePendingWeight || 0)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {missingPieces.length > 0 && (
          <div className="text-sm text-amber-700">
            Missing inbound pieces: {missingPieces.join(', ')}
          </div>
        )}

        {meta?.uploadedAt && (
          <div className="text-xs text-muted-foreground">Processed at {formatDateTime(meta.uploadedAt)}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function CutterCsvUpload() {
  const { db, refreshDb } = useInventory();
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionIssues, setActionIssues] = useState([]);
  const [dragActive, setDragActive] = useState(false);

  const recentUploads = useMemo(() => {
    const uploads = (db.receive_from_cutter_machine_uploads || []).slice();
    uploads.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
    return uploads.slice(0, 25);
  }, [db.receive_from_cutter_machine_uploads]);

  const latestRows = useMemo(() => {
    const rows = (db.receive_from_cutter_machine_rows || []).slice();
    rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return rows.slice(0, 50);
  }, [db.receive_from_cutter_machine_rows]);

  const receiveTotals = useMemo(() => (db.receive_from_cutter_machine_piece_totals || []).slice(), [db.receive_from_cutter_machine_piece_totals]);

  const piecesWithReceipts = receiveTotals.length;
  const totalReceivedWeight = receiveTotals.reduce((sum, entry) => sum + Number(entry.totalNetWeight || 0), 0);

  const clearSelection = () => {
    setSelectedFile(null);
    setPreviewData(null);
    setActionError('');
    setActionIssues([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragActive) setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragActive) setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer?.files?.[0] || null;
    if (file) {
      setSelectedFile(file);
      setPreviewData(null);
      setActionError('');
      setActionIssues([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const readContent = async (file) => {
    const text = await file.text();
    return { filename: file.name, content: text };
  };

  const handlePreview = async () => {
    if (!selectedFile) return;
    setPreviewing(true);
    setActionError('');
    setActionIssues([]);
    try {
      const payload = await readContent(selectedFile);
      const result = await api.previewReceiveFromMachine(payload);
      setPreviewData(result.preview || null);
    } catch (err) {
      const issues = Array.isArray(err.details?.issues) ? err.details.issues : [];
      const duplicates = Array.isArray(err.details?.duplicates) ? err.details.duplicates : [];
      if (duplicates.length) {
        issues.push({ type: 'duplicate_vch_in_db', duplicates });
      }
      setActionIssues(issues);
      setActionError(err.message || 'Failed to preview CSV');
      setPreviewData(null);
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!selectedFile) return;
    setConfirming(true);
    setActionError('');
    setActionIssues([]);
    try {
      const payload = await readContent(selectedFile);
      const result = await api.importReceiveFromMachine(payload);
      setImportResult(result || null);
      setPreviewData(null);
      clearSelection();
      await refreshDb();
    } catch (err) {
      const issues = Array.isArray(err.details?.issues) ? err.details.issues : [];
      const duplicates = Array.isArray(err.details?.duplicates) ? err.details.duplicates : [];
      if (duplicates.length) {
        issues.push({ type: 'duplicate_vch_in_db', duplicates });
      }
      setActionIssues(issues);
      setActionError(err.message || 'Failed to import CSV');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cutter CSV Upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
            <label
              htmlFor="receive-file"
              className={`flex w-full cursor-pointer flex-col items-start gap-2 rounded-lg border border-dashed p-4 transition hover:border-primary md:w-2/3 ${dragActive ? 'ring-2 ring-primary ring-offset-2' : ''}`}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Upload className="h-4 w-4" />
                  <span>Drop CSV here or click to choose</span>
                </div>
                <Badge variant="secondary">{selectedFile ? selectedFile.name : 'No file chosen'}</Badge>
              </div>
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
                  setActionError('');
                  setActionIssues([]);
                }}
              />
            </label>
            <div className="flex items-center gap-2">
              <Button onClick={handlePreview} disabled={!selectedFile || previewing}>
                {previewing ? (
                  <span className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" />Previewing…</span>
                ) : (
                  <span className="flex items-center gap-2"><FileUp className="h-4 w-4" />{previewData ? 'Re-preview' : 'Preview CSV'}</span>
                )}
              </Button>
              {selectedFile && (
                <Button variant="outline" onClick={clearSelection}>Clear</Button>
              )}
            </div>
          </div>

          {actionError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <FileWarning className="h-4 w-4 mt-0.5" />
              <div>
                <div className="font-medium">{actionError}</div>
                <IssuesList issues={actionIssues} />
              </div>
            </div>
          )}

          {previewData && (
            <SummaryCard
              title="Preview"
              summary={previewData}
              actions={(
                <>
                  <Button onClick={handleConfirmImport} disabled={confirming}>
                    {confirming ? 'Saving…' : 'Continue & save'}
                  </Button>
                  <Button variant="outline" onClick={() => setPreviewData(null)} disabled={confirming}>
                    Cancel preview
                  </Button>
                </>
              )}
            />
          )}

          {importResult?.summary && (
            <SummaryCard
              title="Last upload summary"
              summary={importResult.summary}
              actions={importResult.upload ? <Badge variant="secondary">Processed {formatDateTime(importResult.upload.uploadedAt)}</Badge> : null}
            />
          )}

          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">Receive status</div>
            <div className="flex flex-wrap gap-4 pt-2">
              <span>Pieces with receipts: <Badge variant="secondary">{piecesWithReceipts}</Badge></span>
              <span>Total received weight: <Badge variant="secondary">{formatKg(totalReceivedWeight)}</Badge></span>
              <span>Latest import rows shown: <Badge variant="secondary">{latestRows.length}</Badge></span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent uploads</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentUploads.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No uploads yet.</TableCell></TableRow>
                ) : recentUploads.map((upload) => (
                  <TableRow key={upload.id}>
                    <TableCell>{formatDateTime(upload.uploadedAt)}</TableCell>
                    <TableCell className="break-all text-xs">{upload.originalFilename || upload.filename || '—'}</TableCell>
                    <TableCell className="text-right">{upload.rowCount || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Latest received rows</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Piece</TableHead>
                  <TableHead>Cut</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Net Wt (kg)</TableHead>
                  <TableHead className="text-right">Bobbin qty</TableHead>
                  <TableHead>Bobbin</TableHead>
                  <TableHead>CSV Date</TableHead>
                  <TableHead>Imported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latestRows.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-4 text-muted-foreground">No rows imported yet.</TableCell></TableRow>
                ) : latestRows.map((row) => {
                  const bobbinName = row.bobbin?.name || row.pcsTypeName || '—';
                  const cutLabel = row.cutMaster?.name || row.cut || '—';
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.pieceId}</TableCell>
                      <TableCell>{cutLabel}</TableCell>
                      <TableCell className="font-mono text-xs">{row.barcode || '—'}</TableCell>
                      <TableCell>{row.machineNo || '—'}</TableCell>
                      <TableCell>{row.operator?.name || row.employee || '—'}</TableCell>
                      <TableCell className="text-right">{row.netWt == null ? '—' : formatKg(row.netWt)}</TableCell>
                      <TableCell className="text-right">{row.bobbinQuantity == null ? '—' : row.bobbinQuantity}</TableCell>
                      <TableCell>{bobbinName}</TableCell>
                      <TableCell>{row.date || '—'}</TableCell>
                      <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
