import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';

/**
 * Generic confirmation dialog. Backdrop click and the X button both route to
 * onCancel, so dismissing without an explicit choice is always the safe path.
 */
export function ConfirmDialog({
    open,
    title = 'Are you sure?',
    message,
    confirmLabel = 'Discard & continue',
    cancelLabel = 'Stay',
    destructive = true,
    onConfirm,
    onCancel,
}) {
    if (!open || typeof document === 'undefined') return null;

    return createPortal(
        <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel?.(); }}>
            <DialogContent title={title} onOpenChange={(v) => { if (!v) onCancel?.(); }}>
                <div className="flex flex-col gap-4">
                    <div className="flex items-start gap-3 text-sm">
                        {destructive && <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />}
                        <p className="text-muted-foreground">{message}</p>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={onCancel}>
                            {cancelLabel}
                        </Button>
                        <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
                            {confirmLabel}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>,
        document.body
    );
}

export default ConfirmDialog;
