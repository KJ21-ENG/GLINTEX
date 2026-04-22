import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent } from '../ui/Dialog';
import { Button, Input, Select } from '../ui';
import { Flame, Loader2 } from 'lucide-react';

/**
 * Dialog to choose a configured boiler machine before marking items as steamed.
 * Props:
 *   open        - boolean controlling dialog visibility
 *   onOpenChange - callback to close the dialog
 *   onConfirm   - callback(boilerMachineId: string, boilerNumber: number, boilerMachine: object) when user confirms
 *   submitting   - boolean to show loading state on confirm button
 *   itemCount    - number of items being steamed (for display)
 *   boilerMachines - master Machine rows with processType === 'boiler'
 */
export function BoilerMachineDialog({ open, onOpenChange, onConfirm, submitting, itemCount, boilerMachines = [] }) {
    const [selectedId, setSelectedId] = useState('');
    const [boilerNumber, setBoilerNumber] = useState('');
    const [error, setError] = useState('');
    const options = useMemo(
        () => (boilerMachines || []).map(machine => ({ value: machine.id, label: machine.name })),
        [boilerMachines]
    );

    useEffect(() => {
        if (open) {
            setSelectedId('');
            setBoilerNumber('');
            setError('');
        }
    }, [open]);

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
        const parsedBoilerNumber = Number(boilerNumber);
        if (!boilerNumber.trim() || !Number.isInteger(parsedBoilerNumber) || parsedBoilerNumber < 1) {
            setError('Please enter a valid boiler no');
            return;
        }
        setError('');
        onConfirm(selectedMachine.id, parsedBoilerNumber, selectedMachine);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent title="Select Boiler" onOpenChange={onOpenChange}>
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Select the boiler and enter the boiler no for {itemCount || 0} item{itemCount !== 1 ? 's' : ''} being steamed.
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
                        <p className="text-xs font-medium text-muted-foreground uppercase">Boiler No</p>
                        <Input
                            type="number"
                            min="1"
                            step="1"
                            placeholder="Enter boiler no"
                            value={boilerNumber}
                            onChange={e => {
                                setBoilerNumber(e.target.value);
                                if (error) setError('');
                            }}
                            className="text-center text-lg font-semibold"
                            disabled={submitting}
                        />
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
                            disabled={submitting || !selectedId || !boilerNumber.trim() || boilerMachines.length === 0}
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
