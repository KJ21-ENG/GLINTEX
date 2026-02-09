import React, { useState, useRef, useEffect } from 'react';
import { useInventory } from '../context/InventoryContext';
import { IssueToCutter } from '../components/issue';
import { IssueToHolo } from '../components/issue';
import { IssueToConing } from '../components/issue';
import { OnMachineTable } from '../components/issue';
import { IssueHistory } from './IssueHistory';
import { Card, CardHeader, CardTitle, CardContent, Button } from '../components/ui';
import { sendSummaryWhatsApp } from '../api/client';
import { Send, Calendar } from 'lucide-react';
import { useStagePermission } from '../hooks/usePermission';
import AccessDenied from '../components/common/AccessDenied';

function getTodayISO() {
  return new Date().toISOString().split('T')[0];
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return 'Today';
  const today = getTodayISO();
  if (dateStr === today) return 'Today';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function IssueToMachine() {
  const { process, db, ensureModuleData } = useInventory();
  const stage = process === 'holo' ? 'holo' : process === 'coning' ? 'coning' : 'cutter';
  const { canRead, canWrite, canEdit, canDelete } = useStagePermission('issue', stage);
  const readOnly = canRead && !canWrite;
  const [activeTab, setActiveTab] = useState('on-machine');
  const [sendingSum, setSendingSum] = useState(false);
  const [sumMessage, setSumMessage] = useState(null);
  const [summaryDate, setSummaryDate] = useState(getTodayISO());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerPosition, setPickerPosition] = useState({ x: 0, y: 0 });
  const pickerRef = useRef(null);

  useEffect(() => {
    if (canRead) {
      ensureModuleData('process', { process: stage });
    }
  }, [canRead, ensureModuleData, stage]);

  // Close date picker on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowDatePicker(false);
      }
    }
    if (showDatePicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDatePicker]);

  const handleSendSummary = async () => {
    if (sendingSum) return;
    setSendingSum(true);
    setSumMessage(null);
    try {
      const stage = process === 'holo' ? 'holo' : process === 'coning' ? 'coning' : 'cutter';
      const result = await sendSummaryWhatsApp(stage, 'issue', summaryDate);
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

  const handleRightClick = (e) => {
    e.preventDefault();
    setPickerPosition({ x: e.clientX, y: e.clientY });
    setShowDatePicker(true);
  };

  const handleDateChange = (e) => {
    setSummaryDate(e.target.value);
    setShowDatePicker(false);
  };

  if (!canRead) {
    return (
      <div className="space-y-6 fade-in">
        <h1 className="text-2xl font-bold tracking-tight">Issue to Machine</h1>
        <AccessDenied message="You do not have access to this stage. Select another stage or contact an administrator." />
      </div>
    );
  }

  return (
    <div className="space-y-6 fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Issue to Machine</h1>
        <div className="flex flex-wrap items-center gap-2">
          {sumMessage && (
            <span className={`text-sm ${sumMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {sumMessage.text}
            </span>
          )}
          {summaryDate !== getTodayISO() && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDateDisplay(summaryDate)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSendSummary}
            onContextMenu={handleRightClick}
            disabled={sendingSum || readOnly}
            className="flex items-center gap-2"
            title="Left-click to send, Right-click to change date"
          >
            <Send className="h-4 w-4" />
            {sendingSum ? 'Sending...' : 'Send Summary'}
          </Button>
        </div>
      </div>

      {/* Date Picker Popup */}
      {showDatePicker && (
        <div
          ref={pickerRef}
          className="fixed z-50 bg-background border rounded-lg shadow-lg p-3"
          style={{
            left: Math.min(pickerPosition.x, window.innerWidth - 220),
            top: Math.min(pickerPosition.y, window.innerHeight - 100),
          }}
        >
          <label className="block text-sm font-medium mb-2">Summary Date</label>
          <input
            type="date"
            value={summaryDate}
            onChange={handleDateChange}
            max={getTodayISO()}
            className="w-full px-3 py-2 border rounded-md text-sm"
            autoFocus
          />
          <p className="text-xs text-muted-foreground mt-2">
            Select date for summary PDF
          </p>
        </div>
      )}

      {/* Process Specific Form */}
      {readOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>Read-only access</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            You can view issue data, but you cannot create or edit issues for this stage.
          </CardContent>
        </Card>
      ) : (
        <>
          {process === 'holo' ? (
            <IssueToHolo />
          ) : process === 'coning' ? (
            <IssueToConing />
          ) : (
            <IssueToCutter />
          )}
        </>
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
            <IssueHistory db={db} canEdit={canEdit} canDelete={canDelete} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
