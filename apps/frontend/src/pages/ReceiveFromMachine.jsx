import React, { useEffect, useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { ManualReceiveForm, HoloReceiveForm, ConingReceiveForm, CutterReceiveForm, CutterCsvUpload, ReceiveHistoryTable } from '../components/receive';
import { Button } from '../components/ui';

export function ReceiveFromMachine() {
  const { process } = useInventory();
  const [cutterMode, setCutterMode] = useState('scan');

  useEffect(() => {
    if (process !== 'cutter') {
      setCutterMode('scan');
    }
  }, [process]);

  return (
    <div className="space-y-6 fade-in">
      <h1 className="text-2xl font-bold tracking-tight">Receive from Machine</h1>

      {process === 'holo' ? (
        <HoloReceiveForm />
      ) : process === 'coning' ? (
        <ConingReceiveForm />
      ) : process === 'cutter' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant={cutterMode === 'scan' ? 'default' : 'outline'} onClick={() => setCutterMode('scan')} className="flex-1 sm:flex-none">
              Manual / Barcode
            </Button>
            <Button variant={cutterMode === 'csv' ? 'default' : 'outline'} onClick={() => setCutterMode('csv')} className="flex-1 sm:flex-none">
              CSV Upload
            </Button>
          </div>
          {cutterMode === 'csv' ? <CutterCsvUpload /> : <CutterReceiveForm />}
        </div>
      ) : (
        <ManualReceiveForm />
      )}

      <ReceiveHistoryTable />
    </div>
  );
}
