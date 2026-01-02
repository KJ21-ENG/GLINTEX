import React, { useState, useEffect } from 'react';
import * as api from '../api/client';
import {
    Button, Input, Select, Card, CardContent, CardHeader, CardTitle,
    Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge
} from '../components/ui';
import { formatKg, formatDateDDMMYYYY, todayISO } from '../utils';
import {
    BarChart3, Search, ChevronDown, ChevronRight,
    Package, Truck, Factory, Clock, Users, Gauge,
    Calendar, FileBarChart2
} from 'lucide-react';
import { cn } from '../lib/utils';

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
            value !== null && value !== undefined && key !== 'pieceId' && key !== 'issueId' && key !== 'receiveId' && key !== 'dispatchId'
        );

        return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
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
                <div className="relative">
                    {/* Timeline Line */}
                    <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />

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
                                                    <div className="font-medium">
                                                        {STAGE_LABELS[stage.stage] || stage.stage}
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
            )}
        </div>
    );
}

function ProductionReport() {
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

    async function loadReport() {
        setLoading(true);
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

    const getColumnHeaders = () => {
        if (view === 'operator') return ['Operator', 'Received (kg)', 'Count'];
        if (view === 'shift') return ['Shift', 'Received (kg)', 'Count'];
        return ['Machine', 'Received (kg)', 'Count'];
    };

    const getRowData = (item) => {
        if (view === 'operator') return [item.operatorName || 'Unknown', formatKg(item.received), item.count || item.rollCount || item.coneCount || 0];
        if (view === 'shift') return [item.shift || 'Not Specified', formatKg(item.received), item.count || item.rollCount || item.coneCount || 0];
        return [item.machineNo || item.machineName || 'Unknown', formatKg(item.received), item.count || item.rollCount || item.coneCount || 0];
    };

    return (
        <div className="space-y-6">
            {/* Filters */}
            <Card className="bg-muted/40 border-none shadow-none">
                <CardContent className="py-4">
                    <div className="flex flex-wrap gap-4 items-end">
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
                    </div>
                </CardContent>
            </Card>

            {/* Summary Cards */}
            {report && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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

                    <Card className="bg-gradient-to-br from-purple-500/10 to-purple-500/5 border-purple-500/20">
                        <CardContent className="py-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                                    <Calendar className="w-5 h-5 text-purple-500" />
                                </div>
                                <div>
                                    <div className="text-sm text-muted-foreground">Date Range</div>
                                    <div className="text-sm font-medium">
                                        {formatDateDDMMYYYY(report.dateRange.from)} - {formatDateDDMMYYYY(report.dateRange.to)}
                                    </div>
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
                        {' '}- {view === 'operator' ? 'Operator-wise' : view === 'shift' ? 'Shift-wise' : 'Machine-wise'}
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
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
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
                                        return (
                                            <TableRow key={index}>
                                                {rowData.map((cell, i) => (
                                                    <TableCell key={i} className={cn(i > 0 && 'text-right', i === 0 && 'font-medium')}>
                                                        {cell}
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export function Reports() {
    const [activeTab, setActiveTab] = useState('barcode');

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

            {/* Tab Content */}
            {activeTab === 'barcode' ? <BarcodeHistory /> : <ProductionReport />}
        </div>
    );
}