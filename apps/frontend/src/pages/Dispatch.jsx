import React, { useState, useEffect, useMemo } from 'react';
import { useInventory } from '../context/InventoryContext';
import * as api from '../api/client';
import {
    Button, Input, Select, Card, CardContent, CardHeader, CardTitle,
    Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge
} from '../components/ui';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { formatKg, todayISO, formatDateDDMMYYYY } from '../utils';
import { Truck, Plus, Search, History, Package, X, ChevronRight, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

const STAGES = [
    { id: 'inbound', label: 'Inbound', description: 'Raw jumbo rolls' },
    { id: 'cutter', label: 'Cutter', description: 'Bobbins' },
    { id: 'holo', label: 'Holo', description: 'Rolls' },
    { id: 'coning', label: 'Coning', description: 'Cones' },
];

export function Dispatch() {
    const { refreshDb } = useInventory();
    const [activeTab, setActiveTab] = useState('dispatch'); // 'dispatch' | 'history'
    const [selectedStage, setSelectedStage] = useState('inbound');
    const [availableItems, setAvailableItems] = useState([]);
    const [loadingItems, setLoadingItems] = useState(false);
    const [customers, setCustomers] = useState([]);
    const [dispatches, setDispatches] = useState([]);
    const [loadingDispatches, setLoadingDispatches] = useState(false);
    const [search, setSearch] = useState('');

    // Dispatch form state
    const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [dispatchForm, setDispatchForm] = useState({
        customerId: '',
        weight: '',
        date: todayISO(),
        notes: '',
    });
    const [submitting, setSubmitting] = useState(false);

    // New customer modal
    const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
    const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', address: '' });
    const [savingCustomer, setSavingCustomer] = useState(false);

    // Load customers
    useEffect(() => {
        async function loadCustomers() {
            try {
                const res = await api.listCustomers();
                setCustomers(res.customers || []);
            } catch (err) {
                console.error('Failed to load customers', err);
            }
        }
        loadCustomers();
    }, []);

    // Load available items when stage changes
    useEffect(() => {
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
    }, [selectedStage, activeTab]);

    // Load dispatch history
    useEffect(() => {
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
    }, [activeTab]);

    // Filter items based on search
    const filteredItems = useMemo(() => {
        if (!search.trim()) return availableItems;
        const terms = search.toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
        return availableItems.filter(item => {
            const searchable = [
                item.barcode,
                item.lotNo,
                item.pieceId,
                String(item.weight),
            ].filter(Boolean).join(' ').toLowerCase();
            return terms.every(term => searchable.includes(term));
        });
    }, [availableItems, search]);

    function openDispatchModal(item) {
        setSelectedItem(item);
        setDispatchForm({
            customerId: '',
            weight: String(item.availableWeight || item.weight || ''),
            date: todayISO(),
            notes: '',
        });
        setDispatchModalOpen(true);
    }

    async function handleCreateDispatch() {
        if (!selectedItem || !dispatchForm.customerId || !dispatchForm.weight) {
            alert('Please fill in all required fields');
            return;
        }

        const weight = parseFloat(dispatchForm.weight);
        if (isNaN(weight) || weight <= 0) {
            alert('Please enter a valid weight');
            return;
        }

        if (weight > selectedItem.availableWeight + 0.001) {
            alert(`Weight cannot exceed available weight (${selectedItem.availableWeight.toFixed(3)} kg)`);
            return;
        }

        setSubmitting(true);
        try {
            await api.createDispatch({
                customerId: dispatchForm.customerId,
                stage: selectedStage,
                stageItemId: selectedItem.id,
                weight,
                date: dispatchForm.date,
                notes: dispatchForm.notes || null,
            });

            setDispatchModalOpen(false);
            // Refresh available items
            const res = await api.getDispatchAvailable(selectedStage);
            setAvailableItems(res.items || []);
            await refreshDb();
            alert('Dispatch created successfully!');
        } catch (err) {
            alert(err.message || 'Failed to create dispatch');
        } finally {
            setSubmitting(false);
        }
    }

    async function handleDeleteDispatch(id) {
        if (!confirm('Are you sure you want to cancel this dispatch? The weight will be restored.')) return;

        try {
            await api.deleteDispatch(id);
            // Refresh dispatches
            const res = await api.listDispatches();
            setDispatches(res.dispatches || []);
            await refreshDb();
        } catch (err) {
            alert(err.message || 'Failed to delete dispatch');
        }
    }

    async function handleCreateCustomer() {
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
        } catch (err) {
            alert(err.message || 'Failed to create customer');
        } finally {
            setSavingCustomer(false);
        }
    }

    const getStageUnitLabel = (stage) => {
        if (stage === 'cutter') return 'Bobbins';
        if (stage === 'holo') return 'Rolls';
        if (stage === 'coning') return 'Cones';
        return 'Pieces';
    };

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
                </div>

                {/* Tab Toggle */}
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

            {activeTab === 'dispatch' ? (
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

                    {/* Search Bar */}
                    <div className="relative max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by barcode, lot no..."
                            className="pl-10"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>

                    {/* Available Items Table */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">
                                Available for Dispatch - {STAGES.find(s => s.id === selectedStage)?.label}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="rounded-md border overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Barcode</TableHead>
                                            {selectedStage !== 'inbound' && <TableHead>Piece/Lot</TableHead>}
                                            {selectedStage === 'inbound' && <TableHead>Lot No</TableHead>}
                                            <TableHead className="text-right">Total Weight</TableHead>
                                            <TableHead className="text-right">Dispatched</TableHead>
                                            <TableHead className="text-right">Available</TableHead>
                                            {selectedStage !== 'inbound' && (
                                                <TableHead className="text-right">{getStageUnitLabel(selectedStage)}</TableHead>
                                            )}
                                            <TableHead className="w-[100px]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {loadingItems ? (
                                            <TableRow>
                                                <TableCell colSpan={7} className="h-24 text-center">
                                                    Loading...
                                                </TableCell>
                                            </TableRow>
                                        ) : filteredItems.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                                    No items available for dispatch
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            filteredItems.map(item => (
                                                <TableRow key={item.id}>
                                                    <TableCell className="font-mono text-sm">{item.barcode || '—'}</TableCell>
                                                    <TableCell>{item.lotNo || item.pieceId || '—'}</TableCell>
                                                    <TableCell className="text-right">{formatKg(item.weight)}</TableCell>
                                                    <TableCell className="text-right text-muted-foreground">
                                                        {formatKg(item.dispatchedWeight)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                                                        {formatKg(item.availableWeight)}
                                                    </TableCell>
                                                    {selectedStage !== 'inbound' && (
                                                        <TableCell className="text-right">
                                                            {item.bobbinQuantity || item.rollCount || item.coneCount || '—'}
                                                        </TableCell>
                                                    )}
                                                    <TableCell>
                                                        <Button
                                                            size="sm"
                                                            onClick={() => openDispatchModal(item)}
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
                        </CardContent>
                    </Card>
                </>
            ) : (
                /* History Tab */
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Dispatch History</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Challan No</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Stage</TableHead>
                                        <TableHead>Barcode</TableHead>
                                        <TableHead className="text-right">Weight</TableHead>
                                        <TableHead className="w-[80px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loadingDispatches ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-24 text-center">
                                                Loading...
                                            </TableCell>
                                        </TableRow>
                                    ) : dispatches.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                                No dispatches found
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        dispatches.map(d => (
                                            <TableRow key={d.id}>
                                                <TableCell className="font-mono text-sm font-medium">{d.challanNo}</TableCell>
                                                <TableCell>{formatDateDDMMYYYY(d.date)}</TableCell>
                                                <TableCell>{d.customer?.name || '—'}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className="capitalize">
                                                        {d.stage}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="font-mono text-sm">{d.stageBarcode || '—'}</TableCell>
                                                <TableCell className="text-right font-medium">{formatKg(d.weight)}</TableCell>
                                                <TableCell>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                                        onClick={() => handleDeleteDispatch(d.id)}
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
            )}

            {/* Dispatch Modal */}
            <Dialog open={dispatchModalOpen} onOpenChange={setDispatchModalOpen}>
                <DialogContent title="Create Dispatch" onOpenChange={setDispatchModalOpen}>
                    <div className="space-y-4">
                        {selectedItem && (
                            <div className="bg-muted p-4 rounded-lg">
                                <div className="text-sm text-muted-foreground mb-1">Dispatching from {selectedStage}</div>
                                <div className="font-medium">{selectedItem.barcode || selectedItem.lotNo}</div>
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
                                >
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
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
                                disabled={submitting || !dispatchForm.customerId || !dispatchForm.weight}
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
                                disabled={savingCustomer || !newCustomerForm.name.trim()}
                            >
                                {savingCustomer ? 'Saving...' : 'Add Customer'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
