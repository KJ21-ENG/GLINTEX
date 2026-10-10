import React, { useEffect, useState } from 'react';
import { Printer, AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/ui';
import { Dialog, DialogContent } from '../../../components/ui/Dialog';
import LabelArtifactPreview from '../../../components/labels/LabelArtifactPreview';
import { buildPrintableArtifact, hasDesktopPrinting } from '../../../utils/labelPrint';

// The page exactly as the printer receives it: roll width, columns, rotation, copies.
export default function PrintPreviewDialog({ open, onOpenChange, template, stageKey, sampleData, dpi, onTestPrint, printing }) {
  const [artifact, setArtifact] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setArtifact(null); setError(null);
    buildPrintableArtifact(template, [sampleData], { stageKey, dpi, copies: 1 })
      .then((a) => { if (live) setArtifact(a); })
      .catch((e) => { if (live) setError(e.message || 'Could not build the page'); });
    return () => { live = false; };
  }, [open, template, stageKey, sampleData, dpi]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Print preview" onOpenChange={onOpenChange} className="max-w-2xl">
        <div className="space-y-4">
          {error ? <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
          {!artifact && !error ? <div className="text-sm text-muted-foreground">Building the page…</div> : null}
          {artifact ? (
            <>
              <div className="flex justify-center bg-slate-100 rounded-md p-4 overflow-auto max-h-[60vh]">
                <LabelArtifactPreview artifact={artifact} maxWidthPx={520} />
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                <span>Page {artifact.widthMm} × {artifact.heightMm} mm</span>
                <span>{artifact.profileSnapshot.columns} across · {artifact.profileSnapshot.columnMode === 'repeat' ? 'same label repeated' : 'labels in sequence'}</span>
                <span>{template.copies} {template.copies === 1 ? 'copy' : 'copies'} per transaction</span>
                <span>{dpi} dpi profile</span>
              </div>
              {artifact.warnings.length ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                  {artifact.warnings.map((w) => <div key={w} className="flex gap-2"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</div>)}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {hasDesktopPrinting() ? 'Sends this page silently to the workstation printer.' : 'Opens the system print dialog with this page; choose the label printer there.'}
                </p>
                <Button onClick={onTestPrint} disabled={printing}><Printer className="h-4 w-4 mr-2" />{printing ? 'Sending…' : 'Print test label'}</Button>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
