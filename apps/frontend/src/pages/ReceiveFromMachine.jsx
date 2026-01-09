import React, { useEffect, useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { ManualReceiveForm, HoloReceiveForm, ConingReceiveForm, CutterReceiveForm, CutterCsvUpload, ReceiveHistoryTable } from '../components/receive';
import { Button } from '../components/ui';
import { sendSummaryWhatsApp } from '../api/client';
import { Send } from 'lucide-react';

export function ReceiveFromMachine() {
  const { process } = useInventory();
  const [cutterMode, setCutterMode] = useState('scan');
  const [sendingSum, setSendingSum] = useState(false);
  const [sumMessage, setSumMessage] = useState(null);

  useEffect(() => {
    if (process !== 'cutter') {
      setCutterMode('scan');
    }
  }, [process]);

  const handleSendSummary = async () => {
    if (sendingSum) return;
    setSendingSum(true);
    setSumMessage(null);
    try {
      const stage = process === 'holo' ? 'holo' : process === 'coning' ? 'coning' : 'cutter';
      const result = await sendSummaryWhatsApp(stage, 'receive');
      if (result.ok) {
        setSumMessage({ type: 'success', text: 'Summary sent successfully!' });
      } else {
        setSumMessage({ type: 'error', text: result.message || 'Failed to send summary' });
      }
    } catch (err) {
      setSumMessage({ type: 'error', text: err.message || 'Failed to send summary' });
    } finally {
      setSendingSum(false);
      setTimeout(() => setSumMessage(null), 5000);
    }
  };

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Receive from Machine</h1>
        <div className="flex items-center gap-2">
          {sumMessage && (
            <span className={`text-sm ${sumMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {sumMessage.text}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendSummary}
            disabled={sendingSum}
            className="flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            {sendingSum ? 'Sending...' : 'Send Summary'}
          </Button>
        </div>
      </div>

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
