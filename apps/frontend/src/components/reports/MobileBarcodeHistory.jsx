import React, { useState, useCallback } from 'react';
import { BarcodeScanner } from '../scanner/BarcodeScanner';
import {
    Button, Input, Card, CardContent, Badge
} from '../ui';
import { formatKg, formatDateDDMMYYYY } from '../../utils';
import {
    Keyboard, ScanLine, Loader2, Package,
    Clock, ChevronDown, ChevronRight, Search,
    Factory, Truck
} from 'lucide-react';
import { cn } from '../../lib/utils';
import * as api from '../../api/client';

const STAGE_ICONS = {
    inbound: Package,
    cutter_issue: Factory,
    cutter_receive: Factory,
    holo_issue: Factory,
    holo_receive: Factory,
    coning_issue: Factory,
    coning_receive: Factory,
    dispatch: Truck,
};

const STAGE_COLORS = {
    inbound: 'bg-blue-500',
    cutter_issue: 'bg-orange-500',
    cutter_receive: 'bg-orange-400',
    holo_issue: 'bg-purple-500',
    holo_receive: 'bg-purple-400',
    coning_issue: 'bg-teal-500',
    coning_receive: 'bg-teal-400',
    dispatch: 'bg-green-500',
};

const STAGE_LABELS = {
    inbound: 'Inbound',
    cutter_issue: 'Issued to Cutter',
    cutter_receive: 'Received from Cutter',
    holo_issue: 'Issued to Holo',
    holo_receive: 'Received from Holo',
    coning_issue: 'Issued to Coning',
    coning_receive: 'Received from Coning',
    dispatch: 'Dispatched',
};

/**
 * Mobile-optimized barcode history view with camera scanning
 * Split screen: camera on top, barcode history results on bottom
 */
