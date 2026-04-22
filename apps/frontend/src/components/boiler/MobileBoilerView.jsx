import React, { useState, useCallback } from 'react';
import { BarcodeScanner } from '../scanner/BarcodeScanner';
import {
    Button, Input, Card, CardContent, Badge
} from '../ui';
import { formatKg } from '../../utils';
import {
    Trash2, Package, Keyboard, ScanLine, Flame,
    Loader2, AlertCircle, CheckCircle2, Ban
} from 'lucide-react';
import { cn } from '../../lib/utils';
import * as api from '../../api/client';
import { BoilerMachineDialog } from './BoilerMachineDialog';

/**
 * Mobile-optimized boiler view with barcode scanning
 * Split screen: camera on top, scanned items list on bottom
 */
export function MobileBoilerView({ onSteamComplete, boilerMachines = [] }) {
    const [scannedItems, setScannedItems] = useState([]);
    const [isManualMode, setIsManualMode] = useState(false);
    const [manualBarcode, setManualBarcode] = useState('');
    const [lookingUp, setLookingUp] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [showBoilerMachineDialog, setShowBoilerMachineDialog] = useState(false);

    // Look up a barcode and add to scanned items
    const handleBarcodeScan = useCallback(async (barcode) => {
        const normalized = barcode.trim().toUpperCase();
        // Check if already scanned
        if (scannedItems.some(item => item.scannedBarcode === normalized)) {
            return; // Already in list
        }

        // Add placeholder item
        const placeholderItem = {
            scannedBarcode: normalized,
            status: 'loading',
            id: `temp-${normalized}`,
        };
        setScannedItems(prev => [placeholderItem, ...prev]);
        setLookingUp(normalized);

        try {
            const result = await api.boilerLookup(normalized);

            if (result.found) {
                setScannedItems(prev => {
                    const withoutPlaceholder = prev.filter(item => item.scannedBarcode !== normalized);
                    return [{
                        ...result,
                        scannedBarcode: normalized,
                        status: result.isSteamed ? 'already_steamed' : 'found',
                    }, ...withoutPlaceholder];
                });
            } else {
                setScannedItems(prev => prev.map(item =>
                    item.scannedBarcode === normalized
                        ? { ...item, status: 'not_found', error: 'Not found in Holo receive' }
                        : item
                ));
            }
        } catch (err) {
            console.error('Lookup failed:', err);
            setScannedItems(prev => prev.map(item =>
                item.scannedBarcode === normalized
                    ? { ...item, status: 'error', error: err.message || 'Lookup failed' }
                    : item
            ));
        } finally {
            setLookingUp(null);
        }
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
    const removeItem = (scannedBarcode) => {
        setScannedItems(prev => prev.filter(item => item.scannedBarcode !== scannedBarcode));
    };

    // Get items ready to steam (found and not already steamed)
    const steamableItems = scannedItems.filter(item => item.status === 'found');

    // Open boiler machine dialog before steaming
    const handleMarkSteamed = () => {
        if (steamableItems.length === 0) {
            alert('No items available to steam');
            return;
        }
        if (boilerMachines.length === 0) {
            alert('No Boiler machines configured. Add BOILER machines in Masters > Machines first.');
            return;
        }
        setShowBoilerMachineDialog(true);
    };

    // Confirm steam with selected boiler machine
    const confirmSteam = async (boilerMachineId, boilerNumber) => {
        setSubmitting(true);
        try {
            const barcodes = steamableItems.map(item => item.barcode || item.scannedBarcode);
            const result = await api.boilerMarkSteamed(barcodes, boilerMachineId, boilerNumber);

            if (result.ok) {
                setScannedItems(prev =>
                    prev.filter(item => item.status !== 'found')
                );
                setShowBoilerMachineDialog(false);
                onSteamComplete?.(result.steamedCount);
            }
        } catch (err) {
            if (err.details?.duplicates) {
                alert(`Some items were already steamed: ${err.details.duplicates.join(', ')}`);
            } else {
                alert(err.message || 'Failed to mark as steamed');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] bg-background">
            {/* Header with steam button */}
            <div className="flex items-center justify-between p-3 bg-muted/50 shrink-0">
                <div className="flex items-center gap-2">
                    <Flame className="w-5 h-5 text-orange-500" />
                    <span className="font-semibold">Boiler Steaming</span>
                </div>
                {steamableItems.length > 0 && (
                    <Button
                        onClick={handleMarkSteamed}
                        disabled={submitting}
                        className="bg-orange-500 hover:bg-orange-600"
                    >
                        <Flame className="w-4 h-4 mr-2" />
                        {submitting ? 'Steaming...' : `Steam All (${steamableItems.length})`}
                    </Button>
                )}
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
                                onChange={e => setManualBarcode(e.target.value.toUpperCase())}
                                className="text-center text-lg"
                                autoFocus
                            />
                            <Button type="submit" className="w-full" disabled={!manualBarcode.trim()}>
                                <ScanLine className="w-4 h-4 mr-2" />
                                Add Barcode
                            </Button>
                        </form>
                    </div>
                ) : (
                    <BarcodeScanner
                        onScan={handleBarcodeScan}
                        className="h-full"
                        disabled={lookingUp !== null}
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
                            Scanned Items ({scannedItems.length})
                        </span>
                    </div>
                    {scannedItems.length > 0 && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setScannedItems([])}
                            className="text-xs"
                        >
                            Clear All
                        </Button>
                    )}
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
                                key={item.scannedBarcode}
                                className={cn(
                                    "flex items-center gap-3 p-3 rounded-lg border bg-card",
                                    item.status === 'found' && "border-green-500/50 bg-green-500/5",
                                    item.status === 'already_steamed' && "border-orange-500/50 bg-orange-500/5",
                                    item.status === 'not_found' && "border-yellow-500/50 bg-yellow-500/5",
                                    item.status === 'error' && "border-red-500/50 bg-red-500/5",
                                    item.status === 'loading' && "border-blue-500/50 bg-blue-500/5"
                                )}
                            >
                                {/* Status icon */}
                                <div className="shrink-0">
                                    {item.status === 'loading' && (
                                        <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                                    )}
                                    {item.status === 'found' && (
                                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                                    )}
                                    {item.status === 'already_steamed' && (
                                        <Ban className="w-5 h-5 text-orange-500" />
                                    )}
                                    {(item.status === 'not_found' || item.status === 'error') && (
                                        <AlertCircle className="w-5 h-5 text-yellow-500" />
                                    )}
                                </div>

                                {/* Item info */}
                                <div className="flex-1 min-w-0">
                                    <p className="font-mono text-sm font-medium truncate">
                                        {item.scannedBarcode}
                                    </p>
                                    {(item.status === 'found' || item.status === 'already_steamed') && (
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                                            {item.lotNo && <span>Lot: {item.lotNo}</span>}
                                            {item.rollCount && <span>Rolls: {item.rollCount}</span>}
                                            {item.netWeight != null && (
                                                <Badge variant="outline" className={cn(
                                                    item.status === 'found' ? "text-green-600 border-green-600" : "text-orange-600 border-orange-600"
                                                )}>
                                                    {formatKg(item.netWeight)}
                                                </Badge>
                                            )}
                                        </div>
                                    )}
                                    {item.status === 'already_steamed' && (
                                        <p className="text-xs text-orange-600 mt-1">Already steamed</p>
                                    )}
                                    {item.status === 'not_found' && (
                                        <p className="text-xs text-yellow-600">Not found in Holo receive</p>
                                    )}
                                    {item.status === 'error' && (
                                        <p className="text-xs text-red-600">{item.error}</p>
                                    )}
                                </div>

                                {/* Remove button */}
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive shrink-0"
                                    onClick={() => removeItem(item.scannedBarcode)}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Boiler Machine Dialog */}
            <BoilerMachineDialog
                open={showBoilerMachineDialog}
                onOpenChange={setShowBoilerMachineDialog}
                onConfirm={confirmSteam}
                submitting={submitting}
                itemCount={steamableItems.length}
                boilerMachines={boilerMachines}
            />
        </div>
    );
}

export default MobileBoilerView;
