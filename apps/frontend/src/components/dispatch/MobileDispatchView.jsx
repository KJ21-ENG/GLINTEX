import React, { useState, useCallback } from 'react';
import { BarcodeScanner } from '../scanner/BarcodeScanner';
import {
    Button, Input, Select, Card, CardContent, Badge, Label
} from '../ui';
import { Dialog, DialogContent } from '../ui/Dialog';
import { formatKg, todayISO } from '../../utils';
import {
    Trash2, Package, ChevronRight, Keyboard, ScanLine, Plus,
    Loader2, AlertCircle, CheckCircle2
} from 'lucide-react';
import { cn } from '../../lib/utils';
import * as api from '../../api/client';

const STAGES = [
    { id: 'inbound', label: 'Inbound' },
    { id: 'cutter', label: 'Cutter' },
    { id: 'holo', label: 'Holo' },
    { id: 'coning', label: 'Coning' },
];

/**
 * Mobile-optimized dispatch view with barcode scanning
 * Split screen: camera on top, scanned items list on bottom
 */
export function MobileDispatchView({
    customers,
    onDispatchCreate,
    onDispatchBulkCreate,
    onAddCustomer,
    refreshAvailableItems
}) {
    const [selectedStage, setSelectedStage] = useState('inbound');
    const [scannedItems, setScannedItems] = useState([]);
    const [isManualMode, setIsManualMode] = useState(false);
    const [manualBarcode, setManualBarcode] = useState('');
    const [lookingUp, setLookingUp] = useState(null); // barcode currently being looked up

    // Dispatch modal state
    const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [bulkDispatchOpen, setBulkDispatchOpen] = useState(false);
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
        mode: 'weight',
    });
    const [submitting, setSubmitting] = useState(false);

    // New customer modal
    const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
    const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', address: '' });
    const [savingCustomer, setSavingCustomer] = useState(false);

    // Look up a barcode and add to scanned items
    const handleBarcodeScan = useCallback(async (barcode) => {
        // Check if already scanned
        if (scannedItems.some(item => item.barcode === barcode)) {
            return; // Already in list
        }

        // Add placeholder item
        const placeholderItem = {
            barcode,
            status: 'loading',
            id: `temp-${barcode}`,
        };
        setScannedItems(prev => [placeholderItem, ...prev]);
        setLookingUp(barcode);

        try {
            // Fetch available items for the stage
            const res = await api.getDispatchAvailable(selectedStage);
            const items = res.items || [];

            // Find matching item
            const matchedItem = items.find(item =>
                item.barcode === barcode ||
                item.lotNo === barcode ||
                item.pieceId === barcode
            );

            if (matchedItem) {
                // Update with found item
                setScannedItems(prev => prev.map(item =>
                    item.barcode === barcode
                        ? { ...matchedItem, barcode, status: 'found' }
                        : item
                ));
            } else {
                // Not found
                setScannedItems(prev => prev.map(item =>
                    item.barcode === barcode
                        ? { ...item, status: 'not_found', error: 'Not found in this stage' }
                        : item
                ));
            }
        } catch (err) {
            console.error('Lookup failed:', err);
            setScannedItems(prev => prev.map(item =>
                item.barcode === barcode
                    ? { ...item, status: 'error', error: err.message || 'Lookup failed' }
                    : item
            ));
        } finally {
            setLookingUp(null);
        }
    }, [scannedItems, selectedStage]);

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

    const openBulkDispatchModal = () => {
        const foundItems = scannedItems.filter(item => item.status === 'found');
        if (foundItems.length === 0) {
            alert('No valid items to dispatch');
            return;
        }
        const defaults = foundItems.map(item => {
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
    };

    // Open dispatch modal for an item
    const openDispatchModal = (item) => {
        if (item.status !== 'found') return;
        setSelectedItem(item);
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
    };

    // Create dispatch
    const handleCreateDispatch = async () => {
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
            await onDispatchCreate({
                customerId: dispatchForm.customerId,
                stage: selectedStage,
                stageItemId: selectedItem.id,
                weight,
                count: dispatchForm.mode === 'count' ? count : null,
                date: dispatchForm.date,
                notes: dispatchForm.notes || null,
            });

            // Remove dispatched item from list
            removeItem(selectedItem.barcode);
            setDispatchModalOpen(false);
        } catch (err) {
            alert(err.message || 'Failed to create dispatch');
        } finally {
            setSubmitting(false);
        }
    };

    const handleCreateBulkDispatch = async () => {
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
            await onDispatchBulkCreate({
                customerId: bulkForm.customerId,
                stage: selectedStage,
                date: bulkForm.date,
                notes: bulkForm.notes || null,
                items: payloadItems,
            });
            setScannedItems([]);
            setBulkDispatchOpen(false);
        } catch (err) {
            alert(err.message || 'Failed to create bulk dispatch');
        } finally {
            setSubmitting(false);
        }
    };

    // Create new customer
    const handleCreateCustomer = async () => {
        if (!newCustomerForm.name.trim()) {
            alert('Customer name is required');
            return;
        }

        setSavingCustomer(true);
        try {
            const newCustomer = await onAddCustomer({
                name: newCustomerForm.name.trim(),
                phone: newCustomerForm.phone.trim() || null,
                address: newCustomerForm.address.trim() || null,
            });

            setDispatchForm(prev => ({ ...prev, customerId: newCustomer.id }));
            setNewCustomerModalOpen(false);
            setNewCustomerForm({ name: '', phone: '', address: '' });
        } catch (err) {
            alert(err.message || 'Failed to create customer');
        } finally {
            setSavingCustomer(false);
        }
    };

    // Clear stage and reset items when stage changes
    const handleStageChange = (stage) => {
        setSelectedStage(stage);
        setScannedItems([]);
    };

    const foundItems = scannedItems.filter(item => item.status === 'found');

    const getStageUnitLabel = (stage) => {
        if (stage === 'cutter') return 'Bobbins';
        if (stage === 'holo') return 'Rolls';
        if (stage === 'coning') return 'Cones';
        return 'Pieces';
    };

    return (
        <div className="flex flex-col h-[calc(100vh-120px)] bg-background">
            {/* Stage selector */}
            <div className="flex gap-1 p-2 bg-muted/50 overflow-x-auto shrink-0">
                {STAGES.map(stage => (
                    <button
                        key={stage.id}
                        onClick={() => handleStageChange(stage.id)}
                        className={cn(
                            "px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all",
                            selectedStage === stage.id
                                ? "bg-primary text-primary-foreground shadow"
                                : "bg-background text-muted-foreground border"
                        )}
                    >
                        {stage.label}
                    </button>
                ))}
            </div>

            {/* Top half - Scanner or Manual Entry */}
            <div className="h-[45%] shrink-0 relative">
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
                                <Plus className="w-4 h-4 mr-2" />
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
                            Scanned Items ({foundItems.length})
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {foundItems.length > 0 && (
                            <Button size="sm" onClick={openBulkDispatchModal}>
                                Dispatch All
                            </Button>
                        )}
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
                                    item.status === 'found' && "border-green-500/50 bg-green-500/5",
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
                                    {(item.status === 'not_found' || item.status === 'error') && (
                                        <AlertCircle className="w-5 h-5 text-yellow-500" />
                                    )}
                                </div>

                                {/* Item info */}
                                <div className="flex-1 min-w-0">
                                    <p className="font-mono text-sm font-medium truncate">
                                        {item.barcode}
                                    </p>
                                    {item.status === 'found' && (
                                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <span>{item.lotLabel || item.lotNo || ''}</span>
                                            <Badge variant="outline" className="text-green-600 border-green-600">
                                                {formatKg(item.availableWeight)} avail
                                            </Badge>
                                        </div>
                                    )}
                                    {item.status === 'not_found' && (
                                        <p className="text-xs text-yellow-600">Not found in {selectedStage}</p>
                                    )}
                                    {item.status === 'error' && (
                                        <p className="text-xs text-red-600">{item.error}</p>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-1 shrink-0">
                                    {item.status === 'found' && (
                                        <Button
                                            size="sm"
                                            onClick={() => openDispatchModal(item)}
                                        >
                                            <ChevronRight className="w-4 h-4" />
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => removeItem(item.barcode)}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Dispatch Modal */}
            <Dialog open={dispatchModalOpen} onOpenChange={setDispatchModalOpen}>
                <DialogContent title="Create Dispatch" onOpenChange={setDispatchModalOpen}>
                    <div className="space-y-4">
                        {selectedItem && (
                            <div className="bg-muted p-3 rounded-lg">
                                <div className="font-mono text-sm">{selectedItem.barcode}</div>
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
                                >
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            {/* Dispatch Mode Toggle - Full Width */}
                            {selectedItem?.availableCount > 0 && (
                                <div className="col-span-2 flex gap-4 border p-2 rounded-md bg-muted/20">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            id="mob-mode-weight"
                                            name="mobDispatchMode"
                                            checked={dispatchForm.mode === 'weight'}
                                            onChange={() => setDispatchForm(prev => ({ ...prev, mode: 'weight', count: '' }))}
                                            className="w-4 h-4"
                                        />
                                        <label htmlFor="mob-mode-weight" className="text-sm font-medium">By Weight</label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="radio"
                                            id="mob-mode-count"
                                            name="mobDispatchMode"
                                            checked={dispatchForm.mode === 'count'}
                                            onChange={() => setDispatchForm(prev => ({ ...prev, mode: 'count' }))}
                                            className="w-4 h-4"
                                        />
                                        <label htmlFor="mob-mode-count" className="text-sm font-medium">By Count</label>
                                    </div>
                                </div>
                            )}

                            {dispatchForm.mode === 'count' && (
                                <div className="col-span-2">
                                    <Label>Count ({getStageUnitLabel(selectedStage)}) *</Label>
                                    <Input
                                        type="number"
                                        step="1"
                                        value={dispatchForm.count}
                                        onChange={e => {
                                            const val = e.target.value;
                                            const intVal = parseInt(val) || 0;
                                            const avgWeight = selectedItem.avgWeightPerPiece || 0;
                                            const fullMatch = intVal === (selectedItem?.availableCount || 0) && selectedItem?.availableWeight;
                                            const estimatedWeight = fullMatch
                                                ? Number(selectedItem.availableWeight).toFixed(3)
                                                : (avgWeight > 0 ? (intVal * avgWeight).toFixed(3) : '');
                                            setDispatchForm(prev => ({ ...prev, count: val, weight: estimatedWeight }));
                                        }}
                                        max={selectedItem?.availableCount}
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">Available: {selectedItem?.availableCount}</p>
                                </div>
                            )}

                            <div>
                                <Label>Weight (kg) *</Label>
                                <Input
                                    type="number"
                                    step="0.001"
                                    value={dispatchForm.weight}
                                    onChange={e => setDispatchForm(prev => ({ ...prev, weight: e.target.value }))}
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
                            <Label>Notes</Label>
                            <Input
                                value={dispatchForm.notes}
                                onChange={e => setDispatchForm(prev => ({ ...prev, notes: e.target.value }))}
                                placeholder="Optional notes..."
                            />
                        </div>

                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" className="flex-1" onClick={() => setDispatchModalOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                className="flex-1"
                                onClick={handleCreateDispatch}
                                disabled={submitting || !dispatchForm.customerId || !dispatchForm.weight}
                            >
                                {submitting ? 'Creating...' : 'Create Dispatch'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Bulk Dispatch Modal */}
            <Dialog open={bulkDispatchOpen} onOpenChange={setBulkDispatchOpen}>
                <DialogContent title="Dispatch Scanned Items" onOpenChange={setBulkDispatchOpen} className="max-h-[85vh] overflow-hidden">
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
                                >
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Label>Date</Label>
                                <Input
                                    type="date"
                                    value={bulkForm.date}
                                    onChange={e => setBulkForm(prev => ({ ...prev, date: e.target.value }))}
                                />
                            </div>
                            <div>
                                <Label>Notes</Label>
                                <Input
                                    value={bulkForm.notes}
                                    onChange={e => setBulkForm(prev => ({ ...prev, notes: e.target.value }))}
                                    placeholder="Optional notes..."
                                />
                            </div>
                        </div>

                        <div className="space-y-2 max-h-[45vh] overflow-y-auto border rounded-md p-2">
                            {bulkItems.map(item => (
                                <div key={item.stageItemId} className="border rounded-md p-2 bg-card space-y-2">
                                    <div className="text-xs font-mono">{item.barcode || '—'}</div>
                                    <div className="text-xs text-muted-foreground">{item.label}</div>
                                    {selectedStage !== 'inbound' && (
                                        <div>
                                            <Label className="text-xs">Count</Label>
                                            <Input
                                                type="number"
                                                step="1"
                                                value={item.count}
                                                onChange={e => {
                                                    const nextCount = e.target.value;
                                                    const intVal = parseInt(nextCount) || 0;
                                                    const avgWeight = item.avgWeightPerPiece || 0;
                                                    const fullMatch = intVal === (item.availableCount || 0) && item.availableWeight;
                                                    const nextWeight = fullMatch
                                                        ? Number(item.availableWeight).toFixed(3)
                                                        : (avgWeight > 0 ? (intVal * avgWeight).toFixed(3) : item.weight);
                                                    setBulkItems(prev => prev.map(i => (
                                                        i.stageItemId === item.stageItemId
                                                            ? { ...i, count: nextCount, weight: nextWeight }
                                                            : i
                                                    )));
                                                }}
                                                max={item.availableCount}
                                            />
                                        </div>
                                    )}
                                    <div>
                                        <Label className="text-xs">Weight (kg)</Label>
                                        <Input
                                            type="number"
                                            step="0.001"
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
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" className="flex-1" onClick={() => setBulkDispatchOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                className="flex-1"
                                onClick={handleCreateBulkDispatch}
                                disabled={submitting || !bulkForm.customerId}
                            >
                                {submitting ? 'Creating...' : 'Create Dispatch'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* New Customer Modal */}
            <Dialog open={newCustomerModalOpen} onOpenChange={setNewCustomerModalOpen}>
                <DialogContent title="Add Customer" onOpenChange={setNewCustomerModalOpen}>
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
                                placeholder="Optional"
                            />
                        </div>
                        <div>
                            <Label>Address</Label>
                            <Input
                                value={newCustomerForm.address}
                                onChange={e => setNewCustomerForm(prev => ({ ...prev, address: e.target.value }))}
                                placeholder="Optional"
                            />
                        </div>
                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" className="flex-1" onClick={() => setNewCustomerModalOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                className="flex-1"
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

export default MobileDispatchView;
