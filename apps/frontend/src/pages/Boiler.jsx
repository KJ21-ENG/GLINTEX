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
    Search, History, Package, ScanLine, RefreshCw, X, ChevronDown, ChevronRight,
    Calendar, Send, Download
} from 'lucide-react';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { cn } from '../lib/utils';
import { useMobileDetect } from '../utils/useMobileDetect';
import { MobileBoilerView } from '../components/boiler/MobileBoilerView';
import { usePermission } from '../hooks/usePermission';
import AccessDenied from '../components/common/AccessDenied';
import { UserBadge } from '../components/common/UserBadge';
import { BoilerMachineDialog } from '../components/boiler/BoilerMachineDialog';
import { SheetColumnFilter, applySheetFilters } from '../components/common/SheetColumnFilters';
import {
    buildBoilerScanGroups,
    formatScanGroupValues,
    getScanGroupStatusParts,
    getScanGroupTone,
} from '../components/boiler/scanGrouping';

const DISPLAY_EMPTY = '—';

const isoNDaysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
};

const cleanText = (value) => String(value ?? '').trim();

const displayText = (value) => cleanText(value) || DISPLAY_EMPTY;

const getUserDisplayName = (user) => cleanText(user?.displayName) || cleanText(user?.username);

const getBoilerLabel = (item) => {
    const machine = cleanText(item?.boilerMachineName);
    const boilerNo = cleanText(item?.boilerNumber);
    if (machine && boilerNo) return `${machine} • No. ${boilerNo}`;
    if (machine) return machine;
    if (boilerNo) return `No. ${boilerNo}`;
    return '';
};

const formatHistoryTime = (value) => {
    if (!value) return DISPLAY_EMPTY;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return DISPLAY_EMPTY;
    return date.toLocaleTimeString();
};

const getHistoryDateKey = (value) => {
    if (!value) return '';
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
};

const formatHistoryDate = (value) => {
    const dateKey = getHistoryDateKey(value);
    return dateKey ? formatDateDDMMYYYY(dateKey) : DISPLAY_EMPTY;
};

const formatUniqueValues = (values) => {
    const list = Array.from(values || [])
        .map(cleanText)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return list.length ? list.join(', ') : DISPLAY_EMPTY;
};

const buildBoilerHistoryGroupKey = (item) => [
    getHistoryDateKey(item?.steamedAt) || DISPLAY_EMPTY,
    displayText(item?.yarnName),
    displayText(item?.itemName),
    displayText(item?.twistName),
    displayText(item?.cutName),
].join('::');

const getScanStatusIcon = (status, className = "w-4 h-4") => {
    if (status === 'loading') return <Loader2 className={cn(className, "text-blue-500 animate-spin")} />;
    if (status === 'found') return <CheckCircle2 className={cn(className, "text-green-500")} />;
    if (status === 'already_steamed') return <Ban className={cn(className, "text-orange-500")} />;
    if (status === 'not_found' || status === 'error') return <AlertCircle className={cn(className, "text-red-500")} />;
    return null;
};

const scanStatusBadgeClass = (status) => {
    if (status === 'found') return 'border-green-600 text-green-600';
    if (status === 'loading') return 'border-blue-500 text-blue-500';
    if (status === 'already_steamed') return 'border-orange-500 text-orange-500';
    if (status === 'not_found') return 'border-yellow-600 text-yellow-600';
    if (status === 'error') return 'border-red-600 text-red-600';
    return '';
};

const scanGroupRowClass = (group) => {
    const tone = getScanGroupTone(group);
    if (tone === 'found') return 'bg-green-500/5';
    if (tone === 'loading') return 'bg-blue-500/5';
    if (tone === 'already_steamed') return 'bg-orange-500/5';
    if (tone === 'not_found') return 'bg-yellow-500/5';
    if (tone === 'error') return 'bg-red-500/5';
    return '';
};

const renderScanGroupStatus = (group) => (
    <div className="flex flex-wrap items-center gap-1">
        {getScanGroupStatusParts(group).map(part => (
            <Badge key={part.key} variant="outline" className={cn("text-[11px]", scanStatusBadgeClass(part.key))}>
                {part.label}: {part.count}
            </Badge>
        ))}
    </div>
);

