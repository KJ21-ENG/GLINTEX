import React, { useState, useEffect, useMemo } from 'react';
import { useInventory } from '../context/InventoryContext';
import * as api from '../api/client';
import {
    Button, Input, Select, Card, CardContent, CardHeader, CardTitle,
    Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge
} from '../components/ui';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { formatKg, todayISO, formatDateDDMMYYYY, estimateWeightFromCount } from '../utils';
import { exportHistoryToExcel, exportHistoryToCsv } from '../services';
import { Truck, Plus, Search, History, Package, X, ChevronRight, ChevronDown, Trash2, Printer, ScanLine, Download } from 'lucide-react';
import { cn } from '../lib/utils';
import { printDispatchChallan } from '../utils/printDispatchChallan';
import { useMobileDetect } from '../utils/useMobileDetect';
import { MobileDispatchView } from '../components/dispatch/MobileDispatchView';
import { usePermission } from '../hooks/usePermission';
import { DisabledWithTooltip } from '../components/common/DisabledWithTooltip';
import AccessDenied from '../components/common/AccessDenied';
import { UserBadge } from '../components/common/UserBadge';

const STAGES = [
    { id: 'inbound', label: 'Inbound', description: 'Raw jumbo rolls' },
    { id: 'cutter', label: 'Cutter', description: 'Bobbins' },
    { id: 'holo', label: 'Holo', description: 'Rolls' },
    { id: 'coning', label: 'Coning', description: 'Cones' },
];

