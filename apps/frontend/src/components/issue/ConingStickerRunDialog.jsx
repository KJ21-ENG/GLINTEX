import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Minus, Plus, Printer, RefreshCw } from 'lucide-react';
import { Button } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import LabelArtifactPreview from '../labels/LabelArtifactPreview';
import { getConingStickerRun, markConingStickersPrinted } from '../../api/client';
import { LABEL_STAGE_KEYS, buildPrintableArtifact, loadTemplateVariants, printStageTemplatesBatch } from '../../utils/labelPrint';
import { labelsPerPage } from '../../utils/label/model';
import { MAX_PAGES } from '../../utils/label/artifact';
import { DEFAULT_SPARE, buildStickerSlots, compareRunRows, isPending, selectedByDefault, sheetCount, shiftGroupKey, suggestedCopies } from '../../utils/coningStickerRun';

const STAGE = LABEL_STAGE_KEYS.CONING_ISSUE;
const VARIANT_KEY = 'glintex.coningStickerVariant';
const readVariantChoice = () => { try { return window.localStorage.getItem(VARIANT_KEY) || ''; } catch { return ''; } };
const saveVariantChoice = (id) => { try { window.localStorage.setItem(VARIANT_KEY, id); } catch { /* choice is a convenience */ } };
const isSheet = (template) => template?.media?.kind === 'sheet';
// Stickers for different containers fill a roll's columns in order, never repeated across a row.
const printableTemplate = (template) => (isSheet(template) ? template : { ...template, media: { ...template.media, columnMode: 'sequence' } });
const variantLabel = (variant) => `${variant.name} (${variant.template.media.widthMm} × ${variant.template.media.heightMm} mm, ${isSheet(variant.template) ? 'office printer' : 'label printer'})`;
const formatDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const formatTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const rangeText = ({ dateFrom, dateTo, fromShifts, toShifts }) => (
  dateFrom === dateTo
    ? `${formatDate(dateFrom)} (${[...new Set([...fromShifts, ...toShifts])].join(', ')})`
    : `${formatDate(dateFrom)} (${fromShifts.join(', ')}) → ${formatDate(dateTo)} (${toShifts.join(', ')})`
);

const kg = (value) => `${Number(value || 0).toFixed(1)} kg`;

function StatusPill({ row }) {
  if (row.status === 'carry_over' && row.stale) return <span className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800" title="Older than 2 days: finish the batch or mark the rest as wastage">Check · {kg(row.pendingWeight)} left</span>;
  if (row.status === 'carry_over') return <span className="whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">C/O · {kg(row.pendingWeight)} left</span>;
  if (row.status === 'carry_printed') return <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">C/O printed {formatTime(row.printedAt)} ×{row.printedCopies}</span>;
  if (row.status === 'not_printed') return <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Not printed</span>;
  if (row.status === 'changed') {
    const grew = row.crates > row.printedCrates;
    return <span className="whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">{grew ? `+${row.crates - row.printedCrates} crates since print` : 'Changed since print'}</span>;
  }
  return <span className="whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Printed {formatTime(row.printedAt)} ×{row.printedCopies}</span>;
}

