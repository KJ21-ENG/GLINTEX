import React, { useState, useEffect, useRef, useCallback } from 'react';
import { boxTransferLookup, boxTransferExecute, boxTransferHistory, boxTransferReverse } from '../api/client';
import { Button, Input, Card } from '../components/ui';
import { ArrowRightLeft, Search, RotateCcw, Package, ArrowDown, Loader2, CheckCircle2, XCircle, History } from 'lucide-react';
import { cn } from '../lib/utils';

export function BoxTransfer() {

    // Transfer form state
    const [fromBarcode, setFromBarcode] = useState('');
    const [toBarcode, setToBarcode] = useState('');
    const [fromItem, setFromItem] = useState(null);
    const [toItem, setToItem] = useState(null);
    const [pieceCount, setPieceCount] = useState('');
    const [notes, setNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [lookingUp, setLookingUp] = useState({ from: false, to: false });
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    // History state
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [stageFilter, setStageFilter] = useState('all');

    // Refs for auto-focus
    const fromInputRef = useRef(null);
    const toInputRef = useRef(null);

    // Load history on mount
    useEffect(() => {
        loadHistory();
    }, [stageFilter]);

    const loadHistory = async () => {
        setHistoryLoading(true);
        try {
            const params = {};
            if (stageFilter && stageFilter !== 'all') params.stage = stageFilter;
            if (searchTerm) params.search = searchTerm;
            const res = await boxTransferHistory(params);
            setHistory(res.transfers || []);
        } catch (err) {
            console.error('Failed to load history', err);
        } finally {
            setHistoryLoading(false);
        }
    };

    const lookupBarcode = useCallback(async (barcode, type) => {
        if (!barcode.trim()) {
            if (type === 'from') setFromItem(null);
            else setToItem(null);
            return;
        }

        setLookingUp(prev => ({ ...prev, [type]: true }));
        try {
            const res = await boxTransferLookup(barcode.trim());
            if (type === 'from') {
                setFromItem(res.found ? res : null);
                if (res.found && toInputRef.current) {
                    setTimeout(() => toInputRef.current?.focus(), 100);
                }
            } else {
                setToItem(res.found ? res : null);
            }
            if (!res.found) {
                setError(`Barcode not found: ${barcode}`);
                setTimeout(() => setError(''), 3000);
            }
        } catch (err) {
            console.error('Lookup failed', err);
            setError('Lookup failed');
            setTimeout(() => setError(''), 3000);
        } finally {
            setLookingUp(prev => ({ ...prev, [type]: false }));
        }
    }, []);

    const handleFromBarcodeKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            lookupBarcode(fromBarcode, 'from');
        }
    };

    const handleToBarcodeKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            lookupBarcode(toBarcode, 'to');
        }
    };

    const handleTransfer = async () => {
        setError('');
        setSuccess('');

        if (!fromItem || !toItem) {
            setError('Please scan both From and To barcodes');
            return;
        }

        if (fromItem.barcode === toItem.barcode) {
            setError('Cannot transfer to the same barcode');
            return;
        }

        const count = parseInt(pieceCount, 10);
        if (!count || count <= 0) {
            setError('Please enter a valid piece count');
            return;
        }

        if (count > fromItem.currentCount) {
            setError(`Cannot transfer ${count} pieces. Only ${fromItem.currentCount} available.`);
            return;
        }

        if (fromItem.stage !== toItem.stage) {
            setError(`Cannot transfer between different processes (${fromItem.stage} → ${toItem.stage})`);
            return;
        }

        setLoading(true);
        try {
            await boxTransferExecute({
                fromBarcode: fromItem.barcode,
                toBarcode: toItem.barcode,
                pieceCount: count,
                notes: notes.trim() || null,
            });
            setSuccess(`Successfully transferred ${count} pieces (${calculateWeight()} kg)`);

            // Reset form
            setFromBarcode('');
            setToBarcode('');
            setFromItem(null);
            setToItem(null);
            setPieceCount('');
            setNotes('');

            // Reload history
            loadHistory();

            // Auto-clear success message
            setTimeout(() => setSuccess(''), 5000);

            // Focus back to from input
            fromInputRef.current?.focus();
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Transfer failed');
        } finally {
            setLoading(false);
        }
    };

    const handleReverse = async (transferId) => {
        if (!confirm('Are you sure you want to reverse this transfer?')) return;

        try {
            await boxTransferReverse(transferId);
            setSuccess('Transfer reversed successfully');
            loadHistory();
            setTimeout(() => setSuccess(''), 3000);
        } catch (err) {
            setError(err.message || 'Failed to reverse transfer');
            setTimeout(() => setError(''), 3000);
        }
    };

    const calculateWeight = () => {
        if (!fromItem || !pieceCount) return '0.000';
        const count = parseInt(pieceCount, 10) || 0;
        if (count <= 0 || fromItem.currentCount <= 0) return '0.000';
        const weightPerPiece = fromItem.currentWeight / fromItem.currentCount;
        return (count * weightPerPiece).toFixed(3);
    };

    const getStageBadgeColor = (stage) => {
        switch (stage) {
            case 'holo': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
            case 'coning': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
            case 'cutter': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
            default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
        }
    };

    const getStageLabel = (stage) => {
        switch (stage) {
            case 'holo': return 'Holo';
            case 'coning': return 'Coning';
            case 'cutter': return 'Cutter';
            default: return stage;
        }
    };

    const getUnitLabel = (stage) => {
        switch (stage) {
            case 'holo': return 'Rolls';
            case 'coning': return 'Cones';
            case 'cutter': return 'Bobbins';
            default: return 'Pieces';
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <ArrowRightLeft className="h-6 w-6" />
                        Box Transfer
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Transfer pieces between boxes within the same process
                    </p>
                </div>
            </div>

            {/* Alerts */}
            {error && (
                <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg p-3 flex items-center gap-2">
                    <XCircle className="h-4 w-4 shrink-0" />
                    <span className="text-sm">{error}</span>
                </div>
            )}
            {success && (
                <div className="bg-green-500/10 border border-green-500/30 text-green-600 dark:text-green-400 rounded-lg p-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="text-sm">{success}</span>
                </div>
            )}

            {/* Transfer Form */}
            <div className="grid gap-6 md:grid-cols-2">
                {/* From Section */}
                <Card className="p-4 space-y-4">
                    <div className="flex items-center gap-2 text-lg font-semibold">
                        <Package className="h-5 w-5 text-red-500" />
                        <span>From (Source)</span>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Scan Barcode</label>
                        <div className="flex gap-2">
                            <Input
                                ref={fromInputRef}
                                value={fromBarcode}
                                onChange={(e) => setFromBarcode(e.target.value.toUpperCase())}
                                onKeyDown={handleFromBarcodeKeyDown}
                                placeholder="Scan or enter barcode..."
                                className="font-mono"
                                autoFocus
                            />
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => lookupBarcode(fromBarcode, 'from')}
                                disabled={lookingUp.from}
                            >
                                {lookingUp.from ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>

                    {fromItem && (
                        <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Process</span>
                                <span className={cn('px-2 py-0.5 rounded text-xs font-medium', getStageBadgeColor(fromItem.stage))}>
                                    {getStageLabel(fromItem.stage)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Barcode</span>
                                <span className="font-mono">{fromItem.barcode}</span>
                            </div>
                            {fromItem.lotNo && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Lot No</span>
                                    <span>{fromItem.lotNo}</span>
                                </div>
                            )}
                            {fromItem.boxName && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Box</span>
                                    <span>{fromItem.boxName}</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between font-medium">
                                <span className="text-muted-foreground">Available {getUnitLabel(fromItem.stage)}</span>
                                <span className="text-lg">{fromItem.currentCount}</span>
                            </div>
                            <div className="flex items-center justify-between font-medium">
                                <span className="text-muted-foreground">Weight</span>
                                <span>{(fromItem.currentWeight ?? 0).toFixed(3)} kg</span>
                            </div>
                        </div>
                    )}
                </Card>

                {/* To Section */}
                <Card className="p-4 space-y-4">
                    <div className="flex items-center gap-2 text-lg font-semibold">
                        <Package className="h-5 w-5 text-green-500" />
                        <span>To (Destination)</span>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium">Scan Barcode</label>
                        <div className="flex gap-2">
                            <Input
                                ref={toInputRef}
                                value={toBarcode}
                                onChange={(e) => setToBarcode(e.target.value.toUpperCase())}
                                onKeyDown={handleToBarcodeKeyDown}
                                placeholder="Scan or enter barcode..."
                                className="font-mono"
                            />
                            <Button
                                variant="outline"
                                size="icon"
                                onClick={() => lookupBarcode(toBarcode, 'to')}
                                disabled={lookingUp.to}
                            >
                                {lookingUp.to ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>

                    {toItem && (
                        <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Process</span>
                                <span className={cn('px-2 py-0.5 rounded text-xs font-medium', getStageBadgeColor(toItem.stage))}>
                                    {getStageLabel(toItem.stage)}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Barcode</span>
                                <span className="font-mono">{toItem.barcode}</span>
                            </div>
                            {toItem.lotNo && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Lot No</span>
                                    <span>{toItem.lotNo}</span>
                                </div>
                            )}
                            {toItem.boxName && (
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Box</span>
                                    <span>{toItem.boxName}</span>
                                </div>
                            )}
                            <div className="flex items-center justify-between font-medium">
                                <span className="text-muted-foreground">Current {getUnitLabel(toItem.stage)}</span>
                                <span className="text-lg">{toItem.currentCount}</span>
                            </div>
                            <div className="flex items-center justify-between font-medium">
                                <span className="text-muted-foreground">Weight</span>
                                <span>{(toItem.currentWeight ?? 0).toFixed(3)} kg</span>
                            </div>
                        </div>
                    )}
                </Card>
            </div>

            {/* Transfer Details */}
            {fromItem && toItem && (
                <Card className="p-4 space-y-4">
                    <div className="flex items-center gap-2 text-lg font-semibold">
                        <ArrowDown className="h-5 w-5" />
                        <span>Transfer Details</span>
                    </div>

                    {fromItem.stage !== toItem.stage && (
                        <div className="bg-destructive/10 border border-destructive/30 text-destructive rounded-lg p-3 text-sm">
                            Cannot transfer between different processes ({getStageLabel(fromItem.stage)} → {getStageLabel(toItem.stage)})
                        </div>
                    )}

                    {fromItem.stage === toItem.stage && (
                        <div className="grid gap-4 sm:grid-cols-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">
                                    {getUnitLabel(fromItem.stage)} to Transfer
                                </label>
                                <Input
                                    type="number"
                                    value={pieceCount}
                                    onChange={(e) => setPieceCount(e.target.value)}
                                    min="1"
                                    max={fromItem.currentCount}
                                    placeholder={`Max: ${fromItem.currentCount}`}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Weight to Transfer</label>
                                <div className="h-9 px-3 flex items-center bg-muted rounded-md font-mono text-lg">
                                    {calculateWeight()} kg
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Notes (Optional)</label>
                                <Input
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Add notes..."
                                />
                            </div>
                        </div>
                    )}

                    <Button
                        onClick={handleTransfer}
                        disabled={loading || !fromItem || !toItem || fromItem.stage !== toItem.stage || !pieceCount}
                        className="w-full sm:w-auto"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                <ArrowRightLeft className="h-4 w-4 mr-2" />
                                Transfer {pieceCount || 0} {fromItem ? getUnitLabel(fromItem.stage) : 'Pieces'}
                            </>
                        )}
                    </Button>
                </Card>
            )}

            {/* History Section */}
            <Card className="p-4 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-2 text-lg font-semibold">
                        <History className="h-5 w-5" />
                        <span>Transfer History</span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <Input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && loadHistory()}
                            placeholder="Search barcodes..."
                            className="w-48"
                        />
                        <select
                            value={stageFilter}
                            onChange={(e) => setStageFilter(e.target.value)}
                            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
                        >
                            <option value="all">All Processes</option>
                            <option value="holo">Holo</option>
                            <option value="coning">Coning</option>
                            <option value="cutter">Cutter</option>
                        </select>
                        <Button variant="outline" size="icon" onClick={loadHistory} disabled={historyLoading}>
                            {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </Button>
                    </div>
                </div>

                {history.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                        No transfer history found
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2 px-2 font-medium">Date</th>
                                    <th className="text-left py-2 px-2 font-medium">Process</th>
                                    <th className="text-left py-2 px-2 font-medium">From</th>
                                    <th className="text-left py-2 px-2 font-medium">To</th>
                                    <th className="text-right py-2 px-2 font-medium">Pieces</th>
                                    <th className="text-right py-2 px-2 font-medium">Weight</th>
                                    <th className="text-left py-2 px-2 font-medium">Status</th>
                                    <th className="text-center py-2 px-2 font-medium">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((transfer) => (
                                    <tr key={transfer.id} className="border-b hover:bg-muted/50">
                                        <td className="py-2 px-2">{transfer.date}</td>
                                        <td className="py-2 px-2">
                                            <span className={cn('px-2 py-0.5 rounded text-xs font-medium', getStageBadgeColor(transfer.stage))}>
                                                {getStageLabel(transfer.stage)}
                                            </span>
                                        </td>
                                        <td className="py-2 px-2 font-mono text-xs">{transfer.fromBarcode}</td>
                                        <td className="py-2 px-2 font-mono text-xs">{transfer.toBarcode}</td>
                                        <td className="py-2 px-2 text-right">{transfer.pieceCount}</td>
                                        <td className="py-2 px-2 text-right">{(transfer.weightTransferred ?? 0).toFixed(3)} kg</td>
                                        <td className="py-2 px-2">
                                            {transfer.isReversed ? (
                                                <span className="text-xs text-muted-foreground">Reversed</span>
                                            ) : transfer.reversedById ? (
                                                <span className="text-xs text-orange-600 dark:text-orange-400">Reversal</span>
                                            ) : (
                                                <span className="text-xs text-green-600 dark:text-green-400">Active</span>
                                            )}
                                        </td>
                                        <td className="py-2 px-2 text-center">
                                            {!transfer.isReversed && !transfer.reversedById && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleReverse(transfer.id)}
                                                    title="Reverse transfer"
                                                >
                                                    <RotateCcw className="h-3 w-3" />
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}

export default BoxTransfer;
