import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api/client';
import { useInventory } from '../context/InventoryContext';
import {
    Button, Input, Select, Card, CardContent, CardHeader, CardTitle,
    Table, TableHeader, TableRow, TableHead, TableBody, TableCell, TableFooter, Badge
} from '../components/ui';
import { formatKg, formatDateDDMMYYYY, todayISO, getInclusiveUtcDayRange, getSortedBaseMachineNames } from '../utils';
import {
    BarChart3, Search, ChevronDown, ChevronRight,
    Package, Truck, Factory, Clock, Users, Gauge,
    Calendar, FileBarChart2, ScanLine, Download
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useMobileDetect } from '../utils/useMobileDetect';
import { MobileBarcodeHistory } from '../components/reports/MobileBarcodeHistory';
import { Dialog, DialogContent } from '../components/ui/Dialog';

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

const MAX_DAILY_EXPORT_RANGE_DAYS = 7;

function buildHoloMetricsDraft({ from, to, baseMachines, savedRows = [] }) {
    const dates = [];
    if (from && to && from <= to) {
        const current = new Date(`${from}T00:00:00Z`);
        const end = new Date(`${to}T00:00:00Z`);
        while (current.getTime() <= end.getTime()) {
            dates.push(current.toISOString().slice(0, 10));
            current.setUTCDate(current.getUTCDate() + 1);
        }
    }

    const savedMap = new Map((savedRows || []).map((row) => [`${row.date}::${row.baseMachine}`, row]));
    const draft = [];
    dates.forEach((date) => {
        baseMachines.forEach((baseMachine) => {
            const saved = savedMap.get(`${date}::${baseMachine}`);
            draft.push({
                date,
                baseMachine,
                hours: saved && saved.hours !== null && saved.hours !== undefined ? String(saved.hours) : '',
                wastage: saved && saved.wastage !== null && saved.wastage !== undefined ? String(saved.wastage) : '',
            });
        });
    });
    return draft;
}

function buildHoloOtherWastageDraft({ from, to, items, savedRows = [] }) {
    const dates = [];
    if (from && to && from <= to) {
        const current = new Date(`${from}T00:00:00Z`);
        const end = new Date(`${to}T00:00:00Z`);
        while (current.getTime() <= end.getTime()) {
            dates.push(current.toISOString().slice(0, 10));
            current.setUTCDate(current.getUTCDate() + 1);
        }
    }

    const savedMap = new Map((savedRows || []).map((row) => [`${row.date}::${row.otherWastageItemId}`, row]));
    const draft = [];
    dates.forEach((date) => {
        (items || []).forEach((item) => {
            const saved = savedMap.get(`${date}::${item.id}`);
            draft.push({
                date,
                otherWastageItemId: item.id,
                itemName: item.name || '',
                wastage: saved && saved.wastage !== null && saved.wastage !== undefined ? String(saved.wastage) : '',
            });
        });
    });
    return draft;
}

function formatWeeklyExportError(err) {
    const details = err?.details?.details || err?.details;
    if (details?.error === 'missing_spindle' && Array.isArray(details.machines)) {
        const machineLines = details.machines
            .map((entry) => `${entry.baseMachine}${entry.sections?.length ? ` (${entry.sections.join(', ')})` : ''}`)
            .join('\n');
        return [
            'Weekly export is blocked because spindle is missing for one or more Holo machines.',
            'Add spindle in Masters > Machines for:',
            machineLines,
        ].join('\n');
    }
    if (details?.error === 'missing_production_per_hour' && Array.isArray(details.unresolved)) {
        const unresolvedLines = details.unresolved
            .slice(0, 12)
            .map((entry) => `${formatDateDDMMYYYY(entry.date)} | ${entry.baseMachine} | ${entry.yarn} | ${entry.cut}`)
            .join('\n');
        const extraCount = Math.max(0, details.unresolved.length - 12);
        return [
            'Weekly export is blocked because one or more Yarn/Cut mappings are missing.',
            'Add the missing entries in Masters > Holo > Production Per Hour for:',
            unresolvedLines,
            extraCount > 0 ? `...and ${extraCount} more` : '',
        ].filter(Boolean).join('\n');
    }
    return err?.message || 'Failed to export weekly production report';
}