export function MobileBarcodeHistory() {
    const [isManualMode, setIsManualMode] = useState(false);
    const [manualBarcode, setManualBarcode] = useState('');
    const [searching, setSearching] = useState(false);
    const [history, setHistory] = useState(null);
    const [expandedStages, setExpandedStages] = useState(new Set());
    const [lastScanned, setLastScanned] = useState(null);

    // Handle barcode scan from camera
    const handleBarcodeScan = useCallback(async (barcode) => {
        const normalized = barcode.trim().toUpperCase();

        // Avoid re-scanning same barcode
        if (lastScanned === normalized) return;
        setLastScanned(normalized);

        await fetchBarcodeHistory(normalized);
    }, [lastScanned]);

    // Fetch barcode history
    const fetchBarcodeHistory = async (barcode) => {
        setSearching(true);
        setHistory(null);
        try {
            const res = await api.getBarcodeHistory(barcode);
            setHistory(res.history);
            // Expand all stages by default
            if (res.history?.lineage) {
                setExpandedStages(new Set(res.history.lineage.map((_, i) => i)));
            }
        } catch (err) {
            setHistory({ found: false, barcode, error: err.message });
        } finally {
            setSearching(false);
        }
    };

    // Handle manual barcode entry
    const handleManualSubmit = (e) => {
        e.preventDefault();
        if (manualBarcode.trim()) {
            fetchBarcodeHistory(manualBarcode.trim().toUpperCase());
            setManualBarcode('');
        }
    };

    // Toggle stage expansion
    const toggleStage = (index) => {
        setExpandedStages(prev => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] bg-background">
            {/* Header */}
            <div className="flex items-center justify-between p-3 bg-muted/50 shrink-0">
                <div className="flex items-center gap-2">
                    <Search className="w-5 h-5 text-primary" />
                    <span className="font-semibold">Barcode History</span>
                </div>
                {history?.found && (
                    <Badge variant="outline" className="font-mono">
                        {history.barcode}
                    </Badge>
                )}
            </div>

            {/* Top section - Scanner or Manual Entry */}
            <div className="h-[45%] shrink-0 relative">
                {isManualMode ? (
                    <div className="h-full flex flex-col items-center justify-center p-4 bg-muted/30">
                        <Keyboard className="w-12 h-12 text-muted-foreground mb-4" />
                        <form onSubmit={handleManualSubmit} className="w-full max-w-sm space-y-4">
                            <Input
                                placeholder="Enter barcode manually..."
                                value={manualBarcode}
                                onChange={e => setManualBarcode(e.target.value.toUpperCase())}
                                className="text-center text-lg font-mono"
                                autoFocus
                            />
                            <Button type="submit" className="w-full" disabled={!manualBarcode.trim() || searching}>
                                {searching ? (
                                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Searching...</>
                                ) : (
                                    <><Search className="w-4 h-4 mr-2" /> Search Barcode</>
                                )}
                            </Button>
                        </form>
                    </div>
                ) : (
                    <BarcodeScanner
                        onScan={handleBarcodeScan}
                        className="h-full"
                        disabled={searching}
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

            {/* Bottom section - Results */}
            <div className="flex-1 overflow-hidden flex flex-col border-t">
                {/* Results Header */}
                <div className="flex items-center justify-between p-3 bg-muted/30 shrink-0">
                    <div className="flex items-center gap-2">
                        <Clock className="w-5 h-5" />
                        <span className="font-medium">
                            {history?.found ? 'Barcode Journey' : 'Scan Results'}
                        </span>
                    </div>
                    {history?.lineage?.length > 0 && (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                                const allExpanded = expandedStages.size === history.lineage.length;
                                if (allExpanded) {
                                    setExpandedStages(new Set());
                                } else {
                                    setExpandedStages(new Set(history.lineage.map((_, i) => i)));
                                }
                            }}
                            className="h-7 text-xs"
                        >
                            {expandedStages.size === history.lineage.length ? 'Collapse' : 'Expand'}
                        </Button>
                    )}
                </div>

                {/* Results Content */}
                <div className="flex-1 overflow-y-auto p-3">
                    {searching ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                            <Loader2 className="w-10 h-10 mb-2 animate-spin" />
                            <p className="text-sm">Searching barcode history...</p>
                        </div>
                    ) : !history ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                            <ScanLine className="w-10 h-10 mb-2 opacity-50" />
                            <p className="text-sm">Scan a barcode to view its history</p>
                        </div>
                    ) : !history.found ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                            <Package className="w-10 h-10 mb-2 opacity-50" />
                            <p className="text-sm font-medium">No records found</p>
                            <p className="text-xs mt-1">
                                Barcode: <span className="font-mono">{history.barcode}</span>
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {history.lineage.map((stage, index) => {
                                const Icon = STAGE_ICONS[stage.stage] || Package;
                                const isExpanded = expandedStages.has(index);
                                const colorClass = STAGE_COLORS[stage.stage] || 'bg-gray-500';

                                return (
                                    <Card
                                        key={index}
                                        className={cn(
                                            "transition-all",
                                            isExpanded && "ring-1 ring-primary/20"
                                        )}
                                    >
                                        <div
                                            className="p-3 flex items-center justify-between cursor-pointer"
                                            onClick={() => toggleStage(index)}
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className={cn(
                                                    "w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0",
                                                    colorClass
                                                )}>
                                                    <Icon className="w-4 h-4" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="font-medium text-sm truncate">
                                                        {STAGE_LABELS[stage.stage] || stage.stage}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        {stage.date ? formatDateDDMMYYYY(stage.date) : 'Not recorded'}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {(stage.data?.weight || stage.data?.netWeight) && (
                                                    <Badge variant="outline" className="text-xs">
                                                        {formatKg(stage.data.weight || stage.data.netWeight)}
                                                    </Badge>
                                                )}
                                                {isExpanded ? (
                                                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                                                ) : (
                                                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                                                )}
                                            </div>
                                        </div>

                                        {/* Stage Details */}
                                        {isExpanded && stage.data && (
                                            <div className="px-3 pb-3 pt-0 border-t">
                                                <div className="pt-2 grid grid-cols-2 gap-2 text-xs">
                                                    {Object.entries(stage.data)
                                                        .filter(([key, value]) =>
                                                            value !== null &&
                                                            value !== undefined &&
                                                            !['pieceId', 'issueId', 'receiveId', 'dispatchId'].includes(key)
                                                        )
                                                        .map(([key, value]) => (
                                                            <div key={key} className="bg-muted/50 p-2 rounded">
                                                                <div className="text-muted-foreground text-[10px] capitalize">
                                                                    {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                                                                </div>
                                                                <div className="font-medium truncate">
                                                                    {typeof value === 'number' && key.toLowerCase().includes('weight')
                                                                        ? formatKg(value)
                                                                        : String(value || '—')}
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            </div>
                                        )}
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default MobileBarcodeHistory;
