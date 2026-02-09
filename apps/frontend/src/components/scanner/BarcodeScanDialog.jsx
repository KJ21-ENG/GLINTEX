import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent } from '../ui/Dialog';
import { BarcodeScanner } from './BarcodeScanner';

export function BarcodeScanDialog({
  open,
  onOpenChange,
  title = 'Scan Barcode',
  helperText = 'Point camera at barcode',
  onScanned,
}) {
  const [invalid, setInvalid] = useState(null);
  const invalidTimerRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setInvalid(null);
      if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
      invalidTimerRef.current = null;
    }
  }, [open]);

  const flashInvalid = (value) => {
    setInvalid(value);
    if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
    invalidTimerRef.current = setTimeout(() => {
      setInvalid(null);
      invalidTimerRef.current = null;
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title}
        onOpenChange={onOpenChange}
        className="max-w-xl"
      >
        {helperText ? (
          <div className="text-sm text-muted-foreground mb-3">{helperText}</div>
        ) : null}

        {invalid ? (
          <div className="text-sm text-destructive mb-3 break-all">
            Invalid barcode: {invalid}
          </div>
        ) : null}

        <div className="h-[60vh] max-h-[520px]">
          <BarcodeScanner
            className="h-full"
            onScan={(code) => {
              setInvalid(null);
              onScanned?.(code);
            }}
            onInvalidScan={(code) => flashInvalid(code)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BarcodeScanDialog;