function formatDateDisplay(dateStr) {
    if (!dateStr) return 'Today';
    const today = todayISO();
    if (dateStr === today) return 'Today';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

/**
 * Boiler (Steaming) Module
 * Track which crates from Holo have been steamed
 */
export function Boiler() {
    const { process, db } = useInventory();
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
    const [showBoilerMachineDialog, setShowBoilerMachineDialog] = useState(false);
    const inputRef = useRef(null);
    const boilerMachines = useMemo(
        () => (db?.machines || [])
            .filter(machine => machine.processType === 'boiler')
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
        [db?.machines]
    );

    // History state
    const [steamedHistory, setSteamedHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [historyFrom, setHistoryFrom] = useState(() => isoNDaysAgo(6));
    const [historyTo, setHistoryTo] = useState(todayISO());
    const [historySearch, setHistorySearch] = useState('');
    const [historySheetFilters, setHistorySheetFilters] = useState({});
    const [openHistoryFilterId, setOpenHistoryFilterId] = useState(null);
    const [expandedHistoryGroups, setExpandedHistoryGroups] = useState(() => new Set());
    const [expandedScanGroups, setExpandedScanGroups] = useState(() => new Set());

    // Summary states
    const [sendingSum, setSendingSum] = useState(false);
    const [downloadingSum, setDownloadingSum] = useState(false);
    const [summaryActionOpen, setSummaryActionOpen] = useState(false);
    const [sumMessage, setSumMessage] = useState(null);
    
    const getYesterdayISO = () => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    };
    const [summaryDateFrom, setSummaryDateFrom] = useState(getYesterdayISO);
    const [summaryDateTo, setSummaryDateTo] = useState(getYesterdayISO);
    const [summaryFromShifts, setSummaryFromShifts] = useState(['Day', 'Night']);
    const [summaryToShifts, setSummaryToShifts] = useState(['Day', 'Night']);

    const handleDownloadSummary = async () => {
        if (sendingSum || downloadingSum) return;
        setDownloadingSum(true);
        setSumMessage(null);
        try {
            await api.downloadSummaryPdf('boiler', 'steamed', summaryDateFrom, summaryDateTo, summaryFromShifts, summaryToShifts);
            setSumMessage({ type: 'success', text: 'Summary downloaded successfully!' });
        } catch (err) {
            setSumMessage({ type: 'error', text: err.message || 'Failed to download summary' });
        } finally {
            setDownloadingSum(false);
            setTimeout(() => setSumMessage(null), 5000);
        }
    };

    const handleSummaryActionOpen = () => {
        if (sendingSum || downloadingSum) return;
        setSummaryActionOpen(true);
    };

    // Auto-enable mobile mode on mobile devices
    useEffect(() => {
        if (isMobile && isTouchDevice) {
            setUseMobileMode(true);
        }
    }, [isMobile, isTouchDevice]);

    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const result = await api.boilerListSteamed(historyFrom, historyTo);
            setSteamedHistory(result.items || []);
        } catch (err) {
            console.error('Failed to load steamed history:', err);
            setSteamedHistory([]);
        } finally {
            setLoadingHistory(false);
        }
    }, [historyFrom, historyTo]);

    // Load history when tab changes or date changes
    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory();
        }
    }, [activeTab, loadHistory]);

    useEffect(() => {
        setExpandedHistoryGroups(new Set());
        setOpenHistoryFilterId(null);
    }, [historyFrom, historyTo]);

    const historyFilterColumns = useMemo(() => [
        { id: 'barcode', label: 'Barcode', kind: 'text', getValue: (r) => r.barcode || '' },
        { id: 'lotNo', label: 'Lot No', kind: 'values', getValue: (r) => r.lotNo || '' },
        { id: 'yarn', label: 'Yarn', kind: 'values', getValue: (r) => r.yarnName || '' },
        { id: 'item', label: 'Item', kind: 'values', getValue: (r) => r.itemName || '' },
        { id: 'twist', label: 'Twist', kind: 'values', getValue: (r) => r.twistName || '' },
        { id: 'cut', label: 'Cut', kind: 'values', getValue: (r) => r.cutName || '' },
        { id: 'rolls', label: 'Rolls', kind: 'number', getValue: (r) => r.rollCount || 0 },
        { id: 'weight', label: 'Net Weight', kind: 'number', getValue: (r) => r.netWeight || 0 },
        { id: 'boiler', label: 'Boiler', kind: 'values', getValue: (r) => r.boilerMachineName || '' },
        { id: 'boilerNo', label: 'Boiler No', kind: 'values', getValue: (r) => r.boilerNumber || '' },
        { id: 'steamedAt', label: 'Steamed At', kind: 'date', getValue: (r) => r.steamedAt || '' },
        { id: 'addedBy', label: 'Added By', kind: 'values', getValue: (r) => getUserDisplayName(r.createdByUser) },
    ], []);

    const historyColumnFor = useCallback(
        (id) => historyFilterColumns.find(column => column.id === id),
        [historyFilterColumns]
    );

    const renderHistoryHeader = useCallback((label, columnId, className = '') => {
        const column = historyColumnFor(columnId);
        return (
            <TableHead className={className}>
                <div className={cn("flex items-center gap-1", className.includes('text-right') ? 'justify-end' : 'justify-between')}>
                    <span>{label}</span>
                    {column && (
                        <SheetColumnFilter
                            column={column}
                            rows={steamedHistory}
                            filters={historySheetFilters}
                            setFilters={setHistorySheetFilters}
                            openId={openHistoryFilterId}
                            setOpenId={setOpenHistoryFilterId}
                        />
                    )}
                </div>
            </TableHead>
        );
    }, [historyColumnFor, historySheetFilters, openHistoryFilterId, steamedHistory]);

    // Filter individual rows first, then group the filtered rows.
    const filteredHistory = useMemo(() => {
        const rows = applySheetFilters(steamedHistory, historyFilterColumns, historySheetFilters);
        const terms = historySearch.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
        if (!terms.length) return rows;
        return rows.filter(item => {
            const searchable = [
                item.barcode,
                item.lotNo,
                item.itemName,
                item.twistName,
                item.cutName,
                item.rollTypeName,
                item.boilerMachineName,
                item.boilerNumber,
                getBoilerLabel(item),
                getUserDisplayName(item.createdByUser),
            ].filter(Boolean).join(' ').toLowerCase();
            return terms.every(term => searchable.includes(term));
        });
    }, [steamedHistory, historyFilterColumns, historySheetFilters, historySearch]);

    const groupedHistory = useMemo(() => {
        const groups = new Map();
        filteredHistory.forEach((item) => {
            const key = buildBoilerHistoryGroupKey(item);
            const existing = groups.get(key) || {
                key,
                date: formatHistoryDate(item.steamedAt),
                yarnName: displayText(item.yarnName),
                itemName: displayText(item.itemName),
                twistName: displayText(item.twistName),
                cutName: displayText(item.cutName),
                recordCount: 0,
                totalRolls: 0,
                totalNetWeight: 0,
                latestSteamedAt: null,
                lots: new Set(),
                boilers: new Set(),
                rows: [],
            };
            existing.recordCount += 1;
            existing.totalRolls += Number(item.rollCount || 0);
            existing.totalNetWeight += Number(item.netWeight || 0);
            const currentLatest = existing.latestSteamedAt ? new Date(existing.latestSteamedAt).getTime() : 0;
            const itemTime = item.steamedAt ? new Date(item.steamedAt).getTime() : 0;
            if (itemTime > currentLatest) existing.latestSteamedAt = item.steamedAt;
            if (item.lotNo) existing.lots.add(item.lotNo);
            const boilerLabel = getBoilerLabel(item);
            if (boilerLabel) existing.boilers.add(boilerLabel);
            existing.rows.push(item);
            groups.set(key, existing);
        });

        return Array.from(groups.values()).sort((a, b) => {
            const aTime = a.latestSteamedAt ? new Date(a.latestSteamedAt).getTime() : 0;
            const bTime = b.latestSteamedAt ? new Date(b.latestSteamedAt).getTime() : 0;
            return bTime - aTime;
        });
    }, [filteredHistory]);

    const historyTotals = useMemo(() => filteredHistory.reduce((acc, item) => ({
        records: acc.records + 1,
        rolls: acc.rolls + Number(item.rollCount || 0),
        netWeight: acc.netWeight + Number(item.netWeight || 0),
    }), { records: 0, rolls: 0, netWeight: 0 }), [filteredHistory]);

    const toggleHistoryGroup = useCallback((key) => {
        setExpandedHistoryGroups((prev) => {
            if (prev.has(key)) return new Set();
            return new Set([key]);
        });
    }, []);

    const scannedItemGroups = useMemo(() => buildBoilerScanGroups(scannedItems), [scannedItems]);

    const toggleScanGroup = useCallback((key) => {
        setExpandedScanGroups((prev) => {
            if (prev.has(key)) return new Set();
            return new Set([key]);
        });
    }, []);

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

    // Open boiler machine dialog before steaming
    const handleMarkSteamed = () => {
        if (readOnly) return;
        if (steamableItems.length === 0) return;
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
                setScannedItems(prev => prev.filter(item => item.status !== 'found'));
                setShowBoilerMachineDialog(false);
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
                <MobileBoilerView onSteamComplete={handleMobileSteamComplete} boilerMachines={boilerMachines} />
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

                {/* Tab Toggle + Scanner Toggle + Send Summary */}
                <div className="flex flex-wrap items-center gap-2">
                    {activeTab === 'history' && (
                        <>
                            {sumMessage && (
                                <span className={`text-sm ${sumMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                                    {sumMessage.text}
                                </span>
                            )}
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {summaryDateFrom === summaryDateTo ? (
                                    <>
                                        {formatDateDisplay(summaryDateFrom)}
                                        {summaryFromShifts.length === summaryToShifts.length && summaryFromShifts.every(s => summaryToShifts.includes(s)) ? (
                                            ` (${summaryFromShifts.join(', ')})`
                                        ) : (
                                            ` (${summaryFromShifts.join(', ')} -> ${summaryToShifts.join(', ')})`
                                        )}
                                    </>
                                ) : (
                                    `${formatDateDisplay(summaryDateFrom)} (${summaryFromShifts.join(', ')}) to ${formatDateDisplay(summaryDateTo)} (${summaryToShifts.join(', ')})`
                                )}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={handleSummaryActionOpen}
                                disabled={sendingSum || downloadingSum}
                                className="flex items-center gap-2 mr-2"
                            >
                                <Send className="h-4 w-4" />
                                {downloadingSum ? 'Downloading...' : 'Send Summary'}
                            </Button>
                        </>
                    )}

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
                                            <TableHead className="w-[42px]"></TableHead>
                                            <TableHead>Status</TableHead>
                                            <TableHead>Item</TableHead>
                                            <TableHead>Twist</TableHead>
                                            <TableHead>Cut</TableHead>
                                            <TableHead className="text-right">Records</TableHead>
                                            <TableHead>Lots</TableHead>
                                            <TableHead className="text-right">Rolls</TableHead>
                                            <TableHead className="text-right">Net Weight</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {scannedItems.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <Flame className="w-8 h-8 opacity-50" />
                                                        <span>Scan barcodes to add items for steaming</span>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            scannedItemGroups.map(group => {
                                                const isExpanded = expandedScanGroups.has(group.key);
                                                const lots = formatScanGroupValues(group.lots);
                                                return (
                                                    <React.Fragment key={group.key}>
                                                        <TableRow
                                                            className={cn("cursor-pointer hover:bg-muted/50", scanGroupRowClass(group))}
                                                            onClick={() => toggleScanGroup(group.key)}
                                                        >
                                                            <TableCell>
                                                                {isExpanded ? (
                                                                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                                                ) : (
                                                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                                                )}
                                                            </TableCell>
                                                            <TableCell>{renderScanGroupStatus(group)}</TableCell>
                                                            <TableCell className="font-medium">{group.itemName}</TableCell>
                                                            <TableCell>{group.twistName}</TableCell>
                                                            <TableCell>{group.cutName}</TableCell>
                                                            <TableCell className="text-right">{group.recordCount}</TableCell>
                                                            <TableCell className="max-w-[180px] truncate" title={lots}>{lots}</TableCell>
                                                            <TableCell className="text-right">{group.totalRolls}</TableCell>
                                                            <TableCell className="text-right">{formatKg(group.totalNetWeight)}</TableCell>
                                                        </TableRow>
                                                        {isExpanded && (
                                                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                                                                <TableCell colSpan={9} className="p-4">
                                                                    <div className="rounded-md border bg-background overflow-x-auto">
                                                                        <Table>
                                                                            <TableHeader>
                                                                                <TableRow className="bg-muted/50">
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
                                                                                {group.rows.map(item => (
                                                                                    <TableRow key={item.scannedBarcode} className={cn(
                                                                                        item.status === 'found' && 'bg-green-500/5',
                                                                                        item.status === 'already_steamed' && 'bg-orange-500/5',
                                                                                        item.status === 'not_found' && 'bg-red-500/5',
                                                                                        item.status === 'error' && 'bg-red-500/5',
                                                                                        item.status === 'loading' && 'bg-blue-500/5'
                                                                                    )}>
                                                                                        <TableCell>{getScanStatusIcon(item.status)}</TableCell>
                                                                                        <TableCell className="font-mono text-sm">{item.scannedBarcode}</TableCell>
                                                                                        <TableCell>{item.lotNo || DISPLAY_EMPTY}</TableCell>
                                                                                        <TableCell className="text-right">{item.rollCount || DISPLAY_EMPTY}</TableCell>
                                                                                        <TableCell className="text-right">
                                                                                            {item.netWeight != null ? formatKg(item.netWeight) : DISPLAY_EMPTY}
                                                                                        </TableCell>
                                                                                        <TableCell>{item.boxName || DISPLAY_EMPTY}</TableCell>
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
                                                                                ))}
                                                                            </TableBody>
                                                                        </Table>
                                                                    </div>
                                                                </TableCell>
                                                            </TableRow>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })
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
                                        placeholder="Search barcode, lot, item, twist, cut..."
                                        className="pl-10 h-9"
                                        value={historySearch}
                                        onChange={e => setHistorySearch(e.target.value)}
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <Input
                                        type="date"
                                        value={historyFrom}
                                        max={historyTo || undefined}
                                        onChange={e => setHistoryFrom(e.target.value)}
                                        className="h-9 w-36"
                                        aria-label="From date"
                                    />
                                    <span className="text-muted-foreground text-sm">to</span>
                                    <Input
                                        type="date"
                                        value={historyTo}
                                        min={historyFrom || undefined}
                                        onChange={e => setHistoryTo(e.target.value)}
                                        className="h-9 w-36"
                                        aria-label="To date"
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
                                        <TableHead className="w-[42px]"></TableHead>
                                        {renderHistoryHeader('Date', 'steamedAt')}
                                        {renderHistoryHeader('Boilers', 'boiler')}
                                        {renderHistoryHeader('Yarn', 'yarn')}
                                        {renderHistoryHeader('Item', 'item')}
                                        {renderHistoryHeader('Twist', 'twist')}
                                        {renderHistoryHeader('Cut', 'cut')}
                                        <TableHead className="text-right">Records</TableHead>
                                        {renderHistoryHeader('Lots', 'lotNo')}
                                        {renderHistoryHeader('Rolls', 'rolls', 'text-right')}
                                        {renderHistoryHeader('Net Weight', 'weight', 'text-right')}
                                        {renderHistoryHeader('Latest Steam', 'steamedAt')}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loadingHistory ? (
                                        <TableRow>
                                            <TableCell colSpan={12} className="h-24 text-center">
                                                <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" />
                                            </TableCell>
                                        </TableRow>
                                    ) : groupedHistory.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={12} className="h-24 text-center text-muted-foreground">
                                                <div className="flex flex-col items-center gap-2">
                                                    <History className="w-8 h-8 opacity-50" />
                                                    <span>No items steamed in this range</span>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        groupedHistory.map(group => {
                                            const isExpanded = expandedHistoryGroups.has(group.key);
                                            const lots = formatUniqueValues(group.lots);
                                            const boilers = formatUniqueValues(group.boilers);
                                            return (
                                                <React.Fragment key={group.key}>
                                                    <TableRow
                                                        className="cursor-pointer hover:bg-muted/50"
                                                        onClick={() => toggleHistoryGroup(group.key)}
                                                    >
                                                        <TableCell>
                                                            {isExpanded ? (
                                                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                                            ) : (
                                                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                                            )}
                                                        </TableCell>
                                                        <TableCell>{group.date}</TableCell>
                                                         <TableCell className="max-w-[220px] truncate" title={boilers}>{boilers}</TableCell>
                                                         <TableCell>{group.yarnName}</TableCell>
                                                         <TableCell className="font-medium">{group.itemName}</TableCell>
                                                        <TableCell>{group.twistName}</TableCell>
                                                        <TableCell>{group.cutName}</TableCell>
                                                        <TableCell className="text-right">{group.recordCount}</TableCell>
                                                        <TableCell className="max-w-[180px] truncate" title={lots}>{lots}</TableCell>
                                                        <TableCell className="text-right">{group.totalRolls}</TableCell>
                                                        <TableCell className="text-right">{formatKg(group.totalNetWeight)}</TableCell>
                                                        <TableCell>{formatHistoryTime(group.latestSteamedAt)}</TableCell>
                                                    </TableRow>
                                                    {isExpanded && (
                                                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                                                            <TableCell colSpan={12} className="p-4">
                                                                <div className="rounded-md border bg-background overflow-x-auto">
                                                                    <Table>
                                                                        <TableHeader>
                                                                            <TableRow className="bg-muted/50">
                                                                                {renderHistoryHeader('Barcode', 'barcode')}
                                                                                {renderHistoryHeader('Date', 'steamedAt')}
                                                                                {renderHistoryHeader('Lot No', 'lotNo')}
                                                                                {renderHistoryHeader('Yarn', 'yarn')}
                                                                                {renderHistoryHeader('Item', 'item')}
                                                                                {renderHistoryHeader('Twist', 'twist')}
                                                                                {renderHistoryHeader('Cut', 'cut')}
                                                                                {renderHistoryHeader('Rolls', 'rolls', 'text-right')}
                                                                                {renderHistoryHeader('Net Weight', 'weight', 'text-right')}
                                                                                {renderHistoryHeader('Boiler', 'boiler')}
                                                                                {renderHistoryHeader('Boiler No', 'boilerNo')}
                                                                                {renderHistoryHeader('Steamed At', 'steamedAt')}
                                                                                {renderHistoryHeader('Added By', 'addedBy')}
                                                                            </TableRow>
                                                                        </TableHeader>
                                                                        <TableBody>
                                                                            {group.rows.map(item => (
                                                                                <TableRow key={item.id}>
                                                                                    <TableCell className="font-mono text-sm">{displayText(item.barcode)}</TableCell>
                                                                                    <TableCell>{formatHistoryDate(item.steamedAt)}</TableCell>
                                                                                    <TableCell>{displayText(item.lotNo)}</TableCell>
                                                                                    <TableCell>{displayText(item.yarnName)}</TableCell>
                                                                                    <TableCell>{displayText(item.itemName)}</TableCell>
                                                                                    <TableCell>{displayText(item.twistName)}</TableCell>
                                                                                    <TableCell>{displayText(item.cutName)}</TableCell>
                                                                                    <TableCell className="text-right">{item.rollCount || DISPLAY_EMPTY}</TableCell>
                                                                                    <TableCell className="text-right">
                                                                                        {item.netWeight != null ? formatKg(item.netWeight) : DISPLAY_EMPTY}
                                                                                    </TableCell>
                                                                                    <TableCell>{displayText(item.boilerMachineName)}</TableCell>
                                                                                    <TableCell>{displayText(item.boilerNumber)}</TableCell>
                                                                                    <TableCell>{formatHistoryTime(item.steamedAt)}</TableCell>
                                                                                    <TableCell>
                                                                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                                                                    </TableCell>
                                                                                </TableRow>
                                                                            ))}
                                                                        </TableBody>
                                                                    </Table>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })
                                    )}
                                    {!loadingHistory && groupedHistory.length > 0 && (
                                        <TableRow className="bg-primary/10 font-bold border-t-2 border-primary/20">
                                            <TableCell></TableCell>
                                            <TableCell></TableCell>
                                            <TableCell></TableCell>
                                            <TableCell></TableCell>
                                            <TableCell className="font-bold text-primary">Grand Total</TableCell>
                                            <TableCell></TableCell>
                                            <TableCell></TableCell>
                                            <TableCell className="text-right font-bold text-primary">{historyTotals.records}</TableCell>
                                            <TableCell></TableCell>
                                            <TableCell className="text-right font-bold text-primary">{historyTotals.rolls}</TableCell>
                                            <TableCell className="text-right font-bold text-primary">{formatKg(historyTotals.netWeight)}</TableCell>
                                            <TableCell></TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="mt-4 text-center text-sm text-muted-foreground">
                            Total: <strong>{historyTotals.records}</strong> records in <strong>{groupedHistory.length}</strong> group{groupedHistory.length === 1 ? '' : 's'}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Boiler Machine Dialog */}
            <BoilerMachineDialog
                open={showBoilerMachineDialog}
                onOpenChange={setShowBoilerMachineDialog}
                onConfirm={confirmSteam}
                submitting={submitting}
                itemCount={steamableItems.length}
                boilerMachines={boilerMachines}
            />

            {/* Summary Action Dialog */}
            <Dialog open={summaryActionOpen} onOpenChange={setSummaryActionOpen}>
                <DialogContent title="Download Summary" onOpenChange={setSummaryActionOpen}>
                    <div className="space-y-4 my-3 text-left">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* From Column */}
                            <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
                                <label className="block text-xs font-bold text-foreground mb-1 uppercase tracking-wider">From Date & Shifts</label>
                                <input
                                    type="date"
                                    value={summaryDateFrom}
                                    onChange={(e) => setSummaryDateFrom(e.target.value)}
                                    className="w-full rounded border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                                />
                                <div>
                                    <span className="block text-xs font-semibold text-muted-foreground mb-1">From Shifts</span>
                                    <div className="flex gap-4 mt-1">
                                        {['Day', 'Night'].map((shift) => {
                                            const isChecked = summaryFromShifts.includes(shift);
                                            return (
                                                <label key={`from-${shift}`} className="flex items-center gap-2 text-sm font-medium select-none cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => {
                                                            if (isChecked) {
                                                                setSummaryFromShifts(summaryFromShifts.filter(s => s !== shift));
                                                            } else {
                                                                setSummaryFromShifts([...summaryFromShifts, shift]);
                                                            }
                                                        }}
                                                        className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                                                    />
                                                    <span>{shift}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {/* To Column */}
                            <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
                                <label className="block text-xs font-bold text-foreground mb-1 uppercase tracking-wider">To Date & Shifts</label>
                                <input
                                    type="date"
                                    value={summaryDateTo}
                                    onChange={(e) => setSummaryDateTo(e.target.value)}
                                    className="w-full rounded border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                                />
                                <div>
                                    <span className="block text-xs font-semibold text-muted-foreground mb-1">To Shifts</span>
                                    <div className="flex gap-4 mt-1">
                                        {['Day', 'Night'].map((shift) => {
                                            const isChecked = summaryToShifts.includes(shift);
                                            return (
                                                <label key={`to-${shift}`} className="flex items-center gap-2 text-sm font-medium select-none cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => {
                                                            if (isChecked) {
                                                                setSummaryToShifts(summaryToShifts.filter(s => s !== shift));
                                                            } else {
                                                                setSummaryToShifts([...summaryToShifts, shift]);
                                                            }
                                                        }}
                                                        className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                                                    />
                                                    <span>{shift}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-2 mt-4">
                        <Button
                            disabled={true}
                            className="flex-1 flex items-center gap-2 opacity-50 cursor-not-allowed justify-center"
                            title="Notifications are currently unavailable for Boiler summary"
                        >
                            <Send className="h-4 w-4" />
                            Send Notification (Unavailable)
                        </Button>
                        <Button
                            variant="outline"
                            onClick={async () => {
                                setSummaryActionOpen(false);
                                await handleDownloadSummary();
                            }}
                            disabled={sendingSum || downloadingSum || summaryFromShifts.length === 0 || summaryToShifts.length === 0}
                            className="flex-1 flex items-center gap-2 justify-center"
                        >
                            <Download className="h-4 w-4" />
                            {downloadingSum ? 'Downloading...' : 'Download PDF'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default Boiler;
