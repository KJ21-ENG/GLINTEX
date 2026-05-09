import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Button, Label } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';

const NOTE_MAX = 500;
const REASON_MAX = 200;
const REASON_MIN = 3;

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export function WastageNoteDialog({
  open,
  onOpenChange,
  mode = 'mark', // 'mark' | 'revert'
  stage,
  contextLine,
  weight,
  originalMark,
  defaultNote = '',
  busy = false,
  onConfirm,
}) {
  const [note, setNote] = useState(defaultNote || '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setNote(defaultNote || '');
      setReason('');
      setError('');
    }
  }, [open, defaultNote]);

  const isRevert = mode === 'revert';
  const reasonInvalid = isRevert && reason.trim().length > 0 && reason.trim().length < REASON_MIN;

  const submitLabel = isRevert ? 'Revert wastage' : 'Mark wastage';
  const title = isRevert ? 'Revert wastage' : 'Mark wastage';
  const stageLabel = stage ? stage.charAt(0).toUpperCase() + stage.slice(1) : '';

  const formattedWeight = useMemo(() => {
    const num = Number(weight);
    if (!Number.isFinite(num)) return '';
    return num.toFixed(3);
  }, [weight]);

  function handleSubmit() {
    if (busy) return;
    const trimmedNote = note.trim().slice(0, NOTE_MAX);
    if (isRevert) {
      const trimmedReason = reason.trim();
      if (trimmedReason.length < REASON_MIN) {
        setError(`Reason must be at least ${REASON_MIN} characters`);
        return;
      }
      onConfirm({ reason: trimmedReason.slice(0, REASON_MAX), note: trimmedNote || null });
      return;
    }
    onConfirm({ note: trimmedNote || null });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} onOpenChange={onOpenChange}>
        <div className="flex flex-col gap-4">
          {(stageLabel || contextLine || formattedWeight) && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
              {stageLabel && <div><span className="font-medium text-foreground">Stage:</span> {stageLabel}</div>}
              {contextLine && <div>{contextLine}</div>}
              {formattedWeight && (
                <div>
                  <span className="font-medium text-foreground">{isRevert ? 'Restoring' : 'Marking'}:</span>{' '}
                  {formattedWeight} kg
                </div>
              )}
            </div>
          )}

          {isRevert && originalMark && (
            <div className="rounded-md border border-amber-300/50 bg-amber-50/50 p-3 text-xs">
              <div className="flex items-center gap-1 mb-1 text-amber-700 font-medium">
                <AlertTriangle className="h-3 w-3" /> Original mark
              </div>
              {originalMark.createdAt && (
                <div><span className="text-muted-foreground">When:</span> {formatDate(originalMark.createdAt)}</div>
              )}
              {originalMark.actorUsername && (
                <div><span className="text-muted-foreground">By:</span> {originalMark.actorUsername}</div>
              )}
              {originalMark.note ? (
                <div className="mt-1"><span className="text-muted-foreground">Note:</span> "{originalMark.note}"</div>
              ) : (
                <div className="mt-1 italic text-muted-foreground">No note recorded.</div>
              )}
            </div>
          )}

          {isRevert && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="wastage-revert-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="wastage-revert-reason"
                rows={2}
                value={reason}
                onChange={(e) => { setReason(e.target.value); setError(''); }}
                maxLength={REASON_MAX}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="e.g. marked the wrong piece, weight entered incorrectly"
                disabled={busy}
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{reasonInvalid ? `Min ${REASON_MIN} characters` : ' '}</span>
                <span>{reason.length}/{REASON_MAX}</span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label htmlFor="wastage-note">
              Note <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <textarea
              id="wastage-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={isRevert ? 'Optional additional context' : 'e.g. damaged in transit, machine fault'}
              disabled={busy}
            />
            <div className="text-[11px] text-muted-foreground text-right">{note.length}/{NOTE_MAX}</div>
          </div>

          {error && <div className="text-xs text-destructive">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={busy || (isRevert && reason.trim().length < REASON_MIN)}
              variant={isRevert ? 'destructive' : 'default'}
            >
              {busy && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
              {submitLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
