import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent } from '../ui/Dialog';
import { Button, Select } from '../ui';
import { Flame, Loader2 } from 'lucide-react';
import * as api from '../../api/client';

/**
 * Dialog to choose a configured boiler machine before marking items as steamed.
 * The boiler number is auto-assigned server-side; the dialog shows a read-only preview.
 * Props:
 *   open        - boolean controlling dialog visibility
 *   onOpenChange - callback to close the dialog
 *   onConfirm   - callback(boilerMachineId: string, boilerMachine: object) when user confirms
 *   submitting   - boolean to show loading state on confirm button
 *   itemCount    - number of items being steamed (for display)
 *   boilerMachines - master Machine rows with processType === 'boiler'
 */
export function BoilerMachineDialog({ open, onOpenChange, onConfirm, submitting, itemCount, boilerMachines = [] }) {
    const [selectedId, setSelectedId] = useState('');
    const [previewNumber, setPreviewNumber] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [error, setError] = useState('');
    const options = useMemo(
        () => (boilerMachines || []).map(machine => ({ value: machine.id, label: machine.name })),
        [boilerMachines]
    );

    useEffect(() => {
        if (open) {
            setSelectedId('');
            setPreviewNumber(null);
            setError('');
        }
    }, [open]);

    useEffect(() => {
        if (!selectedId) {
            setPreviewNumber(null);
            return;
        }
        let stale = false;
        setPreviewLoading(true);
        setPreviewNumber(null);
        api.boilerSequenceNext(selectedId)
            .then(res => {
                if (!stale) setPreviewNumber(res?.next ?? null);
            })
            .catch(() => {
                if (!stale) setPreviewNumber(null);
            })
            .finally(() => {
                if (!stale) setPreviewLoading(false);
            });
        return () => { stale = true; };
    }, [selectedId]);

    const handleConfirm = () => {
        if (boilerMachines.length === 0) {
            setError('Add Boiler machines in Masters > Machines first');
            return;
        }
        const selectedMachine = boilerMachines.find(machine => String(machine.id) === String(selectedId));
        if (!selectedMachine) {
            setError('Please select a boiler');
            return;
        }
        setError('');
        onConfirm(selectedMachine.id, selectedMachine);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent title="Select Boiler" onOpenChange={onOpenChange}>
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Select the boiler for {itemCount || 0} item{itemCount !== 1 ? 's' : ''} being steamed.
                    </p>
                    <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Boiler</p>
                        <Select
                            value={selectedId}
                            onChange={e => {
                                setSelectedId(e.target.value);
                                if (error) setError('');
                            }}
                            options={options}
                            placeholder="Select Boiler"
                            emptyMessage="No Boiler machines found"
                            cacheKey="boiler-machine-dialog"
                            disabled={submitting || boilerMachines.length === 0}
                        />
                        <p className="text-xs font-medium text-muted-foreground uppercase">Boiler No (auto-assigned on save)</p>
                        <div className="flex items-center justify-center h-10 rounded-md border bg-muted/50 text-lg font-semibold">
                            {previewLoading ? (
                                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            ) : previewNumber != null ? (
                                previewNumber
                            ) : (
                                <span className="text-sm font-normal text-muted-foreground">Select a boiler</span>
                            )}
                        </div>
                        {error && (
                            <p className="text-xs text-destructive">{error}</p>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleConfirm}
                            disabled={submitting || !selectedId || boilerMachines.length === 0}
                            className="bg-orange-500 hover:bg-orange-600"
                        >
                            {submitting ? (
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                                <Flame className="w-4 h-4 mr-2" />
                            )}
                            {submitting ? 'Processing...' : 'Confirm & Steam'}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export default BoilerMachineDialog;
