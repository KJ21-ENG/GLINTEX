import React, { useState, useCallback } from 'react';
import { BarcodeScanner } from '../components/scanner/BarcodeScanner';
import {
    Button, Input, Card, CardContent, CardHeader, CardTitle, Badge
} from '../components/ui';
import * as api from '../api/client';
import {
    Trash2, Package, Keyboard, ScanLine,
    Loader2, AlertCircle, CheckCircle2, Flame
} from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Boiler (Steaming) Module - Mobile optimized
 * Scan boxes or roll barcodes and mark them as steamed
 */
export function Boiler() {
    const [scannedItems, setScannedItems] = useState([]);
    const [isManualMode, setIsManualMode] = useState(false);
    const [manualBarcode, setManualBarcode] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Handle barcode scan (from camera or manual)
    const handleBarcodeScan = useCallback((barcode) => {
        const normalized = barcode.trim().toUpperCase();
        if (!normalized) return;

        // Check if already in list
        if (scannedItems.some(item => item.barcode === normalized)) {
            return;
        }

        // Add to list with 'pending' status
        setScannedItems(prev => [{
            barcode: normalized,
            status: 'pending',
        }, ...prev]);
    }, [scannedItems]);

    // Handle manual barcode entry
    const handleManualSubmit = (e) => {
        e.preventDefault();
        if (manualBarcode.trim()) {
            handleBarcodeScan(manualBarcode.trim());
            setManualBarcode('');
        }
    };

    // Remove item from list
    const removeItem = (barcode) => {
        setScannedItems(prev => prev.filter(item => item.barcode !== barcode));
    };

    // Clear all items
    const clearAll = () => {
        setScannedItems([]);
    };

    // Mark all scanned items as steamed
    const handleSteamAll = async () => {
        const barcodes = scannedItems.map(item => item.barcode);
        if (barcodes.length === 0) return;

        if (!confirm(`Mark ${barcodes.length} item(s) as Steamed?`)) return;

        setSubmitting(true);
        try {
            const res = await api.steamBoilerItems(barcodes);

            if (res.ok) {
                alert(`Successfully steamed ${res.count} item(s)!`);
                setScannedItems([]);
            } else {
                alert(res.message || 'Some items could not be processed');
            }
        } catch (err) {
            console.error(err);
            alert(err.message || 'Failed to steam items');
        } finally {
            setSubmitting(false);
        }
    };

    const pendingItems = scannedItems.filter(item => item.status === 'pending');

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] bg-background">
            {/* Header */}
            <div className="p-4 border-b bg-card shrink-0">
                <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-primary" />
                    <h1 className="text-lg font-bold">Boiler (Steaming)</h1>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                    Scan rolls or boxes to mark as steamed
                </p>
            </div>

            {/* Top half - Scanner or Manual Entry */}
            <div className="h-[40%] shrink-0 relative">
                {isManualMode ? (
                    <div className="h-full flex flex-col items-center justify-center p-4 bg-muted/30">
                        <Keyboard className="w-12 h-12 text-muted-foreground mb-4" />
                        <form onSubmit={handleManualSubmit} className="w-full max-w-sm space-y-4">
                            <Input
                                placeholder="Enter barcode manually..."
                                value={manualBarcode}
                                onChange={e => setManualBarcode(e.target.value)}
                                className="text-center text-lg"
                                autoFocus
                            />
                            <Button type="submit" className="w-full" disabled={!manualBarcode.trim()}>
                                Add Barcode
                            </Button>
                        </form>
                    </div>
                ) : (
                    <BarcodeScanner
                        onScan={handleBarcodeScan}
                        className="h-full"
                    />
                )}

                {/* Mode toggle button */}
                <Button
                    size="sm"
                    variant="secondary"
                    className="absolute bottom-3 right-3 shadow-lg"
                    onClick={() => setIsManualMode(!isManualMode)}
                >
                    {isManualMode ? (
                        <><ScanLine className="w-4 h-4 mr-1" /> Scanner</>
                    ) : (
                        <><Keyboard className="w-4 h-4 mr-1" /> Manual</>
                    )}
                </Button>
            </div>

            {/* Bottom half - Scanned items list */}
            <div className="flex-1 overflow-hidden flex flex-col border-t">
                {/* Header */}
                <div className="flex items-center justify-between p-3 bg-muted/30 shrink-0">
                    <div className="flex items-center gap-2">
                        <Package className="w-5 h-5" />
                        <span className="font-medium">
                            Scan Queue ({pendingItems.length})
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {pendingItems.length > 0 && (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={clearAll}
                                className="text-xs"
                            >
                                Clear All
                            </Button>
                        )}
                    </div>
                </div>

                {/* Items list */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {scannedItems.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                            <ScanLine className="w-10 h-10 mb-2 opacity-50" />
                            <p className="text-sm">Scan barcodes to add items</p>
                        </div>
                    ) : (
                        scannedItems.map((item) => (
                            <div
                                key={item.barcode}
                                className={cn(
                                    "flex items-center gap-3 p-3 rounded-lg border bg-card",
                                    item.status === 'pending' && "border-blue-500/50 bg-blue-500/5"
                                )}
                            >
                                {/* Status icon */}
                                <div className="shrink-0">
                                    {item.status === 'pending' && (
                                        <CheckCircle2 className="w-5 h-5 text-blue-500" />
                                    )}
                                </div>

                                {/* Item info */}
                                <div className="flex-1 min-w-0">
                                    <p className="font-mono text-sm font-medium truncate">
                                        {item.barcode}
                                    </p>
                                </div>

                                {/* Remove button */}
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive shrink-0"
                                    onClick={() => removeItem(item.barcode)}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))
                    )}
                </div>

                {/* Fixed bottom action button */}
                {pendingItems.length > 0 && (
                    <div className="p-3 border-t bg-card shrink-0">
                        <Button
                            size="lg"
                            className="w-full"
                            onClick={handleSteamAll}
                            disabled={submitting}
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Flame className="w-4 h-4 mr-2" />
                                    Mark {pendingItems.length} Item(s) as Steamed
                                </>
                            )}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default Boiler;
