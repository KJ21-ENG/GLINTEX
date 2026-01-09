import React, { useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { IssueToCutter } from '../components/issue';
import { IssueToHolo } from '../components/issue';
import { IssueToConing } from '../components/issue';
import { OnMachineTable } from '../components/issue';
import { IssueHistory } from './IssueHistory';
import { Card, CardHeader, CardTitle, CardContent, Button } from '../components/ui';
import { sendSummaryWhatsApp } from '../api/client';
import { Send } from 'lucide-react';

export function IssueToMachine() {
  const { process, db, refreshDb } = useInventory();
  const [activeTab, setActiveTab] = useState('on-machine');
  const [sendingSum, setSendingSum] = useState(false);
  const [sumMessage, setSumMessage] = useState(null);

  const handleSendSummary = async () => {
    if (sendingSum) return;
    setSendingSum(true);
    setSumMessage(null);
    try {
      const stage = process === 'holo' ? 'holo' : process === 'coning' ? 'coning' : 'cutter';
      const result = await sendSummaryWhatsApp(stage, 'issue');
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
        <h1 className="text-2xl font-bold tracking-tight">Issue to Machine</h1>
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

      {/* Process Specific Form */}
      {process === 'holo' ? (
        <IssueToHolo />
      ) : process === 'coning' ? (
        <IssueToConing />
      ) : (
        <IssueToCutter />
      )}

      {/* Issue History / On Machine Section */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <CardTitle>Issue Tracking</CardTitle>
            <div className="flex gap-1 bg-muted p-1 rounded-lg w-full sm:w-auto">
              <button
                onClick={() => setActiveTab('on-machine')}
                className={`flex-1 sm:flex-none px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'on-machine'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                On Machine
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex-1 sm:flex-none px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'history'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                History
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {activeTab === 'on-machine' ? (
            <OnMachineTable db={db} process={process} />
          ) : (
            <IssueHistory db={db} refreshDb={refreshDb} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}