export function Dispatch() {
    const { refreshDb, db } = useInventory();
    const { canRead, canWrite, canDelete } = usePermission('dispatch');
    const readOnly = canRead && !canWrite;
    const { isMobile, isTouchDevice } = useMobileDetect();
    const [activeTab, setActiveTab] = useState('dispatch'); // 'dispatch' | 'history'
    const [useMobileMode, setUseMobileMode] = useState(false); // Manual toggle for mobile scanner mode
    const [selectedStage, setSelectedStage] = useState('inbound');
    const [availableItems, setAvailableItems] = useState([]);
    const [loadingItems, setLoadingItems] = useState(false);
    const [customers, setCustomers] = useState([]);
    const [dispatches, setDispatches] = useState([]);
    const [loadingDispatches, setLoadingDispatches] = useState(false);
    const [itemSearch, setItemSearch] = useState('');
    const [historySearch, setHistorySearch] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [expandedChallan, setExpandedChallan] = useState(null);
    const [scanInput, setScanInput] = useState('');
    const [scanQueue, setScanQueue] = useState([]);

    // Auto-enable mobile mode on mobile devices
    React.useEffect(() => {
        if (isMobile && isTouchDevice) {
            setUseMobileMode(true);
        }
    }, [isMobile, isTouchDevice]);

    // Dispatch form state
    const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [bulkDispatchOpen, setBulkDispatchOpen] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [bulkForm, setBulkForm] = useState({
        customerId: '',
        date: todayISO(),
        notes: '',
    });
    const [bulkItems, setBulkItems] = useState([]);
    const [dispatchForm, setDispatchForm] = useState({
        customerId: '',
        weight: '',
        count: '',
        date: todayISO(),
        notes: '',
        mode: 'weight', // 'weight' | 'count'
    });
    const [submitting, setSubmitting] = useState(false);

    // New customer modal
    const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
    const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', address: '' });
    const [savingCustomer, setSavingCustomer] = useState(false);

    // Load customers
    useEffect(() => {
        if (!canRead) return;
        async function loadCustomers() {
            try {
                const res = await api.listCustomers();
                setCustomers(res.customers || []);
            } catch (err) {
                console.error('Failed to load customers', err);
            }
        }
        loadCustomers();
    }, [canRead]);

    // Load available items when stage changes
    useEffect(() => {
        if (!canRead) return;
        async function loadAvailableItems() {
            setLoadingItems(true);
            try {
                const res = await api.getDispatchAvailable(selectedStage);
                setAvailableItems(res.items || []);
            } catch (err) {
                console.error('Failed to load available items', err);
                setAvailableItems([]);
            } finally {
                setLoadingItems(false);
            }
        }
        if (activeTab === 'dispatch') {
            loadAvailableItems();
        }
    }, [canRead, selectedStage, activeTab]);

    useEffect(() => {
        setSelectedIds(new Set());
        setScanQueue([]);
    }, [selectedStage]);

    // Load dispatch history
    useEffect(() => {
        if (!canRead) return;
        async function loadDispatches() {
            setLoadingDispatches(true);
            try {
                const res = await api.listDispatches();
                setDispatches(res.dispatches || []);
            } catch (err) {
                console.error('Failed to load dispatches', err);
                setDispatches([]);
            } finally {
                setLoadingDispatches(false);
            }
        }
        if (activeTab === 'history') {
            loadDispatches();
        }
    }, [canRead, activeTab]);

    // Filter items based on search
    const filteredItems = useMemo(() => {
        if (!itemSearch.trim()) return availableItems;
        const terms = itemSearch.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
        return availableItems.filter(item => {
            const searchable = [
                item.barcode,
                item.legacyBarcode,
                item.lotLabel || item.lotNo,
                item.pieceId,
                String(item.weight),
            ].filter(Boolean).join(' ').toLowerCase();
            return terms.every(term => searchable.includes(term));
        });
    }, [availableItems, itemSearch]);

    const selectedItems = useMemo(
        () => filteredItems.filter(item => selectedIds.has(item.id)),
        [filteredItems, selectedIds]
    );

    // Filter dispatches for history
    const filteredDispatches = useMemo(() => {
        const map = new Map();
        for (const d of dispatches) {
            if (!d?.challanNo) continue;
            const existing = map.get(d.challanNo) || {
                challanNo: d.challanNo,
                date: d.date || d.createdAt || '',
                customer: d.customer || null,
                stage: d.stage || '',
                notes: d.notes || '',
                totalWeight: 0,
                totalCount: 0,
                items: [],
            };
            existing.items.push(d);
            existing.totalWeight += Number(d.weight || 0);
            existing.totalCount += Number(d.count || 0);
            map.set(d.challanNo, existing);
        }

        let list = Array.from(map.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        if (startDate || endDate) {
            list = list.filter(d => {
                const itemDateStr = (d.date || '').substring(0, 10);
                if (startDate && itemDateStr < startDate) return false;
                if (endDate && itemDateStr > endDate) return false;
                return true;
            });
        }

        if (historySearch.trim()) {
            const terms = historySearch.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
            list = list.filter(d => {
                const barcodes = d.items.map(i => i.stageBarcode).filter(Boolean).join(' ');
                const searchable = [
                    d.challanNo,
                    d.customer?.name,
                    d.stage,
                    barcodes,
                    String(d.totalWeight),
                    d.notes
                ].filter(Boolean).join(' ').toLowerCase();
                return terms.every(term => searchable.includes(term));
            });
        }

        return list;
    }, [dispatches, historySearch, startDate, endDate]);

    function handleExportDispatches(format = 'xlsx') {
        const exportData = filteredDispatches.map(d => ({
            challanNo: d.challanNo,
            date: formatDateDDMMYYYY(d.date),
            customer: d.customer?.name || '',
            stage: d.stage,
            barcodes: d.items.map(i => i.stageBarcode).filter(Boolean).join(', '),
            totalWeight: d.totalWeight,
            totalCount: d.totalCount || '',
            notes: d.notes || '',
        }));
        const columns = [
            { key: 'challanNo', header: 'Challan No' },
            { key: 'date', header: 'Date' },
            { key: 'customer', header: 'Customer' },
            { key: 'stage', header: 'Stage' },
            { key: 'barcodes', header: 'Barcodes' },
            { key: 'totalWeight', header: 'Total Weight' },
            { key: 'totalCount', header: 'Total Count' },
            { key: 'notes', header: 'Notes' },
        ];
        const today = new Date().toISOString().split('T')[0];
        if (format === 'csv') {
            exportHistoryToCsv(exportData, columns, `dispatch-history-${today}`);
        } else {
            exportHistoryToExcel(exportData, columns, `dispatch-history-${today}`);
        }
    }

    function openDispatchModal(item) {
        if (readOnly) return;
        setSelectedItem(item);
        // Default to count mode if item has piece count, otherwise weight
        const hasCount = item.availableCount > 0;
        setDispatchForm({
            customerId: '',
            weight: String(item.availableWeight || item.weight || ''),
            count: hasCount ? String(item.availableCount || '') : '',
            date: todayISO(),
            notes: '',
            mode: hasCount ? 'count' : 'weight',
        });
        setDispatchModalOpen(true);
    }

    function toggleSelectItem(id) {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    function toggleSelectAllItems() {
        setSelectedIds(prev => {
            const allIds = filteredItems.map(item => item.id);
            const allSelected = allIds.length > 0 && allIds.every(id => prev.has(id));
            if (allSelected) return new Set();
            return new Set(allIds);
        });
    }

    function openBulkDispatchModal() {
        if (readOnly) return;
        if (selectedItems.length === 0) {
            alert('Select at least one item to dispatch');
            return;
        }
        const defaults = selectedItems.map(item => {
            const hasCount = item.availableCount > 0;
            return {
                stageItemId: item.id,
                barcode: item.barcode,
                label: item.lotLabel || item.lotNo || item.pieceId || '—',
                availableWeight: item.availableWeight,
                availableCount: item.availableCount,
                avgWeightPerPiece: item.avgWeightPerPiece || 0,
                count: hasCount ? String(item.availableCount || '') : '',
                weight: String(item.availableWeight || ''),
            };
        });
        setBulkItems(defaults);
        setBulkForm({ customerId: '', date: todayISO(), notes: '' });
        setBulkDispatchOpen(true);
    }

    function handleScanSubmit(e) {
        if (readOnly) return;
        e.preventDefault();
        const rawInput = scanInput.trim().toUpperCase();
        if (!rawInput) return;
        setScanInput('');

        // Split input by spaces, commas, newlines, or tabs to support bulk paste
        const barcodes = rawInput
            .split(/[\s,\t\n]+/)
            .map(b => b.trim())
            .filter(Boolean);

        if (barcodes.length === 0) return;

        // Process each barcode
        const newEntries = [];
        const foundItemIds = new Set();

        for (const barcode of barcodes) {
            // Check if already in queue
            const alreadyInQueue = scanQueue.some(entry => entry.barcode === barcode) ||
                newEntries.some(entry => entry.barcode === barcode);
            if (alreadyInQueue) continue;

            const match = availableItems.find(item =>
                (item.barcode || '').toUpperCase() === barcode ||
                (item.legacyBarcode || '').toUpperCase() === barcode ||
                (item.lotNo || '').toUpperCase() === barcode ||
                (item.pieceId || '').toUpperCase() === barcode
            );

            if (!match) {
                newEntries.push({ barcode, status: 'not_found', error: `Not found in ${selectedStage}` });
            } else {
                // Check if this item is already selected (by ID)
                const alreadySelected = scanQueue.some(entry => entry.itemId === match.id) ||
                    foundItemIds.has(match.id);
                if (!alreadySelected) {
                    newEntries.push({
                        barcode,
                        status: 'found',
                        itemId: match.id,
                        label: match.lotLabel || match.lotNo || match.pieceId || '—'
                    });
                    foundItemIds.add(match.id);
                }
            }
        }

        // Update selectedIds with all found items
        if (foundItemIds.size > 0) {
            setSelectedIds(ids => {
                const next = new Set(ids);
                foundItemIds.forEach(id => next.add(id));
                return next;
            });
        }

        // Add new entries to the queue (newest first)
        if (newEntries.length > 0) {
            setScanQueue(prev => [...newEntries.reverse(), ...prev]);
        }
    }

    function clearScanQueue() {
        setScanQueue([]);
    }

    async function handleCreateDispatch() {
        if (readOnly) return;
        if (!selectedItem || !dispatchForm.customerId) {
            alert('Please fill in all required fields');
            return;
        }

        const weight = parseFloat(dispatchForm.weight);
        const count = dispatchForm.mode === 'count' ? parseInt(dispatchForm.count) : null;

        if (dispatchForm.mode === 'weight') {
            if (isNaN(weight) || weight <= 0) {
                alert('Please enter a valid weight');
                return;
            }
            if (weight > selectedItem.availableWeight + 0.001) {
                alert(`Weight cannot exceed available weight (${selectedItem.availableWeight.toFixed(3)} kg)`);
                return;
            }
        } else {
            // Count mode
            if (!count || count <= 0) {
                alert('Please enter a valid count');
                return;
            }
            if (count > selectedItem.availableCount) {
                alert(`Count cannot exceed available quantity (${selectedItem.availableCount})`);
                return;
            }
            if (!weight || weight <= 0) {
                alert('Weight must be greater than 0');
                return;
            }
        }

        setSubmitting(true);
        try {
            const res = await api.createDispatch({
                customerId: dispatchForm.customerId,
                stage: selectedStage,
                stageItemId: selectedItem.id,
                weight,
                count: dispatchForm.mode === 'count' ? count : null,
                date: dispatchForm.date,
                notes: dispatchForm.notes || null,
            });

            setDispatchModalOpen(false);

            // Auto print logic if desired, or just alert
            const shouldPrint = confirm('Dispatch created successfully! Do you want to print the challan?');
            if (shouldPrint && res.dispatch) {
                // We need to hydrate customer name as the response might just have ID
                // But typically responses includes relation if requested.
                // Assuming res.dispatch has relations or we merge it.
                // Re-fetch dispatches to get full object for printing just in case.
                const updatedDispatches = await api.listDispatches();
                setDispatches(updatedDispatches.dispatches || []);
                const freshDispatch = updatedDispatches.dispatches?.find(d => d.id === res.dispatch.id);
                if (freshDispatch) {
                    handlePrintChallan(freshDispatch);
                }
            }

            // Refresh available items regardless of print choice
            const availRes = await api.getDispatchAvailable(selectedStage);
            setAvailableItems(availRes.items || []);
            await refreshDb();

        } catch (err) {
            alert(err.message || 'Failed to create dispatch');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleCreateBulkDispatch() {
        if (readOnly) return;
        if (!bulkForm.customerId) {
            alert('Please select a customer');
            return;
        }
        if (bulkItems.length === 0) {
            alert('No items to dispatch');
            return;
        }

        const payloadItems = [];
        for (const item of bulkItems) {
            const count = item.count ? parseInt(item.count) : null;
            const weight = item.weight ? parseFloat(item.weight) : null;

            if (count && count > 0) {
                if (count > (item.availableCount || 0)) {
                    alert(`Count cannot exceed available quantity for ${item.barcode || item.label}`);
                    return;
                }
                if (!weight || weight <= 0) {
                    if (count === (item.availableCount || 0) && item.availableWeight) {
                        payloadItems.push({ stageItemId: item.stageItemId, count, weight: item.availableWeight });
                    } else if (!item.avgWeightPerPiece || item.avgWeightPerPiece <= 0) {
                        alert(`Weight must be provided for ${item.barcode || item.label}`);
                        return;
                    } else {
                        const estimatedWeight = count * item.avgWeightPerPiece;
                        payloadItems.push({ stageItemId: item.stageItemId, count, weight: estimatedWeight });
                    }
                } else {
                    payloadItems.push({ stageItemId: item.stageItemId, count, weight });
                }
            } else {
                if (!weight || weight <= 0) {
                    alert(`Weight must be provided for ${item.barcode || item.label}`);
                    return;
                }
                if (weight > (item.availableWeight || 0) + 0.001) {
                    alert(`Weight cannot exceed available weight for ${item.barcode || item.label}`);
                    return;
                }
                payloadItems.push({ stageItemId: item.stageItemId, weight });
            }
        }

        setSubmitting(true);
        try {
            await api.createDispatchBulk({
                customerId: bulkForm.customerId,
                stage: selectedStage,
                date: bulkForm.date,
                notes: bulkForm.notes || null,
                items: payloadItems,
            });

            setBulkDispatchOpen(false);
            setSelectedIds(new Set());
            setScanQueue([]);

            const availRes = await api.getDispatchAvailable(selectedStage);
            setAvailableItems(availRes.items || []);
            await refreshDb();
        } catch (err) {
            alert(err.message || 'Failed to create bulk dispatch');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDeleteDispatch(challanNo) {
        if (!canDelete) return;
        if (!confirm('Are you sure you want to cancel this challan? All items will be restored.')) return;

        try {
            await api.deleteDispatchChallan(challanNo);
            const res = await api.listDispatches();
            setDispatches(res.dispatches || []);
            await refreshDb();
        } catch (err) {
            alert(err.message || 'Failed to delete dispatch');
        }
    }

    async function handleCreateCustomer() {
        if (readOnly) return;
        if (!newCustomerForm.name.trim()) {
            alert('Customer name is required');
            return;
        }

        setSavingCustomer(true);
        try {
            const res = await api.createCustomer({
                name: newCustomerForm.name.trim(),
                phone: newCustomerForm.phone.trim() || null,
                address: newCustomerForm.address.trim() || null,
            });

            setCustomers(prev => [...prev, res.customer].sort((a, b) => a.name.localeCompare(b.name)));
            setDispatchForm(prev => ({ ...prev, customerId: res.customer.id }));
            setNewCustomerModalOpen(false);
            setNewCustomerForm({ name: '', phone: '', address: '' });
            await refreshDb();
        } catch (err) {
            alert(err.message || 'Failed to create customer');
        } finally {
            setSavingCustomer(false);
        }
    }

    function handlePrintChallan(dispatch) {
        const settings = db?.settings?.[0] || {};
        const firmDetails = {
            name: settings.challanFromName || 'Aalekhan',
            address: settings.challanFromAddress,
            mobile: settings.challanFromMobile
        };
        printDispatchChallan(dispatch, firmDetails);
    }

    // Handler for mobile dispatch view to create dispatch
    async function handleMobileDispatchCreate(dispatchData) {
        if (readOnly) return null;
        const res = await api.createDispatch(dispatchData);

        const shouldPrint = confirm('Dispatch created successfully! Do you want to print the challan?');
        if (shouldPrint && res.dispatch) {
            const updatedDispatches = await api.listDispatches();
            setDispatches(updatedDispatches.dispatches || []);
            const freshDispatch = updatedDispatches.dispatches?.find(d => d.id === res.dispatch.id);
            if (freshDispatch) {
                handlePrintChallan(freshDispatch);
            }
        }

        const availRes = await api.getDispatchAvailable(selectedStage);
        setAvailableItems(availRes.items || []);
        await refreshDb();
        return res.dispatch;
    }

    async function handleMobileDispatchBulk(dispatchData) {
        if (readOnly) return null;
        const res = await api.createDispatchBulk(dispatchData);
        const availRes = await api.getDispatchAvailable(selectedStage);
        setAvailableItems(availRes.items || []);
        await refreshDb();
        return res;
    }

    // Handler for mobile dispatch view to add customer
    async function handleMobileAddCustomer(customerData) {
        if (readOnly) return null;
        const res = await api.createCustomer(customerData);
        setCustomers(prev => [...prev, res.customer].sort((a, b) => a.name.localeCompare(b.name)));
        await refreshDb();
        return res.customer;
    }

    const getStageUnitLabel = (stage) => {
        if (stage === 'cutter') return 'Bobbins';
        if (stage === 'holo') return 'Rolls';
        if (stage === 'coning') return 'Cones';
        return 'Pieces';
    };

    if (!canRead) {
        return (
            <div className="space-y-6 fade-in">
                <h1 className="text-2xl font-bold tracking-tight">Dispatch</h1>
                <AccessDenied message="You do not have access to dispatch. Contact an administrator to request access." />
            </div>
        );
    }

    return (
        <div className="space-y-6 fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Truck className="w-6 h-6" />
                        Dispatch
                    </h1>
                    <p className="text-muted-foreground text-sm">Dispatch goods from any production stage</p>
                    {readOnly && (
                        <p className="text-xs text-muted-foreground mt-1">
                            Read-only access: dispatch creation is disabled. Deletions require delete permission.
                        </p>
                    )}
                </div>

                {/* Tab Toggle */}
                <div className="flex gap-2">
                    {/* Scanner Mode Toggle - only show on dispatch tab */}
                    {activeTab === 'dispatch' && (
                        <Button
                            variant={useMobileMode ? "default" : "outline"}
                            size="sm"
                            onClick={() => setUseMobileMode(!useMobileMode)}
                            className="flex items-center gap-2"
                        >
                            <ScanLine className="w-4 h-4" />
                            <span className="hidden sm:inline">{useMobileMode ? 'Scanner' : 'Table'}</span>
                        </Button>
                    )}

                    <div className="flex p-1 bg-muted rounded-lg">
                        <button
                            onClick={() => setActiveTab('dispatch')}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center gap-2",
                                activeTab === 'dispatch'
                                    ? "bg-background shadow text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Package className="w-4 h-4" />
                            Dispatch
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

            {activeTab === 'dispatch' ? (
                useMobileMode ? (
                    /* Mobile Scanner View */
                    <MobileDispatchView
                        customers={customers}
                        onDispatchCreate={handleMobileDispatchCreate}
                        onDispatchBulkCreate={handleMobileDispatchBulk}
                        onAddCustomer={handleMobileAddCustomer}
                        refreshAvailableItems={() => api.getDispatchAvailable(selectedStage).then(res => setAvailableItems(res.items || []))}
                    />
                ) : (
                    <>
                        {/* Stage Tabs */}
                        <Card className="bg-muted/40 border-none shadow-none">
                            <CardContent className="p-4">
                                <div className="flex flex-wrap gap-2">
                                    {STAGES.map(stage => (
                                        <button
                                            key={stage.id}
                                            onClick={() => setSelectedStage(stage.id)}
                                            className={cn(
                                                "px-4 py-3 rounded-lg transition-all flex-1 min-w-[120px] text-left",
                                                selectedStage === stage.id
                                                    ? "bg-primary text-primary-foreground shadow-md"
                                                    : "bg-background hover:bg-muted border border-border"
                                            )}
                                        >
                                            <div className="font-medium">{stage.label}</div>
                                            <div className={cn(
                                                "text-xs",
                                                selectedStage === stage.id ? "text-primary-foreground/80" : "text-muted-foreground"
                                            )}>
                                                {stage.description}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Scan Queue */}
                        <Card className="mb-4">
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-medium">Scan Queue</div>
                                        <div className="text-xs text-muted-foreground">Use scanner gun and press Enter</div>
                                    </div>
                                    {scanQueue.length > 0 && (
                                        <Button size="sm" variant="ghost" onClick={clearScanQueue}>
                                            Clear
                                        </Button>
                                    )}
                                </div>
                                <form onSubmit={handleScanSubmit} className="flex gap-2">
                                    <Input
                                        placeholder="Scan barcode..."
                                        value={scanInput}
                                        onChange={e => setScanInput(e.target.value)}
                                        disabled={readOnly}
                                    />
                                    <Button type="submit" variant="outline" disabled={readOnly}>Add</Button>
                                </form>
                                {scanQueue.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {scanQueue.slice(0, 12).map(entry => (
                                            <Badge
                                                key={entry.barcode}
                                                variant="outline"
                                                className={cn(
                                                    entry.status === 'found' && 'border-green-600 text-green-600',
                                                    entry.status === 'not_found' && 'border-red-600 text-red-600'
                                                )}
                                            >
                                                {entry.barcode}
                                            </Badge>
                                        ))}
                                        {scanQueue.length > 12 && (
                                            <Badge variant="outline">+{scanQueue.length - 12} more</Badge>
                                        )}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Available Items Table */}
                        <Card>
                            <CardHeader>
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <CardTitle className="text-lg">
                                        Available for Dispatch - {STAGES.find(s => s.id === selectedStage)?.label}
                                    </CardTitle>
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                        <div className="relative w-full sm:w-64">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder="Search by barcode, lot no..."
                                                className="pl-10 h-9"
                                                value={itemSearch}
                                                onChange={e => setItemSearch(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {selectedIds.size > 0 && (
                                                <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                                            )}
                                            <Button
                                                size="sm"
                                                onClick={openBulkDispatchModal}
                                                disabled={selectedIds.size === 0 || readOnly}
                                            >
                                                Dispatch Selected
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="hidden sm:block rounded-md border overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[30px]">
                                                    <input
                                                        type="checkbox"
                                                        checked={filteredItems.length > 0 && filteredItems.every(item => selectedIds.has(item.id))}
                                                        onChange={toggleSelectAllItems}
                                                        disabled={readOnly}
                                                        className="h-4 w-4 rounded border-gray-300"
                                                    />
                                                </TableHead>
                                                <TableHead>Barcode</TableHead>
                                                {selectedStage !== 'inbound' && <TableHead>Piece/Lot</TableHead>}
                                                {selectedStage === 'inbound' && <TableHead>Lot No</TableHead>}
                                                <TableHead className="text-right">Total Weight</TableHead>
                                                <TableHead className="text-right">Available</TableHead>
                                                {selectedStage !== 'inbound' && (
                                                    <TableHead className="text-right">Available {getStageUnitLabel(selectedStage)}</TableHead>
                                                )}
                                                <TableHead className="w-[100px]"></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {loadingItems ? (
                                                <TableRow>
                                                    <TableCell colSpan={8} className="h-24 text-center">
                                                        Loading...
                                                    </TableCell>
                                                </TableRow>
                                            ) : filteredItems.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                                        No items available for dispatch
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                filteredItems.map(item => (
                                                    <TableRow key={item.id}>
                                                        <TableCell>
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedIds.has(item.id)}
                                                                onChange={() => toggleSelectItem(item.id)}
                                                                disabled={readOnly}
                                                                className="h-4 w-4 rounded border-gray-300"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-mono text-sm">{item.barcode || '—'}</TableCell>
                                                        <TableCell>{item.lotLabel || item.lotNo || item.pieceId || '—'}</TableCell>
                                                        <TableCell className="text-right">{formatKg(item.weight)}</TableCell>
                                                        <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                                                            {formatKg(item.availableWeight)}
                                                        </TableCell>
                                                        {selectedStage !== 'inbound' && (
                                                            <TableCell className="text-right">
                                                                {item.availableCount !== undefined ?
                                                                    `${item.availableCount} / ${item.totalCount}` :
                                                                    (item.bobbinQuantity || item.rollCount || item.coneCount || '—')}
                                                            </TableCell>
                                                        )}
                                                        <TableCell>
                                                            <Button
                                                                size="sm"
                                                                onClick={() => openDispatchModal(item)}
                                                                disabled={readOnly}
                                                            >
                                                                <ChevronRight className="w-4 h-4 mr-1" />
                                                                Dispatch
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>

                                {/* Mobile Card View for Available Items */}
                                <div className="block sm:hidden space-y-3">
                                    {loadingItems ? (
                                        <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">Loading...</div>
                                    ) : filteredItems.length === 0 ? (
                                        <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No items available for dispatch</div>
                                    ) : (
                                        filteredItems.map(item => (
                                            <div key={item.id} className="border rounded-lg p-4 bg-card shadow-sm">
                                                <div className="flex justify-between items-start gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="font-mono text-sm font-semibold truncate">{item.barcode || '—'}</p>
                                                        <p className="text-sm text-muted-foreground">{item.lotLabel || item.lotNo || item.pieceId || '—'}</p>
                                                    </div>
                                                    <Badge variant="outline" className="text-green-600 border-green-600 whitespace-nowrap">
                                                        {formatKg(item.availableWeight)} avail
                                                    </Badge>
                                                </div>
                                                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                                    <span>Total: {formatKg(item.weight)}</span>
                                                    {item.availableCount !== undefined && (
                                                        <span>{item.availableCount} / {item.totalCount} {getStageUnitLabel(selectedStage)} left</span>
                                                    )}
                                                </div>
                                                <Button
                                                    size="sm"
                                                    className="mt-3 w-full"
                                                    onClick={() => openDispatchModal(item)}
                                                    disabled={readOnly}
                                                >
                                                    <ChevronRight className="w-4 h-4 mr-1" /> Dispatch
                                                </Button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </>
                )
            ) : (
                /* History Tab */
                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <CardTitle className="text-lg">Dispatch History</CardTitle>

                            {/* History Filters */}
                            <div className="flex flex-col items-stretch sm:flex-row sm:items-end gap-4 bg-muted/30 p-4 rounded-lg border">
                                <div className="flex-1 space-y-1 w-full">
                                    <label className="text-xs font-medium text-muted-foreground uppercase">Search</label>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            placeholder="Search by challan, customer, barcode, stage..."
                                            className="pl-10 h-9"
                                            value={historySearch}
                                            onChange={e => setHistorySearch(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-2 w-full sm:w-auto">
                                    <div className="space-y-1 flex-1 sm:flex-none">
                                        <label className="text-xs font-medium text-muted-foreground uppercase">From</label>
                                        <Input
                                            type="date"
                                            className="h-9"
                                            value={startDate}
                                            onChange={e => setStartDate(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1 flex-1 sm:flex-none">
                                        <label className="text-xs font-medium text-muted-foreground uppercase">To</label>
                                        <Input
                                            type="date"
                                            className="h-9"
                                            value={endDate}
                                            onChange={e => setEndDate(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-9 border"
                                        onClick={() => {
                                            setHistorySearch('');
                                            setStartDate('');
                                            setEndDate('');
                                        }}
                                    >
                                        Clear
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="h-9"
                                        onClick={() => handleExportDispatches('xlsx')}
                                    >
                                        <Download className="w-4 h-4 mr-1" />
                                        Export
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-9"
                                        onClick={() => handleExportDispatches('csv')}
                                    >
                                        CSV
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="hidden sm:block rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[30px]"></TableHead>
                                        <TableHead>Challan No</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Stage</TableHead>
                                        <TableHead>Items</TableHead>
                                        <TableHead className="text-right">Total Weight</TableHead>
                                        <TableHead>Added By</TableHead>
                                        <TableHead className="w-[120px] text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loadingDispatches ? (
                                        <TableRow>
                                            <TableCell colSpan={9} className="h-24 text-center">
                                                Loading...
                                            </TableCell>
                                        </TableRow>
                                    ) : filteredDispatches.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                                                No dispatches found
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredDispatches.map(d => {
                                            const isExpanded = expandedChallan === d.challanNo;
                                            return (
                                                <React.Fragment key={d.challanNo}>
                                                    <TableRow
                                                        className="cursor-pointer hover:bg-muted/50"
                                                        onClick={() => setExpandedChallan(isExpanded ? null : d.challanNo)}
                                                    >
                                                        <TableCell>
                                                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                                        </TableCell>
                                                        <TableCell className="font-mono text-sm font-medium">{d.challanNo}</TableCell>
                                                        <TableCell>{formatDateDDMMYYYY(d.date)}</TableCell>
                                                        <TableCell>{d.customer?.name || '—'}</TableCell>
                                                        <TableCell>
                                                            <Badge variant="outline" className="capitalize">
                                                                {d.stage}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-sm">{d.items.length} items</TableCell>
                                                        <TableCell className="text-right font-medium">{formatKg(d.totalWeight)}</TableCell>
                                                        <TableCell>
                                                            <UserBadge user={d.createdByUser} timestamp={d.createdAt} />
                                                        </TableCell>
                                                        <TableCell className="text-right whitespace-nowrap">
                                                            <Button
                                                                size="sm"
                                                                variant="ghost"
                                                                className="h-8 w-8 p-0 mr-1"
                                                                onClick={(e) => { e.stopPropagation(); handlePrintChallan(d); }}
                                                                title="Print Challan"
                                                            >
                                                                <Printer className="w-4 h-4" />
                                                            </Button>
                                                            <DisabledWithTooltip
                                                                disabled={!canDelete}
                                                                tooltip="You do not have permission to delete dispatches."
                                                            >
                                                                <Button
                                                                    size="sm"
                                                                    variant="ghost"
                                                                    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                                                    onClick={(e) => { e.stopPropagation(); handleDeleteDispatch(d.challanNo); }}
                                                                    title="Delete Challan"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </DisabledWithTooltip>
                                                        </TableCell>
                                                    </TableRow>
                                                    {isExpanded && (
                                                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                                                            <TableCell colSpan={9} className="p-4">
                                                                <div className="border rounded-md bg-background overflow-x-auto">
                                                                    <Table>
                                                                        <TableHeader>
                                                                            <TableRow>
                                                                                <TableHead>Barcode</TableHead>
                                                                                <TableHead className="text-right">Count</TableHead>
                                                                                <TableHead className="text-right">Weight</TableHead>
                                                                            </TableRow>
                                                                        </TableHeader>
                                                                        <TableBody>
                                                                            {d.items.map(item => (
                                                                                <TableRow key={item.id}>
                                                                                    <TableCell className="font-mono text-xs">{item.stageBarcode || '—'}</TableCell>
                                                                                    <TableCell className="text-right">{item.count || '—'}</TableCell>
                                                                                    <TableCell className="text-right">{formatKg(item.weight)}</TableCell>
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

                        {/* Mobile Card View for Dispatch History */}
                        <div className="block sm:hidden space-y-3">
                            {loadingDispatches ? (
                                <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">Loading...</div>
                            ) : filteredDispatches.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground border rounded-lg bg-card">No dispatches found</div>
                            ) : (
                                filteredDispatches.map(d => {
                                    const isExpanded = expandedChallan === d.challanNo;
                                    return (
                                        <div key={d.challanNo} className="border rounded-lg p-4 bg-card shadow-sm">
                                            <div className="flex justify-between items-start gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-mono text-sm font-semibold">{d.challanNo}</p>
                                                    <p className="text-sm text-muted-foreground">{d.customer?.name || '—'}</p>
                                                    <p className="text-xs text-muted-foreground mt-1">{formatDateDDMMYYYY(d.date)}</p>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    <Badge variant="outline" className="capitalize text-xs">{d.stage}</Badge>
                                                    <span className="font-medium">{formatKg(d.totalWeight)}</span>
                                                </div>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between">
                                                <span className="text-xs text-muted-foreground">{d.items.length} items</span>
                                                <div className="flex gap-1">
                                                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => handlePrintChallan(d)}>
                                                        <Printer className="w-4 h-4" />
                                                    </Button>
                                                    <DisabledWithTooltip
                                                        disabled={!canDelete}
                                                        tooltip="You do not have permission to delete dispatches."
                                                    >
                                                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => handleDeleteDispatch(d.challanNo)}>
                                                            <Trash2 className="w-4 h-4" />
                                                        </Button>
                                                    </DisabledWithTooltip>
                                                </div>
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="mt-2 w-full"
                                                onClick={() => setExpandedChallan(isExpanded ? null : d.challanNo)}
                                            >
                                                {isExpanded ? 'Hide Items' : 'Show Items'}
                                            </Button>
                                            {isExpanded && (
                                                <div className="mt-2 space-y-1">
                                                    {d.items.map(item => (
                                                        <div key={item.id} className="flex items-center justify-between text-xs border rounded-md px-2 py-1">
                                                            <span className="font-mono">{item.stageBarcode || '—'}</span>
                                                            <span>{item.count || '—'} • {formatKg(item.weight)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </CardContent>
                </Card>
            )
            }

            {/* Dispatch Modal */}
            <Dialog open={dispatchModalOpen} onOpenChange={setDispatchModalOpen}>
                <DialogContent title="Create Dispatch" onOpenChange={setDispatchModalOpen}>
                    <div className="space-y-4">
                        {selectedItem && (
                            <div className="bg-muted p-4 rounded-lg">
                                <div className="text-sm text-muted-foreground mb-1">Dispatching from {selectedItem.stage || selectedStage}</div>
                                <div className="font-medium">{selectedItem.barcode || selectedItem.lotLabel || selectedItem.lotNo}</div>
                                <div className="text-sm text-muted-foreground">
                                    Available: <span className="font-medium text-green-600">{formatKg(selectedItem.availableWeight)}</span>
                                </div>
                            </div>
                        )}

                        <div>
                            <Label>Customer *</Label>
                            <div className="flex gap-2">
                                <Select
                                    className="flex-1"
                                    value={dispatchForm.customerId}
                                    onChange={e => setDispatchForm(prev => ({ ...prev, customerId: e.target.value }))}
                                >
                                    <option value="">Select Customer</option>
                                    {customers.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </Select>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => setNewCustomerModalOpen(true)}
                                    title="Add New Customer"
                                    disabled={readOnly}
                                >
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Dispatch Mode & Weight/Count Inputs */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Dispatch Mode Toggle - Only for stages that support count */}
                            {selectedItem?.availableCount > 0 && (
                                <div className="col-span-2 flex gap-4 border p-2 rounded-md bg-muted/20">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            id="mode-weight"
                                            name="dispatchMode"
                                            checked={dispatchForm.mode === 'weight'}
                                            onChange={() => setDispatchForm(prev => ({ ...prev, mode: 'weight', count: '' }))}
                                            className="w-4 h-4"
                                        />
                                        <label htmlFor="mode-weight" className="text-sm font-medium cursor-pointer">By Weight ({formatKg(selectedItem.availableWeight)} available)</label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            id="mode-count"
                                            name="dispatchMode"
                                            checked={dispatchForm.mode === 'count'}
                                            onChange={() => setDispatchForm(prev => ({ ...prev, mode: 'count' }))}
                                            className="w-4 h-4"
                                        />
                                        <label htmlFor="mode-count" className="text-sm font-medium cursor-pointer">By Count ({selectedItem.availableCount} {getStageUnitLabel(selectedStage)} available)</label>
                                    </div>
                                </div>
                            )}

                            {dispatchForm.mode === 'count' && (
                                <div>
                                    <Label>Count ({getStageUnitLabel(selectedStage)}) *</Label>
                                    <Input
                                        type="number"
                                        step="1"
                                        value={dispatchForm.count}
                                        onChange={e => {
                                            const val = e.target.value;
                                            const intVal = parseInt(val) || 0;
                                            const estimatedWeight = estimateWeightFromCount({
                                                count: intVal,
                                                availableCount: selectedItem?.availableCount,
                                                availableWeight: selectedItem?.availableWeight,
                                                avgWeightPerPiece: selectedItem?.avgWeightPerPiece,
                                                totalWeight: selectedItem?.weight,
                                                totalCount: selectedItem?.totalCount,
                                            });
                                            setDispatchForm(prev => ({ ...prev, count: val, weight: estimatedWeight }));
                                        }}
                                        max={selectedItem?.availableCount}
                                    />
                                    {selectedItem?.avgWeightPerPiece > 0 && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Avg: {selectedItem.avgWeightPerPiece.toFixed(3)} kg/pc
                                        </p>
                                    )}
                                </div>
                            )}

                            <div>
                                <Label>Weight (kg) *</Label>
                                <Input
                                    type="number"
                                    step="0.001"
                                    value={dispatchForm.weight}
                                    onChange={e => setDispatchForm(prev => ({ ...prev, weight: e.target.value }))}
                                    max={selectedItem?.availableWeight}
                                />
                            </div>
                            <div>
                                <Label>Date</Label>
                                <Input
                                    type="date"
                                    value={dispatchForm.date}
                                    onChange={e => setDispatchForm(prev => ({ ...prev, date: e.target.value }))}
                                />
                            </div>
                        </div>

                        <div>
                            <Label>Notes (Optional)</Label>
                            <Input
                                value={dispatchForm.notes}
                                onChange={e => setDispatchForm(prev => ({ ...prev, notes: e.target.value }))}
                                placeholder="Any additional notes..."
                            />
                        </div>

                        <div className="flex justify-end gap-2 pt-4">
                            <Button variant="outline" onClick={() => setDispatchModalOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreateDispatch}
                                disabled={submitting || !dispatchForm.customerId || !dispatchForm.weight || readOnly}
                            >
                                {submitting ? 'Creating...' : 'Create Dispatch'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Bulk Dispatch Modal */}
            <Dialog open={bulkDispatchOpen} onOpenChange={setBulkDispatchOpen}>
                <DialogContent title="Dispatch Selected Items" onOpenChange={setBulkDispatchOpen} className="max-h-[85vh] overflow-hidden">
                    <div className="space-y-4 max-h-[70vh] overflow-auto pr-2">
                        <div>
                            <Label>Customer *</Label>
                            <div className="flex gap-2">
                                <Select
                                    className="flex-1"
                                    value={bulkForm.customerId}
                                    onChange={e => setBulkForm(prev => ({ ...prev, customerId: e.target.value }))}
                                >
                                    <option value="">Select Customer</option>
                                    {customers.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </Select>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => setNewCustomerModalOpen(true)}
                                    title="Add New Customer"
                                    disabled={readOnly}
                                >
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <Label>Date</Label>
                                <Input
                                    type="date"
                                    value={bulkForm.date}
                                    onChange={e => setBulkForm(prev => ({ ...prev, date: e.target.value }))}
                                />
                            </div>
                            <div>
                                <Label>Notes (Optional)</Label>
                                <Input
                                    value={bulkForm.notes}
                                    onChange={e => setBulkForm(prev => ({ ...prev, notes: e.target.value }))}
                                    placeholder="Any additional notes..."
                                />
                            </div>
                        </div>

                        <div className="border rounded-md overflow-hidden">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Barcode</TableHead>
                                        <TableHead>Piece/Lot</TableHead>
                                        {selectedStage !== 'inbound' && (
                                            <TableHead className="text-right">Count</TableHead>
                                        )}
                                        <TableHead className="text-right">Weight (kg)</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {bulkItems.map(item => (
                                        <TableRow key={item.stageItemId}>
                                            <TableCell className="font-mono text-sm">{item.barcode || '—'}</TableCell>
                                            <TableCell>{item.label || '—'}</TableCell>
                                            {selectedStage !== 'inbound' && (
                                                <TableCell className="text-right">
                                                    <Input
                                                        type="number"
                                                        step="1"
                                                        className="h-8 w-24 ml-auto"
                                                        value={item.count}
                                                        onChange={e => {
                                                            const nextCount = e.target.value;
                                                            const intVal = parseInt(nextCount) || 0;
                                                            const nextWeight = estimateWeightFromCount({
                                                                count: intVal,
                                                                availableCount: item.availableCount,
                                                                availableWeight: item.availableWeight,
                                                                avgWeightPerPiece: item.avgWeightPerPiece,
                                                                totalWeight: item.totalWeight,
                                                                totalCount: item.totalCount,
                                                            }) || item.weight;
                                                            setBulkItems(prev => prev.map(i => (
                                                                i.stageItemId === item.stageItemId
                                                                    ? { ...i, count: nextCount, weight: nextWeight }
                                                                    : i
                                                            )));
                                                        }}
                                                        max={item.availableCount}
                                                    />
                                                </TableCell>
                                            )}
                                            <TableCell className="text-right">
                                                <Input
                                                    type="number"
                                                    step="0.001"
                                                    className="h-8 w-28 ml-auto"
                                                    value={item.weight}
                                                    onChange={e => {
                                                        const nextWeight = e.target.value;
                                                        setBulkItems(prev => prev.map(i => (
                                                            i.stageItemId === item.stageItemId
                                                                ? { ...i, weight: nextWeight }
                                                                : i
                                                        )));
                                                    }}
                                                    max={item.availableWeight}
                                                />
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="outline" onClick={() => setBulkDispatchOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreateBulkDispatch}
                                disabled={submitting || !bulkForm.customerId || readOnly}
                            >
                                {submitting ? 'Creating...' : 'Create Dispatch'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* New Customer Modal */}
            <Dialog open={newCustomerModalOpen} onOpenChange={setNewCustomerModalOpen}>
                <DialogContent title="Add New Customer" onOpenChange={setNewCustomerModalOpen}>
                    <div className="space-y-4">
                        <div>
                            <Label>Name *</Label>
                            <Input
                                value={newCustomerForm.name}
                                onChange={e => setNewCustomerForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Customer name"
                            />
                        </div>
                        <div>
                            <Label>Phone</Label>
                            <Input
                                value={newCustomerForm.phone}
                                onChange={e => setNewCustomerForm(prev => ({ ...prev, phone: e.target.value }))}
                                placeholder="Phone number (optional)"
                            />
                        </div>
                        <div>
                            <Label>Address</Label>
                            <Input
                                value={newCustomerForm.address}
                                onChange={e => setNewCustomerForm(prev => ({ ...prev, address: e.target.value }))}
                                placeholder="Address (optional)"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-4">
                            <Button variant="outline" onClick={() => setNewCustomerModalOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleCreateCustomer}
                                disabled={savingCustomer || !newCustomerForm.name.trim() || readOnly}
                            >
                                {savingCustomer ? 'Saving...' : 'Add Customer'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div >
    );
}