export default function ConingStickerRunDialog({ open, onOpenChange, onBack, range, canMarkPrinted }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [copyOverrides, setCopyOverrides] = useState({});
  const [spare, setSpare] = useState(DEFAULT_SPARE);
  const [showAll, setShowAll] = useState(false);
  const [startAt, setStartAt] = useState(1);
  const [newSheetPerShift, setNewSheetPerShift] = useState(true);
  const [variants, setVariants] = useState([]);
  const [variantId, setVariantId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [view, setView] = useState('list');
  const [previewPage, setPreviewPage] = useState(0);
  const [artifact, setArtifact] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmPrint, setConfirmPrint] = useState(null);
  const [notice, setNotice] = useState('');
  // Carried-over batches sit in their own section, collapsed until someone opens it.
  const [carryOpen, setCarryOpen] = useState(false);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const [run, set] = await Promise.all([getConingStickerRun(range), loadTemplateVariants(STAGE)]);
      if (seq !== loadSeq.current) return;
      const list = (run.rows || []).slice().sort(compareRunRows);
      setRows(list);
      setTruncated(Boolean(run.truncated));
      setVariants(set.variants);
      // Last choice on this computer, else the first sheet variant, else the design in use.
      setVariantId((current) => [current, readVariantChoice(), set.variants.find((v) => isSheet(v.template))?.id, set.activeId]
        .find((id) => id && set.variants.some((v) => v.id === id)));
      // Ticked by default: everything still needing a sticker today, including fresh carried-over
      // batches (C/O, up to 2 days old); 'Check' batches stay unticked until someone looks at them.
      // The collapsed band shows how many carried-over barcodes are selected.
      setSelected(new Set(list.filter(selectedByDefault).map((row) => row.id)));
      setCarryOpen(false);
      setCopyOverrides({});
    } catch (err) {
      if (seq === loadSeq.current) setError(err.message || 'Unable to load coning stickers');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    if (!open) return;
    setView('list');
    setConfirmPrint(null);
    setNotice('');
    void load();
  }, [open, load]);

  const variant = variants.find((v) => v.id === variantId) || null;
  const template = variant?.template || null;
  const sheet = isSheet(template);
  const perPage = template ? labelsPerPage(template.media) : 21;
  const copiesOf = useCallback((row) => copyOverrides[row.id] ?? suggestedCopies(row, spare), [copyOverrides, spare]);
  const visibleRows = useMemo(() => rows.filter((row) => showAll || isPending(row)), [rows, showAll]);
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const slots = useMemo(
    () => buildStickerSlots(selectedRows, { copiesOf, startAt: sheet ? startAt : 1, perPage, newSheetPerShift: sheet && newSheetPerShift }),
    [selectedRows, copiesOf, startAt, perPage, newSheetPerShift, sheet],
  );
  const totalStickers = slots.filter(Boolean).length;
  const sheets = sheetCount(slots, perPage);
  const pendingCount = rows.filter(isPending).length;

  const toggle = (id, value) => setSelected((prev) => {
    const next = new Set(prev);
    if (value) next.add(id); else next.delete(id);
    return next;
  });
  const carryRows = useMemo(() => visibleRows.filter((row) => row.carryOver), [visibleRows]);
  const dateRows = useMemo(() => visibleRows.filter((row) => !row.carryOver), [visibleRows]);
  const allSelectedIn = (list) => list.length > 0 && list.every((row) => selected.has(row.id));
  const selectedCountIn = (list) => list.filter((row) => selected.has(row.id)).length;
  // Each section has its own select-all; neither touches the other's barcodes.
  const toggleAllIn = (list, value) => setSelected((prev) => {
    const next = new Set(prev);
    list.forEach((row) => (value ? next.add(row.id) : next.delete(row.id)));
    return next;
  });

  const buildArtifact = async () => buildPrintableArtifact(printableTemplate(template), sheet ? slots : slots.slice(0, MAX_PAGES * perPage), { stageKey: STAGE, copies: 1, dpi: sheet ? 300 : 203 });

  const openPreview = async () => {
    if (!totalStickers) { setNotice('Select at least one barcode.'); return; }
    setBusy(true);
    setNotice('');
    try {
      setArtifact(await buildArtifact());
      setPreviewPage(0);
      setView('preview');
    } catch (err) {
      setNotice(err.message || 'Unable to build the preview');
    } finally {
      setBusy(false);
    }
  };

  const print = async () => {
    if (!totalStickers) { setNotice('Select at least one barcode.'); return; }
    if (!variant) { setNotice('Choose a label variant.'); return; }
    if (variant.factory) { setNotice(`The "${variant.name}" variant is not saved yet. Open Settings › Label Designer › Issue to coning, check it and press Save.`); return; }
    setBusy(true);
    setNotice('');
    const entries = selectedRows.map((row) => ({ id: row.id, copies: copiesOf(row), revision: row.revision, carryOver: Boolean(row.carryOver) }));
    try {
      const printTemplate = printableTemplate(template);
      if (sheet) {
        await printStageTemplatesBatch(STAGE, slots, { template: printTemplate, copies: 1 });
      } else {
        // A roll job holds at most MAX_PAGES rows; longer runs go to the label printer as several jobs.
        const perJob = MAX_PAGES * perPage;
        for (let i = 0; i < slots.length; i += perJob) {
          await printStageTemplatesBatch(STAGE, slots.slice(i, i + perJob), { template: printTemplate, copies: 1 });
        }
      }
      // Neither the print dialog nor the spooler can tell whether every sticker came out, so the operator confirms.
      setConfirmPrint({ entries, stickers: totalStickers, sheets: sheet ? sheets : 0 });
    } catch (err) {
      setNotice(err.message || 'Stickers could not be printed');
    } finally {
      setBusy(false);
    }
  };

  const markPrinted = async () => {
    if (!confirmPrint) return;
    setBusy(true);
    try {
      await markConingStickersPrinted(confirmPrint.entries, range.dateTo);
      setNotice(`${confirmPrint.stickers} stickers marked as printed.`);
      setConfirmPrint(null);
      setView('list');
      await load();
    } catch (err) {
      setNotice(err.message || 'Unable to mark the stickers as printed');
    } finally {
      setBusy(false);
    }
  };

  if (!open || !range) return null;
  let lastGroup = null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Coning issue stickers" onOpenChange={onOpenChange} className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <div className="space-y-3 text-left">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={view === 'preview' ? () => setView('list') : onBack} disabled={Boolean(confirmPrint)} className="gap-1">
              <ArrowLeft className="h-4 w-4" /> {view === 'preview' ? 'Back to list' : 'Change dates'}
            </Button>
            <span className="text-muted-foreground">{rangeText(range)}</span>
            <Button variant="ghost" size="sm" onClick={() => { setNotice(''); void load(); }} disabled={loading || busy || Boolean(confirmPrint)} className="ml-auto gap-1">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Reload
            </Button>
          </div>

          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {variants.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label htmlFor="coning-sticker-variant" className="font-medium">Label</label>
              <select id="coning-sticker-variant" value={variantId} disabled={busy || Boolean(confirmPrint)}
                onChange={(e) => { setVariantId(e.target.value); saveVariantChoice(e.target.value); setView('list'); setNotice(''); }}
                className="rounded-md border bg-background px-2 py-1.5">
                {variants.map((v) => <option key={v.id} value={v.id}>{variantLabel(v)}{v.factory ? ' (not saved yet)' : ''}</option>)}
              </select>
              <span className="text-xs text-muted-foreground">{sheet ? 'Opens the Windows print dialog: choose the office printer.' : "Prints straight to this workstation's label printer."}</span>
            </div>
          )}
          {variant?.factory && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              The “{variant.name}” variant is the factory design and is not saved yet. Open Settings › Label Designer › Issue to coning, check it and press Save before printing.
            </p>
          )}
          {truncated && <p className="text-sm text-amber-700">Showing the first 500 barcodes. Choose a shorter range to see the rest.</p>}

          {confirmPrint ? (
            <div className="rounded-lg border p-5 space-y-3">
              <p className="font-semibold">{confirmPrint.sheets
                ? `Did all ${confirmPrint.sheets} ${confirmPrint.sheets === 1 ? 'sheet' : 'sheets'} print correctly?`
                : `Did all ${confirmPrint.stickers} stickers print correctly?`}</p>
              <p className="text-sm text-muted-foreground">
                Marking them printed moves these {confirmPrint.entries.length} barcodes out of the “Not printed” list.
                If the printer jammed or you cancelled, leave them unprinted and print again.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={markPrinted} disabled={busy || !canMarkPrinted}>Yes, mark as printed</Button>
                <Button variant="outline" onClick={() => setConfirmPrint(null)} disabled={busy}>No, leave unprinted</Button>
              </div>
            </div>
          ) : view === 'preview' && artifact ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-sm">
                <Button variant="outline" size="sm" onClick={() => setPreviewPage((p) => Math.max(0, p - 1))} disabled={previewPage === 0} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
                <span>{sheet ? 'Sheet' : 'Row'} {previewPage + 1} of {artifact.pages.length}</span>
                <Button variant="outline" size="sm" onClick={() => setPreviewPage((p) => Math.min(artifact.pages.length - 1, p + 1))} disabled={previewPage >= artifact.pages.length - 1} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
              </div>
              <div className="flex justify-center rounded-lg bg-muted/40 p-3">
                <LabelArtifactPreview artifact={artifact} pageIndex={previewPage} maxWidthPx={460} />
              </div>
              {artifact.warnings?.length > 0 && <p className="text-xs text-amber-700">Some text was shrunk to fit: {artifact.warnings.slice(0, 3).join('; ')}</p>}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  Spare per barcode
                  <span className="inline-flex items-center rounded-md border bg-background">
                    <button type="button" className="px-2 py-1" onClick={() => setSpare((v) => Math.max(0, v - 1))} aria-label="Fewer spare stickers"><Minus className="h-3.5 w-3.5" /></button>
                    <b className="w-6 text-center tabular-nums">{spare}</b>
                    <button type="button" className="px-2 py-1" onClick={() => setSpare((v) => Math.min(10, v + 1))} aria-label="More spare stickers"><Plus className="h-3.5 w-3.5" /></button>
                  </span>
                  <span className="text-xs text-muted-foreground">copies = crates + spare</span>
                </span>
                <span className="inline-flex overflow-hidden rounded-md border bg-background">
                  <button type="button" onClick={() => setShowAll(false)} className={`px-3 py-1 ${!showAll ? 'bg-foreground text-background' : ''}`}>Not printed ({pendingCount})</button>
                  <button type="button" onClick={() => setShowAll(true)} className={`px-3 py-1 ${showAll ? 'bg-foreground text-background' : ''}`}>All ({rows.length})</button>
                </span>
                {sheet && <>
                <label className="flex items-center gap-2" htmlFor="coning-sticker-start">
                  Start at label
                  <input id="coning-sticker-start" type="number" min="1" max={perPage} value={startAt}
                    onChange={(e) => setStartAt(Math.min(perPage, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-16 rounded-md border bg-background px-2 py-1 text-center tabular-nums" />
                  <span className="text-xs text-muted-foreground">to finish a part-used sheet</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={newSheetPerShift} onChange={(e) => setNewSheetPerShift(e.target.checked)} className="h-4 w-4" />
                  Each shift on its own sheet
                </label>
                </>}
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div className="max-h-[52vh] overflow-auto rounded-lg border">
                  <table className="w-full min-w-[900px] text-sm">
                    <thead className="sticky top-0 z-10 bg-background">
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="w-8 p-2"><input type="checkbox" aria-label="Select all barcodes of the selected date" title="Select all barcodes of the selected date (carried over has its own)" checked={allSelectedIn(dateRows)} disabled={!dateRows.length} onChange={(e) => toggleAllIn(dateRows, e.target.checked)} className="h-4 w-4" /></th>
                        <th className="p-2">Worker</th>
                        <th className="p-2">Machine</th>
                        <th className="p-2">Barcode</th>
                        <th className="p-2">Item (cut) · twist</th>
                        <th className="p-2">Cone</th>
                        <th className="p-2 text-center">Crates</th>
                        <th className="p-2 text-center">Copies</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading…</td></tr>}
                      {!loading && visibleRows.length === 0 && (
                        <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">
                          {rows.length ? 'Every barcode in this range is printed. Choose All to reprint one.' : 'No coning issues in this range.'}
                        </td></tr>
                      )}
                      {!loading && carryRows.length > 0 && (
                        <tr className="border-b bg-sky-100 text-sky-900">
                          <td className="p-2 align-middle">
                            <input type="checkbox" aria-label="Select all carried-over barcodes" checked={allSelectedIn(carryRows)} onChange={(e) => toggleAllIn(carryRows, e.target.checked)} className="h-4 w-4" />
                          </td>
                          <td colSpan={8} className="p-0">
                            <button type="button" aria-expanded={carryOpen} onClick={() => setCarryOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-2 text-left text-xs">
                              <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${carryOpen ? 'rotate-90' : ''}`} />
                              <span className="font-bold tracking-wide whitespace-nowrap">CARRIED OVER ({carryRows.length})</span>
                              <span className="font-semibold whitespace-nowrap">· {selectedCountIn(carryRows)} of {carryRows.length} selected</span>
                              <span className="ml-auto shrink-0 font-semibold underline">{carryOpen ? 'Hide' : 'Show'}</span>
                              <span className="basis-full pl-6 font-normal">Material still to receive; stickers print with C/O. Check = older than 2 days: finish the batch or mark the rest as wastage.</span>
                            </button>
                          </td>
                        </tr>
                      )}
                      {!loading && [...(carryOpen ? carryRows : []), ...dateRows].map((row) => {
                        const group = shiftGroupKey(row);
                        const header = !row.carryOver && group !== lastGroup;
                        lastGroup = group;
                        const night = row.shift === 'Night';
                        return (
                          <React.Fragment key={row.id}>
                            {header && (
                              <tr className={night ? 'bg-slate-900 text-white' : 'bg-muted'}>
                                <td colSpan={9} className="px-2 py-1.5 text-xs font-bold tracking-wide">{`${(row.shift || 'No shift').toUpperCase()} SHIFT · ${formatDate(row.date)}`}</td>
                              </tr>
                            )}
                            <tr className={`border-b last:border-0 hover:bg-muted/40 ${row.carryOver ? 'bg-sky-50/60' : ''} ${!selected.has(row.id) ? 'text-muted-foreground' : ''}`}>
                              <td className="p-2"><input type="checkbox" aria-label={`Select ${row.barcode}`} checked={selected.has(row.id)} onChange={(e) => toggle(row.id, e.target.checked)} className="h-4 w-4" /></td>
                              <td className="p-2 font-semibold">{row.operatorName || '—'}{row.carryOver && <span className="block text-xs font-normal text-muted-foreground">{row.shift || 'No shift'} {formatDate(row.date)}</span>}</td>
                              <td className="p-2">{row.machineName || '—'}</td>
                              <td className="p-2 font-mono text-xs whitespace-nowrap">{row.barcode}</td>
                              <td className="p-2">{row.itemName}{row.cut ? ` (${row.cut})` : ''}{row.twist ? ` · ${row.twist}` : ''}</td>
                              <td className="p-2">{row.coneType || '—'}</td>
                              <td className="p-2 text-center tabular-nums">{row.crates}</td>
                              <td className="p-2 text-center">
                                <input type="number" min="1" max="100" aria-label={`Copies for ${row.barcode}`} value={copiesOf(row)}
                                  onChange={(e) => setCopyOverrides((prev) => ({ ...prev, [row.id]: Math.min(100, Math.max(1, Number(e.target.value) || 1)) }))}
                                  className="w-16 rounded-md border bg-background px-1 py-0.5 text-center tabular-nums" />
                              </td>
                              <td className="p-2"><StatusPill row={row} /></td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                      {!loading && dateRows.length === 0 && carryRows.length > 0 && (
                        <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No barcodes of the selected date to print. Carried-over batches are in the section above.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2 rounded-lg border p-3 text-sm">
                  <div className="text-xs font-semibold text-muted-foreground">This print</div>
                  <div className="text-3xl font-extrabold tabular-nums">{totalStickers}</div>
                  <div className="text-xs text-muted-foreground">stickers</div>
                  <div className="flex justify-between border-t pt-2"><span>Barcodes</span><b className="tabular-nums">{selectedRows.length}</b></div>
                  {sheet
                    ? <div className="flex justify-between"><span>A4 sheets ({perPage} per sheet)</span><b className="tabular-nums">{sheets}</b></div>
                    : <div className="flex justify-between"><span>Label printer jobs</span><b className="tabular-nums">{Math.ceil(Math.ceil(slots.length / perPage) / MAX_PAGES) || 0}</b></div>}
                </div>
              </div>
            </>
          )}

          {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}

          {!confirmPrint && (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              {view === 'list' && <Button variant="outline" onClick={openPreview} disabled={busy || loading || !template}>{sheet ? 'Preview sheets' : 'Preview'}</Button>}
              <Button onClick={print} disabled={busy || loading || !template || !canMarkPrinted || Boolean(variant?.factory)} className="gap-2">
                <Printer className="h-4 w-4" /> {busy ? 'Preparing…' : `Print ${totalStickers} stickers`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