function BarcodeHistory() {
    const [barcode, setBarcode] = useState('');
    const [searching, setSearching] = useState(false);
    const [history, setHistory] = useState(null);
    const [expandedStages, setExpandedStages] = useState(new Set());

    async function handleSearch() {
        if (!barcode.trim()) return;

        setSearching(true);
        setHistory(null);
        try {
            const res = await api.getBarcodeHistory(barcode.trim());
            setHistory(res.history);
            // Expand all stages by default
            if (res.history?.lineage) {
                setExpandedStages(new Set(res.history.lineage.map((_, i) => i)));
            }
        } catch (err) {
            alert(err.message || 'Failed to fetch barcode history');
        } finally {
            setSearching(false);
        }
    }

    function toggleStage(index) {
        setExpandedStages(prev => {
            const next = new Set(prev);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    }

    function renderStageDetails(stage) {
        const data = stage.data || {};
        const entries = Object.entries(data).filter(([key, value]) =>
            value !== null && value !== undefined && key !== 'pieceId' && key !== 'issueId' && key !== 'receiveId' && key !== 'dispatchId' && key !== 'itemName' && key !== 'cutName'
        );

        return (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
                {entries.map(([key, value]) => (
                    <div key={key} className="bg-muted/50 p-2 rounded">
                        <div className="text-muted-foreground text-xs capitalize">
                            {key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                        </div>
                        <div className="font-medium">
                            {typeof value === 'number' && key.toLowerCase().includes('weight')
                                ? formatKg(value)
                                : String(value || '—')}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
                <CardContent className="py-6">
                    <div className="flex flex-col md:flex-row gap-4 items-center">
                        <div className="flex-1 w-full md:max-w-md">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                                <Input
                                    placeholder="Enter barcode to trace history..."
                                    className="pl-10 h-12 text-lg"
                                    value={barcode}
                                    onChange={e => setBarcode(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                />
                            </div>
                        </div>
                        <Button
                            size="lg"
                            onClick={handleSearch}
                            disabled={searching || !barcode.trim()}
                        >
                            {searching ? 'Searching...' : 'Trace History'}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {history && !history.found && (
                <Card>
                    <CardContent className="py-12 text-center">
                        <div className="text-muted-foreground">
                            <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
                            <p className="text-lg font-medium">No records found</p>
                            <p className="text-sm">No data found for barcode: <span className="font-mono">{history.barcode}</span></p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {history && history.found && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 px-1">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Clock className="w-5 h-5 text-primary" />
                            Barcode Journey
                        </h2>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    const allExpanded = expandedStages.size === history.lineage.length;
                                    if (allExpanded) {
                                        setExpandedStages(new Set());
                                    } else {
                                        setExpandedStages(new Set(history.lineage.map((_, i) => i)));
                                    }
                                }}
                                className="h-8 text-xs"
                            >
                                {expandedStages.size === history.lineage.length ? 'Collapse All' : 'Expand All'}
                            </Button>
                        </div>
                    </div>

                    <div className="relative pb-8">
                        {/* Timeline Line */}
                        <div className="absolute left-6 top-4 bottom-12 w-0.5 bg-border" />

                        <div className="space-y-4">
                            {history.lineage.map((stage, index) => {
                                const Icon = STAGE_ICONS[stage.stage] || Package;
                                const isExpanded = expandedStages.has(index);
                                const colorClass = STAGE_COLORS[stage.stage] || 'bg-gray-500';

                                return (
                                    <div key={index} className="relative pl-16">
                                        {/* Timeline Dot */}
                                        <div className={cn(
                                            "absolute left-4 w-4 h-4 rounded-full border-2 border-background z-10",
                                            colorClass
                                        )} />

                                        <Card className={cn(
                                            "transition-all cursor-pointer hover:shadow-md",
                                            isExpanded && "ring-1 ring-primary/20"
                                        )}>
                                            <div
                                                className="p-4 flex items-center justify-between"
                                                onClick={() => toggleStage(index)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        "w-10 h-10 rounded-lg flex items-center justify-center text-white",
                                                        colorClass
                                                    )}>
                                                        <Icon className="w-5 h-5" />
                                                    </div>
                                                    <div>
                                                        <div className="font-medium flex items-center gap-2">
                                                            {STAGE_LABELS[stage.stage] || stage.stage}
                                                            {(stage.data?.itemName || stage.data?.cutName) && (
                                                                <span className="flex items-center gap-1.5">
                                                                    {stage.data?.itemName && (
                                                                        <Badge variant="secondary" className="text-xs font-normal h-5">
                                                                            {stage.data.itemName}
                                                                        </Badge>
                                                                    )}
                                                                    {stage.data?.cutName && (
                                                                        <Badge variant="outline" className="text-xs font-normal h-5">
                                                                            {stage.data.cutName}
                                                                        </Badge>
                                                                    )}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                                                            <Clock className="w-3 h-3" />
                                                            {stage.date ? formatDateDDMMYYYY(stage.date) : 'Date not recorded'}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    {stage.data?.weight && (
                                                        <Badge variant="outline" className="text-sm">
                                                            {formatKg(stage.data.weight)}
                                                        </Badge>
                                                    )}
                                                    {stage.data?.netWeight && (
                                                        <Badge variant="outline" className="text-sm">
                                                            {formatKg(stage.data.netWeight)}
                                                        </Badge>
                                                    )}
                                                    {stage.barcode && (
                                                        <span className="font-mono text-sm text-muted-foreground">
                                                            {stage.barcode}
                                                        </span>
                                                    )}
                                                    {isExpanded ? (
                                                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                                                    ) : (
                                                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                                                    )}
                                                </div>
                                            </div>

                                            {isExpanded && (
                                                <div className="px-4 pb-4 pt-0 border-t">
                                                    <div className="pt-4">
                                                        {renderStageDetails(stage)}
                                                    </div>
                                                </div>
                                            )}
                                        </Card>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ProductionReport() {
    const { db } = useInventory();
    const [process, setProcess] = useState('cutter');
    const [view, setView] = useState('machine');
    const [dateFrom, setDateFrom] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
    });
    const [dateTo, setDateTo] = useState(todayISO());
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState(null);
    const [exportModalOpen, setExportModalOpen] = useState(false);
    const [exportProcess, setExportProcess] = useState('cutter');
    const [exportFrom, setExportFrom] = useState('');
    const [exportTo, setExportTo] = useState('');
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState('');
    const exportAbortRef = useRef(null);
    const [metricsModalOpen, setMetricsModalOpen] = useState(false);
    const [metricsDraftRows, setMetricsDraftRows] = useState([]);
    const [metricsLoading, setMetricsLoading] = useState(false);
    const [metricsSaving, setMetricsSaving] = useState(false);
    const [metricsError, setMetricsError] = useState('');
    const [metricsLoadedRange, setMetricsLoadedRange] = useState({ from: '', to: '' });
    const [otherWastageModalOpen, setOtherWastageModalOpen] = useState(false);
    const [otherWastageDraftRows, setOtherWastageDraftRows] = useState([]);
    const [otherWastageLoading, setOtherWastageLoading] = useState(false);
    const [otherWastageSaving, setOtherWastageSaving] = useState(false);
    const [otherWastageError, setOtherWastageError] = useState('');
    const [otherWastageLoadedRange, setOtherWastageLoadedRange] = useState({ from: '', to: '' });
    const [weeklyModalOpen, setWeeklyModalOpen] = useState(false);
    const [weeklyFrom, setWeeklyFrom] = useState('');
    const [weeklyTo, setWeeklyTo] = useState('');
    const [weeklyExporting, setWeeklyExporting] = useState(false);
    const [weeklyError, setWeeklyError] = useState('');

    // Expansion state
    const [expandedRows, setExpandedRows] = useState(new Set()); // Set of keys
    const [detailsCache, setDetailsCache] = useState(new Map()); // Map key -> data
    const [loadingDetails, setLoadingDetails] = useState(new Set()); // Set of keys being fetched

    const holoBaseMachines = useMemo(() => getSortedBaseMachineNames(db?.machines || [], { processType: 'holo', includeShared: false }), [db?.machines]);
    const holoOtherWastageItems = useMemo(() => (
        [...(db?.holo_other_wastage_items || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }))
    ), [db?.holo_other_wastage_items]);

    const getDefaultExportProcess = () => (
        process === 'cutter' || process === 'holo' || process === 'coning'
            ? process
            : 'cutter'
    );

    const openExportModal = () => {
        setExportProcess(getDefaultExportProcess());
        setExportFrom(dateFrom || '');
        setExportTo(dateTo || '');
        setExportError('');
        setExportModalOpen(true);
    };

    const closeExportModal = () => {
        if (exporting && exportAbortRef.current) {
            exportAbortRef.current.abort();
            exportAbortRef.current = null;
        }
        setExportModalOpen(false);
        setExportError('');
    };

    const openWeeklyModal = () => {
        setWeeklyFrom(dateFrom || '');
        setWeeklyTo(dateTo || '');
        setWeeklyError('');
        setWeeklyModalOpen(true);
    };

    const validateExportForm = () => {
        if (!exportFrom || !exportTo) return 'From Date and To Date are required.';
        if (exportProcess === 'all') return 'Daily export supports only Cutter, Holo, or Coning.';
        if (exportFrom > exportTo) return 'From Date cannot be later than To Date.';
        const rangeDays = getInclusiveUtcDayRange(exportFrom, exportTo);
        if (rangeDays > MAX_DAILY_EXPORT_RANGE_DAYS) {
            return `Daily production export is limited to ${MAX_DAILY_EXPORT_RANGE_DAYS} days at a time.`;
        }
        return '';
    };

    const validateWeeklyExportForm = () => {
        if (!weeklyFrom || !weeklyTo) return 'From Date and To Date are required.';
        if (weeklyFrom > weeklyTo) return 'From Date cannot be later than To Date.';
        return '';
    };

    const loadHoloMetricsDraft = async (from, to) => {
        setMetricsLoading(true);
        setMetricsError('');
        try {
            const res = await api.getHoloProductionMetrics({ from, to });
            const draft = buildHoloMetricsDraft({
                from,
                to,
                baseMachines: holoBaseMachines,
                savedRows: res?.rows || [],
            });
            setMetricsDraftRows(draft);
            setMetricsLoadedRange({ from, to });
        } catch (err) {
            setMetricsError(err.message || 'Failed to load Holo hours and wastage.');
        } finally {
            setMetricsLoading(false);
        }
    };

    const saveHoloMetricsDraft = async () => {
        if (metricsDraftRows.length === 0) return;
        setMetricsSaving(true);
        setMetricsError('');
        try {
            await api.saveHoloProductionMetrics(metricsDraftRows.map((row) => ({
                date: row.date,
                baseMachine: row.baseMachine,
                hours: row.hours,
                wastage: row.wastage,
            })));
        } catch (err) {
            setMetricsError(err.message || 'Failed to save Holo hours and wastage.');
            throw err;
        } finally {
            setMetricsSaving(false);
        }
    };

    const openMetricsModal = async () => {
        const validationError = validateExportForm();
        if (validationError) {
            setExportError(validationError);
            return;
        }
        if (exportProcess !== 'holo') return;
        setMetricsModalOpen(true);
        await loadHoloMetricsDraft(exportFrom, exportTo);
    };

    const loadOtherWastageDraft = async (from, to) => {
        setOtherWastageLoading(true);
        setOtherWastageError('');
        try {
            const res = await api.getHoloOtherWastageMetrics({ from, to });
            const draft = buildHoloOtherWastageDraft({
                from,
                to,
                items: holoOtherWastageItems,
                savedRows: res?.rows || [],
            });
            setOtherWastageDraftRows(draft);
            setOtherWastageLoadedRange({ from, to });
        } catch (err) {
            setOtherWastageError(err.message || 'Failed to load Other Wastage.');
        } finally {
            setOtherWastageLoading(false);
        }
    };

    const saveOtherWastageDraft = async () => {
        if (otherWastageDraftRows.length === 0) return;
        setOtherWastageSaving(true);
        setOtherWastageError('');
        try {
            await api.saveHoloOtherWastageMetrics(otherWastageDraftRows.map((row) => ({
                date: row.date,
                otherWastageItemId: row.otherWastageItemId,
                wastage: row.wastage,
            })));
        } catch (err) {
            setOtherWastageError(err.message || 'Failed to save Other Wastage.');
            throw err;
        } finally {
            setOtherWastageSaving(false);
        }
    };

    const openOtherWastageModal = async () => {
        const validationError = validateExportForm();
        if (validationError) {
            setExportError(validationError);
            return;
        }
        if (exportProcess !== 'holo') return;
        setOtherWastageModalOpen(true);
        await loadOtherWastageDraft(exportFrom, exportTo);
    };

    async function loadReport() {
        setLoading(true);
        setExpandedRows(new Set());
        setDetailsCache(new Map());
        setLoadingDetails(new Set());
        try {
            const res = await api.getProductionReport({
                process,
                view,
                from: dateFrom,
                to: dateTo,
            });
            setReport(res.report);
        } catch (err) {
            alert(err.message || 'Failed to load production report');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadReport();
    }, [process, view, dateFrom, dateTo]);

    const getRowKey = (item, index) => {
        if (view === 'operator') return `op-${item.operatorId || index}`;
        if (view === 'shift') return `sh-${item.shift || index}`;
        if (view === 'item') return `it-${item.itemId || item.itemName || index}-${item.cutId || item.cut || index}`;
        if (view === 'yarn') return `yr-${item.yarnId || item.yarnName || index}`;
        return `mc-${item.machineNo || item.machineName || index}`;
    };

    const handleToggleRow = async (item, index) => {
        const key = getRowKey(item, index);

        if (expandedRows.has(key)) {
            const next = new Set(expandedRows);
            next.delete(key);
            setExpandedRows(next);
            return;
        }

        // Expand
        const nextExpanded = new Set(expandedRows);
        nextExpanded.add(key);
        setExpandedRows(nextExpanded);

        if (detailsCache.has(key)) return;

        // Fetch details
        const loadingSet = new Set(loadingDetails);
        loadingSet.add(key);
        setLoadingDetails(loadingSet);

        try {
            // Determine the 'key' param for the API
            let apiKey = '';
            if (view === 'operator') apiKey = item.operatorId || 'unknown';
            else if (view === 'shift') apiKey = item.shift || 'Not Specified';
            else if (view === 'item') {
                const itemId = item.itemId || item.itemName || 'unknown';
                const cutId = item.cutId || item.cut || '';
                apiKey = cutId ? `${itemId}|${cutId}` : itemId;
            } else if (view === 'yarn') apiKey = item.yarnId || item.yarnName || 'unknown';
            else apiKey = item.machineNo || item.machineName || 'unknown';

            const res = await api.getProductionReportDetails({
                process,
                view,
                from: dateFrom,
                to: dateTo,
                key: apiKey
            });

            setDetailsCache(prev => new Map(prev).set(key, res.rows));
        } catch (err) {
            console.error(err);
            // Collapse if failed to fetch details
            setExpandedRows(prev => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        } finally {
            setLoadingDetails(prev => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    const getColumnHeaders = () => {
        if (view === 'operator') return ['Operator', 'Received (kg)', 'Count'];
        if (view === 'shift') return ['Shift', 'Received (kg)', 'Count'];
        if (view === 'item') return ['Item', 'Cut', 'Received (kg)', 'Count'];
        if (view === 'yarn') return ['Yarn', 'Received (kg)', 'Count'];
        return ['Machine', 'Received (kg)', 'Count'];
    };

    const getRowData = (item) => {
        if (view === 'operator') return [item.operatorName || 'Unknown', formatKg(item.received), item.count || item.rollCount || item.coneCount || 0];
        if (view === 'shift') return [item.shift || 'Not Specified', formatKg(item.received), item.count || item.rollCount || item.coneCount || 0];
        if (view === 'item') return [item.itemName || 'Unknown Item', item.cutName || item.cut || '—', formatKg(item.received), item.count || item.rollCount || item.coneCount || 0];
        if (view === 'yarn') return [item.yarnName || 'Unknown Yarn', formatKg(item.received), item.count || item.rollCount || item.coneCount || 0];
        return [item.machineNo || item.machineName || 'Unknown', formatKg(item.received), item.count || item.rollCount || item.coneCount || 0];
    };

    const grandTotals = report?.data?.reduce((acc, item) => {
        acc.received += (Number(item.received) || 0);
        acc.count += (Number(item.count || item.rollCount || item.coneCount) || 0);
        return acc;
    }, { received: 0, count: 0 }) || { received: 0, count: 0 };
    const exportRangeDays = getInclusiveUtcDayRange(exportFrom, exportTo);
    const isMultiDayExport = exportRangeDays > 1;
    const isExportRangeTooWide = exportRangeDays > MAX_DAILY_EXPORT_RANGE_DAYS;

    const handleDailyExport = async () => {
        const validationError = validateExportForm();
        if (validationError) {
            setExportError(validationError);
            return;
        }

        setExportError('');
        setExporting(true);
        const controller = new AbortController();
        exportAbortRef.current = controller;
        try {
            await api.downloadProductionDailyExport({
                process: exportProcess,
                from: exportFrom,
                to: exportTo,
                signal: controller.signal,
            });
            exportAbortRef.current = null;
            setExportModalOpen(false);
        } catch (err) {
            if (err?.cancelled || err?.name === 'AbortError') {
                return;
            }
            setExportError(err.message || 'Failed to export daily production report');
        } finally {
            exportAbortRef.current = null;
            setExporting(false);
        }
    };

    const handleWeeklyExport = async () => {
        const validationError = validateWeeklyExportForm();
        if (validationError) {
            setWeeklyError(validationError);
            return;
        }

        setWeeklyError('');
        setWeeklyExporting(true);
        try {
            await api.downloadProductionWeeklyExport({
                process: 'holo',
                from: weeklyFrom,
                to: weeklyTo,
            });
            setWeeklyModalOpen(false);
        } catch (err) {
            setWeeklyError(formatWeeklyExportError(err));
        } finally {
            setWeeklyExporting(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Filters */}
            <Card className="bg-muted/40 border-none shadow-none">
                <CardContent className="py-4">
                    <div className="flex flex-col items-stretch sm:flex-row sm:items-end gap-4 flex-wrap">
                        <div className="min-w-[150px]">
                            <label className="text-sm font-medium mb-1 block">Process</label>
                            <Select value={process} onChange={e => setProcess(e.target.value)}>
                                <option value="cutter">Cutter</option>
                                <option value="holo">Holo</option>
                                <option value="coning">Coning</option>
                                <option value="all">All Processes</option>
                            </Select>
                        </div>
                        <div className="min-w-[150px]">
                            <label className="text-sm font-medium mb-1 block">View By</label>
                            <Select value={view} onChange={e => setView(e.target.value)} disabled={process === 'all'}>
                                <option value="machine">Machine-wise</option>
                                <option value="operator">Operator-wise</option>
                                <option value="shift">Shift-wise</option>
                                <option value="item">Item-wise</option>
                                <option value="yarn">Yarn-wise</option>
                            </Select>
                        </div>
                        <div className="min-w-[150px]">
                            <label className="text-sm font-medium mb-1 block">From Date</label>
                            <Input
                                type="date"
                                value={dateFrom}
                                onChange={e => setDateFrom(e.target.value)}
                            />
                        </div>
                        <div className="min-w-[150px]">
                            <label className="text-sm font-medium mb-1 block">To Date</label>
                            <Input
                                type="date"
                                value={dateTo}
                                onChange={e => setDateTo(e.target.value)}
                            />
                        </div>
                        <div className="flex items-end sm:ml-auto gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full sm:w-auto"
                                onClick={openExportModal}
                            >
                                <Download className="w-4 h-4 mr-2" />
                                Daily Export
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full sm:w-auto"
                                onClick={openWeeklyModal}
                            >
                                <Download className="w-4 h-4 mr-2" />
                                Weekly Export
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Summary Cards */}
            {report && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="bg-gradient-to-br from-indigo-500/10 to-indigo-500/5 border-indigo-500/20">
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                    <Factory className="w-5 h-5 text-indigo-500" />
                                </div>
                                <div>
                                    <div className="text-sm text-muted-foreground">Total Issued</div>
                                    <div className="text-xl font-bold">{formatKg(report.summary.totalIssued)}</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                                    <Package className="w-5 h-5 text-blue-500" />
                                </div>
                                <div>
                                    <div className="text-sm text-muted-foreground">Total Received</div>
                                    <div className="text-xl font-bold">{formatKg(report.summary.totalReceived)}</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/20">
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                                    <Factory className="w-5 h-5 text-orange-500" />
                                </div>
                                <div>
                                    <div className="text-sm text-muted-foreground">Total Wastage</div>
                                    <div className="text-xl font-bold">{formatKg(report.summary.totalWastage)}</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                                    <Gauge className="w-5 h-5 text-green-500" />
                                </div>
                                <div>
                                    <div className="text-sm text-muted-foreground">Efficiency</div>
                                    <div className="text-xl font-bold">{report.summary.efficiency}%</div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>


                </div>
            )}

            {/* Data Table */}
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">
                        {process === 'all' ? 'All Processes' : `${process.charAt(0).toUpperCase() + process.slice(1)} Production`}
                        {' '}- {view === 'operator' ? 'Operator-wise' : view === 'shift' ? 'Shift-wise' : view === 'item' ? 'Item-wise' : view === 'yarn' ? 'Yarn-wise' : 'Machine-wise'}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="h-32 flex items-center justify-center text-muted-foreground">
                            Loading report...
                        </div>
                    ) : !report || report.data.length === 0 ? (
                        <div className="h-32 flex flex-col items-center justify-center text-muted-foreground">
                            <FileBarChart2 className="w-12 h-12 mb-2 opacity-50" />
                            <p>No data available for selected filters</p>
                        </div>
                    ) : (
                        <>
                            <div className="hidden sm:block rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-10"></TableHead>
                                            {getColumnHeaders().map((header, i) => (
                                                <TableHead key={i} className={i > 0 ? 'text-right' : ''}>
                                                    {header}
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {report.data.map((item, index) => {
                                            const rowData = getRowData(item);
                                            const key = getRowKey(item, index);
                                            const isExpanded = expandedRows.has(key);
                                            const details = detailsCache.get(key);
                                            const isLoadingDetails = loadingDetails.has(key);

                                            return (
                                                <React.Fragment key={key}>
                                                    <TableRow
                                                        className={cn("cursor-pointer hover:bg-muted/50 transition-colors", isExpanded && "bg-muted/30")}
                                                        onClick={() => handleToggleRow(item, index)}
                                                    >
                                                        <TableCell>
                                                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                        </TableCell>
                                                        {rowData.map((cell, i) => (
                                                            <TableCell key={i} className={cn(i > 0 && 'text-right', i === 0 && 'font-medium')}>
                                                                {cell}
                                                            </TableCell>
                                                        ))}
                                                    </TableRow>
                                                    {isExpanded && (
                                                        <TableRow className="bg-muted/10 hover:bg-muted/10">
                                                            <TableCell colSpan={rowData.length + 1} className="p-0">
                                                                <div className="p-4 bg-muted/20 border-t border-b animate-in slide-in-from-top-2">
                                                                    {isLoadingDetails ? (
                                                                        <div className="py-8 flex justify-center text-muted-foreground text-sm">
                                                                            <div className="flex items-center gap-2">
                                                                                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                                                                Loading detailed breakdown...
                                                                            </div>
                                                                        </div>
                                                                    ) : !details || details.length === 0 ? (
                                                                        <div className="py-8 text-center text-muted-foreground text-sm">
                                                                            No detailed records found.
                                                                        </div>
                                                                    ) : (
                                                                        <div className="rounded-md border bg-background overflow-hidden">
                                                                            {/* Group details by machine section if applicable */}
                                                                            {(() => {
                                                                                // Grouping logic
                                                                                const groupedDetails = view === 'machine'
                                                                                    ? details.reduce((acc, row) => {
                                                                                        const key = row.machineName || 'Unknown Section';
                                                                                        if (!acc[key]) acc[key] = [];
                                                                                        acc[key].push(row);
                                                                                        return acc;
                                                                                    }, {})
                                                                                    : { 'All': details };

                                                                                return Object.entries(groupedDetails).map(([sectionName, sectionRows]) => (
                                                                                    <div key={sectionName}>
                                                                                        {(() => {
                                                                                            const totalWeight = sectionRows.reduce((sum, r) => sum + (r.receivedWeight || 0), 0);
                                                                                            const totalCount = sectionRows.reduce((sum, r) => sum + (r.receivedQty || 0), 0);
                                                                                            const unitLabel = process === 'cutter' ? 'Bobbins' : process === 'holo' ? 'Rolls' : 'Cones';
                                                                                            // Only show section label for machine view (where we have multiple sections)
                                                                                            const showSectionLabel = view === 'machine' && sectionName !== 'All';
                                                                                            return (
                                                                                                <div className="px-4 py-2 bg-muted/50 font-medium text-xs border-b flex justify-between">
                                                                                                    <span>{showSectionLabel ? `Section: ${sectionName}` : 'Details Summary'}</span>
                                                                                                    <span className="text-muted-foreground">
                                                                                                        Total: {totalCount} {unitLabel} | {formatKg(totalWeight)} kg
                                                                                                    </span>
                                                                                                </div>
                                                                                            );
                                                                                        })()}
                                                                                        <Table>
                                                                                            <TableHeader>
                                                                                                <TableRow className="bg-muted/50 hover:bg-muted/50">
                                                                                                    <TableHead className="h-8 text-xs">Date</TableHead>
                                                                                                    <TableHead className="h-8 text-xs">Barcode</TableHead>
                                                                                                    {view !== 'machine' && <TableHead className="h-8 text-xs">Machine</TableHead>}
                                                                                                    <TableHead className="h-8 text-xs">Shift</TableHead>
                                                                                                    <TableHead className="h-8 text-xs">Issue Info</TableHead>
                                                                                                    <TableHead className="h-8 text-xs text-right">Received</TableHead>
                                                                                                    <TableHead className="h-8 text-xs text-right">Weight</TableHead>
                                                                                                </TableRow>
                                                                                            </TableHeader>
                                                                                            <TableBody>
                                                                                                {sectionRows.map((row, idx) => (
                                                                                                    <TableRow key={idx} className="hover:bg-muted/20">
                                                                                                        <TableCell className="py-2 text-xs text-muted-foreground whitespace-nowrap">
                                                                                                            {formatDateDDMMYYYY(row.date)}
                                                                                                        </TableCell>
                                                                                                        <TableCell className="py-2 text-xs font-mono">
                                                                                                            {row.barcode || '—'}
                                                                                                        </TableCell>
                                                                                                        {view !== 'machine' && (
                                                                                                            <TableCell className="py-2 text-xs">
                                                                                                                <Badge variant="secondary" className="text-[10px] font-normal h-4 px-1.5">
                                                                                                                    {row.machineName || '—'}
                                                                                                                </Badge>
                                                                                                            </TableCell>
                                                                                                        )}
                                                                                                        <TableCell className="py-2 text-xs">
                                                                                                            <Badge variant="outline" className="text-[10px] font-normal h-4 px-1">
                                                                                                                {row.shift || '—'}
                                                                                                            </Badge>
                                                                                                        </TableCell>
                                                                                                        <TableCell className="py-2 text-xs text-muted-foreground">
                                                                                                            {row.issueInfo ? (
                                                                                                                <div className="flex flex-col gap-0.5">
                                                                                                                    <span className="font-medium text-xs text-foreground">{row.issueInfo.desc}</span>
                                                                                                                    {row.issueInfo.weight > 0 && <span>Issued: {formatKg(row.issueInfo.weight)}</span>}
                                                                                                                </div>
                                                                                                            ) : '—'}
                                                                                                        </TableCell>
                                                                                                        <TableCell className="py-2 text-xs font-medium text-right">
                                                                                                            {row.receivedQty} {process === 'cutter' ? 'Bob' : process === 'holo' ? 'Rolls' : 'Cones'}
                                                                                                        </TableCell>
                                                                                                        <TableCell className="py-2 text-xs font-medium text-right text-foreground">
                                                                                                            {formatKg(row.receivedWeight)}
                                                                                                        </TableCell>
                                                                                                    </TableRow>
                                                                                                ))}
                                                                                            </TableBody>
                                                                                        </Table>
                                                                                    </div>
                                                                                ));
                                                                            })()}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </TableBody>
                                    <TableFooter>
                                        <TableRow className="bg-muted/50 font-bold hover:bg-muted/50">
                                            <TableCell></TableCell>
                                            <TableCell className="text-center">Grand Total</TableCell>
                                            {view === 'item' && <TableCell></TableCell>}
                                            <TableCell className="text-right">{formatKg(grandTotals.received)}</TableCell>
                                            <TableCell className="text-right">{grandTotals.count}</TableCell>
                                        </TableRow>
                                    </TableFooter>
                                </Table>
                            </div>

                            {/* Mobile Card View - Simplified for now, just show expand button */}
                            <div className="block sm:hidden space-y-3">
                                {report.data.map((item, index) => {
                                    const headers = getColumnHeaders();
                                    const rowData = getRowData(item);
                                    const key = getRowKey(item, index);
                                    const isExpanded = expandedRows.has(key);
                                    const details = detailsCache.get(key);

                                    return (
                                        <div key={key} className="border rounded-lg bg-card shadow-sm overflow-hidden">
                                            <div
                                                className="p-4 flex items-center justify-between bg-muted/10 cursor-pointer"
                                                onClick={() => handleToggleRow(item, index)}
                                            >
                                                <div className="font-medium text-primary">{rowData[0]}</div>
                                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                            </div>

                                            <div className="p-4 border-t border-border/50">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mb-4">
                                                    {headers.slice(1).map((header, i) => (
                                                        <div key={i} className="flex justify-between">
                                                            <span className="text-muted-foreground">{header}:</span>
                                                            <span className="font-medium">{rowData[i + 1]}</span>
                                                        </div>
                                                    ))}
                                                </div>

                                                {isExpanded && (
                                                    <div className="mt-4 pt-4 border-t">
                                                        {/* Mobile Details - Simplified List */}
                                                        {!details ? (
                                                            <p className="text-xs text-center text-muted-foreground">Loading...</p>
                                                        ) : details.length === 0 ? (
                                                            <p className="text-xs text-center text-muted-foreground">No details.</p>
                                                        ) : (
                                                            <div className="space-y-3">
                                                                {details.map((row, idx) => (
                                                                    <div key={idx} className="bg-muted/30 p-2 rounded text-xs space-y-1">
                                                                        <div className="flex justify-between font-medium">
                                                                            <span>{row.barcode}</span>
                                                                            <span>{formatKg(row.receivedWeight)}</span>
                                                                        </div>
                                                                        {view !== 'machine' && row.machineName && (
                                                                            <div className="flex justify-between text-muted-foreground">
                                                                                <span>Machine:</span>
                                                                                <Badge variant="secondary" className="text-[10px] font-normal h-4 px-1.5">
                                                                                    {row.machineName}
                                                                                </Badge>
                                                                            </div>
                                                                        )}
                                                                        <div className="flex justify-between text-muted-foreground">
                                                                            <span>{formatDateDDMMYYYY(row.date)}</span>
                                                                            <span>{row.issueInfo ? row.issueInfo.desc : ''}</span>
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {report.data.length > 0 && (
                                    <div className="border rounded-lg bg-primary/5 shadow-sm overflow-hidden border-primary/20 mt-4">
                                        <div className="p-4 flex items-center justify-between bg-primary/10">
                                            <div className="font-bold text-primary">Grand Total</div>
                                        </div>
                                        <div className="p-4 border-t border-primary/10">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Received (kg):</span>
                                                    <span className="font-bold">{formatKg(grandTotals.received)}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Count:</span>
                                                    <span className="font-bold">{grandTotals.count}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={exportModalOpen}
                onOpenChange={(open) => {
                    if (open) {
                        setExportModalOpen(true);
                        return;
                    }
                    closeExportModal();
                }}
            >
                <DialogContent
                    title="Daily Production Export"
                    onOpenChange={closeExportModal}
                    className="max-w-xl"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Export one PDF for a single date, or a ZIP with one PDF per day for a small date range.
                        </p>
                        {process === 'all' && (
                            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                The current report is showing All Processes. Daily export requires one process, so a specific process must be selected here before download.
                            </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-1 block">Process</label>
                                <Select
                                    value={exportProcess}
                                    onChange={(e) => {
                                        setExportProcess(e.target.value);
                                        setExportError('');
                                    }}
                                    disabled={exporting}
                                >
                                    <option value="cutter">Cutter</option>
                                    <option value="holo">Holo</option>
                                    <option value="coning">Coning</option>
                                </Select>
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block">From Date</label>
                                <Input
                                    type="date"
                                    value={exportFrom}
                                    onChange={(e) => {
                                        setExportFrom(e.target.value);
                                        setExportError('');
                                    }}
                                    disabled={exporting}
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block">To Date</label>
                                <Input
                                    type="date"
                                    value={exportTo}
                                    onChange={(e) => {
                                        setExportTo(e.target.value);
                                        setExportError('');
                                    }}
                                    disabled={exporting}
                                />
                            </div>
                        </div>
                        {exportFrom && exportTo && exportRangeDays > 0 && (
                            <div className={cn(
                                "rounded-md border px-3 py-2 text-sm",
                                isExportRangeTooWide
                                    ? "border-red-200 bg-red-50 text-red-700"
                                    : "border-slate-200 bg-slate-50 text-slate-700"
                            )}>
                                {isExportRangeTooWide
                                    ? `The selected range spans ${exportRangeDays} days. Reduce it to ${MAX_DAILY_EXPORT_RANGE_DAYS} days or fewer.`
                                    : isMultiDayExport
                                        ? `This export will generate ${exportRangeDays} daily PDFs inside one ZIP file.`
                                        : 'This export will generate one PDF file.'}
                            </div>
                        )}
                        {exportError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {exportError}
                            </div>
                        )}
                        {exportProcess === 'holo' && (
                            <div className="space-y-3">
                                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 space-y-2">
                                    <div className="font-medium text-slate-900">Holo Hours & Wastage</div>
                                    <p>
                                        Holo daily metrics are captured per date and base machine. Saved values are reused by the weekly Holo report.
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Button type="button" variant="outline" onClick={openMetricsModal} disabled={exporting || metricsLoading}>
                                            Add Hours & Wastage
                                        </Button>
                                        {metricsLoadedRange.from === exportFrom && metricsLoadedRange.to === exportTo && metricsDraftRows.length > 0 && (
                                            <span className="text-xs text-muted-foreground self-center">
                                                {metricsDraftRows.length} date/machine entries loaded for this range.
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 space-y-2">
                                    <div className="font-medium text-slate-900">Other Wastage</div>
                                    <p>
                                        Other wastage entries are captured per date and item. Saved values are added to the Holo daily export PDF for the selected date.
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Button type="button" variant="outline" onClick={openOtherWastageModal} disabled={exporting || otherWastageLoading}>
                                            Add Other Wastage
                                        </Button>
                                        {otherWastageLoadedRange.from === exportFrom && otherWastageLoadedRange.to === exportTo && otherWastageDraftRows.length > 0 && (
                                            <span className="text-xs text-muted-foreground self-center">
                                                {otherWastageDraftRows.length} date/item entries loaded for this range.
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={closeExportModal}>
                                {exporting ? 'Cancel Export' : 'Cancel'}
                            </Button>
                            <Button onClick={handleDailyExport} disabled={exporting}>
                                {exporting ? 'Preparing Download...' : 'Export PDF / ZIP'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={metricsModalOpen} onOpenChange={setMetricsModalOpen}>
                <DialogContent
                    title="Holo Hours & Wastage"
                    onOpenChange={setMetricsModalOpen}
                    className="max-w-4xl"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Enter hours and wastage for every date and Holo base machine in the selected range. Leave values blank to keep them missing.
                        </p>
                        <div className="text-sm text-muted-foreground">
                            Range: {exportFrom ? formatDateDDMMYYYY(exportFrom) : '—'} to {exportTo ? formatDateDDMMYYYY(exportTo) : '—'}
                        </div>
                        {metricsError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {metricsError}
                            </div>
                        )}
                        {metricsLoading ? (
                            <div className="py-10 text-center text-sm text-muted-foreground">Loading Holo metrics...</div>
                        ) : metricsDraftRows.length === 0 ? (
                            <div className="py-10 text-center text-sm text-muted-foreground">
                                No Holo base machines are available in masters for the selected range.
                            </div>
                        ) : (
                            <div className="rounded-md border max-h-[60vh] overflow-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Machine</TableHead>
                                            <TableHead className="text-right">Hours</TableHead>
                                            <TableHead className="text-right">Wastage</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {metricsDraftRows.map((row, index) => (
                                            <TableRow key={`${row.date}-${row.baseMachine}`}>
                                                <TableCell>{formatDateDDMMYYYY(row.date)}</TableCell>
                                                <TableCell>{row.baseMachine}</TableCell>
                                                <TableCell className="text-right">
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={row.hours}
                                                        onChange={(e) => {
                                                            const nextValue = e.target.value;
                                                            setMetricsDraftRows(prev => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, hours: nextValue } : entry));
                                                        }}
                                                        className="h-8 w-24 ml-auto"
                                                    />
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.001"
                                                        value={row.wastage}
                                                        onChange={(e) => {
                                                            const nextValue = e.target.value;
                                                            setMetricsDraftRows(prev => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, wastage: nextValue } : entry));
                                                        }}
                                                        className="h-8 w-28 ml-auto"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                            <Button variant="outline" onClick={() => setMetricsModalOpen(false)}>Close</Button>
                            <Button onClick={saveHoloMetricsDraft} disabled={metricsLoading || metricsSaving || metricsDraftRows.length === 0}>
                                {metricsSaving ? 'Saving...' : 'Save Metrics'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={weeklyModalOpen} onOpenChange={setWeeklyModalOpen}>
                <DialogContent
                    title="Holo Weekly Export"
                    onOpenChange={setWeeklyModalOpen}
                    className="max-w-xl"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Export a Holo weekly PDF for any date range. Missing daily metrics are treated as zero and will be called out in the PDF.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-medium mb-1 block">From Date</label>
                                <Input type="date" value={weeklyFrom} onChange={e => { setWeeklyFrom(e.target.value); setWeeklyError(''); }} disabled={weeklyExporting} />
                            </div>
                            <div>
                                <label className="text-sm font-medium mb-1 block">To Date</label>
                                <Input type="date" value={weeklyTo} onChange={e => { setWeeklyTo(e.target.value); setWeeklyError(''); }} disabled={weeklyExporting} />
                            </div>
                        </div>
                        {weeklyFrom && weeklyTo && weeklyFrom <= weeklyTo && (
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                Included dates: {formatDateDDMMYYYY(weeklyFrom)} to {formatDateDDMMYYYY(weeklyTo)}
                            </div>
                        )}
                        {weeklyError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-line">
                                {weeklyError}
                            </div>
                        )}
                        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                            <Button variant="outline" onClick={() => setWeeklyModalOpen(false)} disabled={weeklyExporting}>Cancel</Button>
                            <Button onClick={handleWeeklyExport} disabled={weeklyExporting}>
                                {weeklyExporting ? 'Preparing Download...' : 'Download Weekly PDF'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={otherWastageModalOpen} onOpenChange={setOtherWastageModalOpen}>
                <DialogContent
                    title="Other Wastage"
                    onOpenChange={setOtherWastageModalOpen}
                    className="max-w-4xl"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Enter wastage for every date and Other Wastage item in the selected range. Leave values blank to keep them missing.
                        </p>
                        <div className="text-sm text-muted-foreground">
                            Range: {exportFrom ? formatDateDDMMYYYY(exportFrom) : '—'} to {exportTo ? formatDateDDMMYYYY(exportTo) : '—'}
                        </div>
                        {otherWastageError && (
                            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {otherWastageError}
                            </div>
                        )}
                        {otherWastageLoading ? (
                            <div className="py-10 text-center text-sm text-muted-foreground">Loading Other Wastage...</div>
                        ) : otherWastageDraftRows.length === 0 ? (
                            <div className="py-10 text-center text-sm text-muted-foreground">
                                No Other Wastage items are available in Masters for the selected range.
                            </div>
                        ) : (
                            <div className="rounded-md border max-h-[60vh] overflow-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Item</TableHead>
                                            <TableHead className="text-right">Wastage</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {otherWastageDraftRows.map((row, index) => (
                                            <TableRow key={`${row.date}-${row.otherWastageItemId}`}>
                                                <TableCell>{formatDateDDMMYYYY(row.date)}</TableCell>
                                                <TableCell>{row.itemName}</TableCell>
                                                <TableCell className="text-right">
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        step="0.001"
                                                        value={row.wastage}
                                                        onChange={(e) => {
                                                            const nextValue = e.target.value;
                                                            setOtherWastageDraftRows(prev => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, wastage: nextValue } : entry));
                                                        }}
                                                        className="h-8 w-28 ml-auto"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                            <Button variant="outline" onClick={() => setOtherWastageModalOpen(false)}>Close</Button>
                            <Button onClick={saveOtherWastageDraft} disabled={otherWastageLoading || otherWastageSaving || otherWastageDraftRows.length === 0}>
                                {otherWastageSaving ? 'Saving...' : 'Save Other Wastage'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export function Reports() {
    const [activeTab, setActiveTab] = useState('barcode');
    const { isMobile, isTouchDevice } = useMobileDetect();
    const [useMobileMode, setUseMobileMode] = useState(false);

    // Auto-enable mobile mode on mobile touch devices
    useEffect(() => {
        if (isMobile && isTouchDevice) {
            setUseMobileMode(true);
        }
    }, [isMobile, isTouchDevice]);

    // Mobile view for Barcode History
    if (useMobileMode && activeTab === 'barcode') {
        return (
            <div className="space-y-4">
                {/* Header with toggle */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                            <BarChart3 className="w-6 h-6" />
                            Reports & Analytics
                        </h1>
                        <p className="text-muted-foreground text-sm">Scan barcode to trace history</p>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setUseMobileMode(false)}
                        className="flex items-center gap-2"
                    >
                        <Package className="w-4 h-4" />
                        <span>Desktop View</span>
                    </Button>
                </div>
                <MobileBarcodeHistory />
            </div>
        );
    }

    return (
        <div className="space-y-6 fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <BarChart3 className="w-6 h-6" />
                        Reports & Analytics
                    </h1>
                    <p className="text-muted-foreground text-sm">Track inventory lifecycle and production metrics</p>
                </div>

                {/* Scanner Toggle + Tab Toggle */}
                <div className="flex gap-2">
                    {activeTab === 'barcode' && (
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

                    {/* Tab Toggle */}
                    <div className="flex p-1 bg-muted rounded-lg">
                        <button
                            onClick={() => setActiveTab('barcode')}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2",
                                activeTab === 'barcode'
                                    ? "bg-background shadow text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Search className="w-4 h-4" />
                            Barcode History
                        </button>
                        <button
                            onClick={() => setActiveTab('production')}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2",
                                activeTab === 'production'
                                    ? "bg-background shadow text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Factory className="w-4 h-4" />
                            Production Report
                        </button>
                    </div>
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'barcode' ? <BarcodeHistory /> : <ProductionReport />}
        </div>
    );
}
