import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useInventory } from '../context/InventoryContext';
import * as api from '../api/client';
import {
    Button, Input, Card, CardContent, CardHeader, CardTitle,
    Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge
} from '../components/ui';
import { formatKg, todayISO, formatDateDDMMYYYY } from '../utils';
import {
    Flame, Trash2, Loader2, AlertCircle, CheckCircle2, Ban,
    Search, History, Package, ScanLine, RefreshCw, X
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useMobileDetect } from '../utils/useMobileDetect';
import { MobileBoilerView } from '../components/boiler/MobileBoilerView';
import { usePermission } from '../hooks/usePermission';
import AccessDenied from '../components/common/AccessDenied';

/**
 * Boiler (Steaming) Module
 * Track which crates from Holo have been steamed
 */
export function Boiler() {
    const { process } = useInventory();
    const { canRead, canWrite } = usePermission('boiler');
    const readOnly = canRead && !canWrite;
    const { isMobile, isTouchDevice } = useMobileDetect();
    const [useMobileMode, setUseMobileMode] = useState(false);
    const [activeTab, setActiveTab] = useState('steam'); // 'steam' | 'history'

    // Steam form state
    const [barcodeInput, setBarcodeInput] = useState('');
    const [scannedItems, setScannedItems] = useState([]);
    const [lookingUp, setLookingUp] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef(null);

    // History state
    const [steamedHistory, setSteamedHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [historyDate, setHistoryDate] = useState(todayISO());
    const [historySearch, setHistorySearch] = useState('');

    // Auto-enable mobile mode on mobile devices
    useEffect(() => {
        if (isMobile && isTouchDevice) {
            setUseMobileMode(true);
        }
    }, [isMobile, isTouchDevice]);

    // Load history when tab changes or date changes
    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory();
        }
    }, [activeTab, historyDate]);

    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const result = await api.boilerListSteamed(historyDate);
            setSteamedHistory(result.items || []);
        } catch (err) {
            console.error('Failed to load steamed history:', err);
            setSteamedHistory([]);
        } finally {
            setLoadingHistory(false);
        }
    }, [historyDate]);

    // Filter history based on search
    const filteredHistory = useMemo(() => {
        if (!historySearch.trim()) return steamedHistory;
        const terms = historySearch.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
        return steamedHistory.filter(item => {
            const searchable = [
                item.barcode,
                item.lotNo,
                item.boxName,
                item.rollTypeName,
            ].filter(Boolean).join(' ').toLowerCase();
            return terms.every(term => searchable.includes(term));
        });
    }, [steamedHistory, historySearch]);

    // Add barcode to list
    const handleAddBarcode = async () => {
        if (readOnly) return;
        const normalized = barcodeInput.trim().toUpperCase();
        if (!normalized) return;

        if (scannedItems.some(item => item.scannedBarcode === normalized)) {
            setBarcodeInput('');
            return; // Already in list
        }

        // Add placeholder
        const placeholder = {
            scannedBarcode: normalized,
            status: 'loading',
            id: `temp-${normalized}`,
        };
        setScannedItems(prev => [placeholder, ...prev]);
        setBarcodeInput('');
        setLookingUp(true);

        try {
            const result = await api.boilerLookup(normalized);

            if (result.found) {
                setScannedItems(prev => prev.map(item =>
                    item.scannedBarcode === normalized
                        ? {
                            ...result,
                            scannedBarcode: normalized,
                            status: result.isSteamed ? 'already_steamed' : 'found',
                        }
                        : item
                ));
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
            setLookingUp(false);
            inputRef.current?.focus();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddBarcode();
        }
    };

    // Remove item
    const removeItem = (scannedBarcode) => {
        setScannedItems(prev => prev.filter(item => item.scannedBarcode !== scannedBarcode));
    };

    // Get steamable items
    const steamableItems = scannedItems.filter(item => item.status === 'found');

    // Mark all as steamed
    const handleMarkSteamed = async () => {
        if (readOnly) return;
        if (steamableItems.length === 0) return;

        setSubmitting(true);
        try {
            const barcodes = steamableItems.map(item => item.barcode || item.scannedBarcode);
            const result = await api.boilerMarkSteamed(barcodes);

            if (result.ok) {
                setScannedItems(prev => prev.filter(item => item.status !== 'found'));
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

    // Handle mobile steam complete
    const handleMobileSteamComplete = (count) => {
        // Refresh history if on history tab
    };

    if (!canRead) {
        return (
            <div className="space-y-6 fade-in">
                <h1 className="text-2xl font-bold tracking-tight">Boiler (Steaming)</h1>
                <AccessDenied message="You do not have access to the boiler module. Contact an administrator to request access." />
            </div>
        );
    }

    // Show warning if not Holo process
    if (process !== 'holo') {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Flame className="w-6 h-6 text-orange-500" />
                        Boiler (Steaming)
                    </h1>
                    <p className="text-muted-foreground text-sm">Mark Holo crates as steamed after boiler processing</p>
                </div>
                <Card>
                    <CardContent className="py-12 text-center">
                        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-yellow-500" />
                        <h2 className="text-xl font-semibold mb-2">Boiler Module Not Available</h2>
                        <p className="text-muted-foreground">
                            The Boiler (Steaming) module is only available when the <strong>Holo</strong> process is selected.
                            <br />
                            Please switch to Holo process from the sidebar to use this module.
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Mobile view
    if (useMobileMode) {
        return (
            <div className="space-y-4">
                {/* Header with toggle */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                            <Flame className="w-6 h-6 text-orange-500" />
                            Boiler (Steaming)
                        </h1>
                        <p className="text-muted-foreground text-sm">Mark Holo crates as steamed</p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUseMobileMode(false)}
                        className="flex items-center gap-2"
                    >
                        <Package className="w-4 h-4" />
                        <span>Table View</span>
                    </Button>
                </div>
                <MobileBoilerView onSteamComplete={handleMobileSteamComplete} />
            </div>
        );
    }

    // Desktop view
    return (
        <div className="space-y-6 fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Flame className="w-6 h-6 text-orange-500" />
                        Boiler (Steaming)
                    </h1>
                    <p className="text-muted-foreground text-sm">Mark Holo crates as steamed after boiler processing</p>
                </div>

                {/* Tab Toggle + Scanner Toggle */}
                <div className="flex gap-2">
                    {activeTab === 'steam' && (
                        <Button
                            variant={useMobileMode ? "default" : "outline"}
                            size="sm"
                            onClick={() => setUseMobileMode(!useMobileMode)}
                            className="flex items-center gap-2"
                        >
                            <ScanLine className="w-4 h-4" />
                            <span className="hidden sm:inline">Scanner</span>
                        </Button>
                    )}

                    <div className="flex p-1 bg-muted rounded-lg">
                        <button
                            onClick={() => setActiveTab('steam')}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2",
                                activeTab === 'steam'
                                    ? "bg-background shadow text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Flame className="w-4 h-4" />
                            Steam
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2",
                                activeTab === 'history'
                                    ? "bg-background shadow text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <History className="w-4 h-4" />
                            History
                        </button>
                    </div>
                </div>
            </div>

            {activeTab === 'steam' ? (
                <>
                    {/* Scan Input Card */}
                    <Card>
                        <CardContent className="p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-medium">Scan Barcodes</div>
                                    <div className="text-xs text-muted-foreground">Use scanner gun and press Enter, or type manually</div>
                                </div>
                                {scannedItems.length > 0 && (
                                    <Button size="sm" variant="ghost" onClick={() => setScannedItems([])} disabled={readOnly}>
                                        Clear All
                                    </Button>
                                )}
                            </div>
                            {readOnly && (
                                <div className="text-xs text-muted-foreground">
                                    Read-only access: scanning and steaming actions are disabled.
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Input
                                    ref={inputRef}
                                    placeholder="Scan or enter barcode..."
                                    value={barcodeInput}
                                    onChange={e => setBarcodeInput(e.target.value.toUpperCase())}
                                    onKeyDown={handleKeyDown}
                                    className="font-mono"
                                    autoFocus
                                    disabled={readOnly}
                                />
                                <Button
                                    variant="outline"
                                    onClick={handleAddBarcode}
                                    disabled={!barcodeInput.trim() || lookingUp || readOnly}
                                >
                                    {lookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                </Button>
                            </div>

                            {/* Scanned items badges */}
                            {scannedItems.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {scannedItems.slice(0, 12).map(item => (
                                        <Badge
                                            key={item.scannedBarcode}
                                            variant="outline"
                                            className={cn(
                                                "cursor-pointer hover:bg-destructive/10 group",
                                                item.status === 'found' && 'border-green-600 text-green-600',
                                                item.status === 'already_steamed' && 'border-orange-500 text-orange-500',
                                                item.status === 'not_found' && 'border-red-600 text-red-600',
                                                item.status === 'loading' && 'border-blue-500 text-blue-500'
                                            )}
                                            onClick={() => { if (!readOnly) removeItem(item.scannedBarcode); }}
                                        >
                                            {item.status === 'loading' && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                                            {item.scannedBarcode}
                                            <X className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-100" />
                                        </Badge>
                                    ))}
                                    {scannedItems.length > 12 && (
                                        <Badge variant="outline">+{scannedItems.length - 12} more</Badge>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Scanned Items Table */}
                    <Card>
                        <CardHeader>
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <CardTitle className="text-lg">
                                    Scanned Items ({scannedItems.length})
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                    {steamableItems.length > 0 && (
                                        <Button
                                            onClick={handleMarkSteamed}
                                            disabled={submitting || readOnly}
                                            className="bg-orange-500 hover:bg-orange-600"
                                        >
                                            <Flame className="w-4 h-4 mr-2" />
                                            {submitting ? 'Processing...' : `Mark Steamed (${steamableItems.length})`}
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[50px]">Status</TableHead>
                                            <TableHead>Barcode</TableHead>
                                            <TableHead>Lot No</TableHead>
                                            <TableHead className="text-right">Rolls</TableHead>
                                            <TableHead className="text-right">Net Weight</TableHead>
                                            <TableHead>Box</TableHead>
                                            <TableHead className="w-[80px]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {scannedItems.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <Flame className="w-8 h-8 opacity-50" />
                                                        <span>Scan barcodes to add items for steaming</span>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            scannedItems.map(item => (
                                                <TableRow key={item.scannedBarcode} className={cn(
                                                    item.status === 'found' && 'bg-green-500/5',
                                                    item.status === 'already_steamed' && 'bg-orange-500/5',
                                                    item.status === 'not_found' && 'bg-red-500/5'
                                                )}>
                                                    <TableCell>
                                                        {item.status === 'loading' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                                                        {item.status === 'found' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                                                        {item.status === 'already_steamed' && <Ban className="w-4 h-4 text-orange-500" />}
                                                        {(item.status === 'not_found' || item.status === 'error') && <AlertCircle className="w-4 h-4 text-red-500" />}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-sm">{item.scannedBarcode}</TableCell>
                                                    <TableCell>{item.lotNo || '—'}</TableCell>
                                                    <TableCell className="text-right">{item.rollCount || '—'}</TableCell>
                                                    <TableCell className="text-right">
                                                        {item.netWeight != null ? formatKg(item.netWeight) : '—'}
                                                    </TableCell>
                                                    <TableCell>{item.boxName || '—'}</TableCell>
                                                    <TableCell>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="text-destructive hover:text-destructive"
                                                            onClick={() => { if (!readOnly) removeItem(item.scannedBarcode); }}
                                                            disabled={readOnly}
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </>
            ) : (
                /* History Tab */
                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <CardTitle className="text-lg">
                                Steamed Items History
                            </CardTitle>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <div className="relative w-full sm:w-64">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Search by barcode, lot..."
                                        className="pl-10 h-9"
                                        value={historySearch}
                                        onChange={e => setHistorySearch(e.target.value)}
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="date"
                                        value={historyDate}
                                        onChange={e => setHistoryDate(e.target.value)}
                                        className="h-9 w-36"
                                    />
                                    <Button size="sm" variant="outline" onClick={loadHistory} disabled={loadingHistory}>
                                        <RefreshCw className={cn("w-4 h-4", loadingHistory && "animate-spin")} />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Barcode</TableHead>
                                        <TableHead>Lot No</TableHead>
                                        <TableHead className="text-right">Rolls</TableHead>
                                        <TableHead className="text-right">Net Weight</TableHead>
                                        <TableHead>Box</TableHead>
                                        <TableHead>Machine</TableHead>
                                        <TableHead>Steamed At</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loadingHistory ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-24 text-center">
                                                <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" />
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredHistory.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                                <div className="flex flex-col items-center gap-2">
                                                    <History className="w-8 h-8 opacity-50" />
                                                    <span>No items steamed on this date</span>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredHistory.map(item => (
                                            <TableRow key={item.id}>
                                                <TableCell className="font-mono text-sm">{item.barcode}</TableCell>
                                                <TableCell>{item.lotNo || '—'}</TableCell>
                                                <TableCell className="text-right">{item.rollCount || '—'}</TableCell>
                                                <TableCell className="text-right">
                                                    {item.netWeight != null ? formatKg(item.netWeight) : '—'}
                                                </TableCell>
                                                <TableCell>{item.boxName || '—'}</TableCell>
                                                <TableCell>{item.machineName || '—'}</TableCell>
                                                <TableCell>
                                                    {new Date(item.steamedAt).toLocaleTimeString()}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="mt-4 text-center text-sm text-muted-foreground">
                            Total: <strong>{filteredHistory.length}</strong> items steamed
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

export default Boiler;
