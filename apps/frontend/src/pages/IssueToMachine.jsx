import React, { useState, useRef } from 'react';
import { useInventory } from '../context/InventoryContext';
import { IssueToCutter } from '../components/issue';
import { IssueToHolo } from '../components/issue';
import { IssueToConing } from '../components/issue';
import { OnMachineTable } from '../components/issue';
import { IssueHistory } from './IssueHistory';
import { Card, CardHeader, CardTitle, CardContent, Button } from '../components/ui';
import { sendSummaryNotification, downloadSummaryPdf } from '../api/client';
import { Send, Calendar, Download } from 'lucide-react';
import { Dialog, DialogContent } from '../components/ui/Dialog';
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
  const { process, db } = useInventory();
  const stage = process === 'holo' ? 'holo' : process === 'coning' ? 'coning' : 'cutter';
  const { canRead, canWrite, canEdit, canDelete } = useStagePermission('issue', stage);
  const readOnly = canRead && !canWrite;
  const [activeTab, setActiveTab] = useState('on-machine');
  const [sendingSum, setSendingSum] = useState(false);
  const [downloadingSum, setDownloadingSum] = useState(false);
  const [summaryActionOpen, setSummaryActionOpen] = useState(false);
  const [sumMessage, setSumMessage] = useState(null);
  
  const getYesterdayISO = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  };
  const [summaryDateFrom, setSummaryDateFrom] = useState(getYesterdayISO);
  const [summaryDateTo, setSummaryDateTo] = useState(getYesterdayISO);
  const [summaryFromShifts, setSummaryFromShifts] = useState(['Day', 'Night']);
  const [summaryToShifts, setSummaryToShifts] = useState(['Day', 'Night']);

  const handleSendSummary = async () => {
    if (sendingSum || downloadingSum) return;
    setSendingSum(true);
    setSumMessage(null);
    try {
      const stage = process === 'holo' ? 'holo' : process === 'coning' ? 'coning' : 'cutter';
      const result = await sendSummaryNotification(stage, 'issue', summaryDateFrom, summaryDateTo, summaryFromShifts, summaryToShifts);
      if (result.ok) {
        const channelErrors = Object.entries(result?.channels || {})
          .flatMap(([channel, detail]) => (detail?.results || [])
            .filter(r => !r.success)
            .map(r => `${channel}: ${r.error || 'failed'}`));
        if (channelErrors.length > 0) {
          setSumMessage({ type: 'error', text: `Summary sent with partial failures (${channelErrors[0]})` });
        } else {
          setSumMessage({ type: 'success', text: 'Summary sent successfully!' });
        }
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

  const handleDownloadSummary = async () => {
    if (sendingSum || downloadingSum) return;
    setDownloadingSum(true);
    setSumMessage(null);
    try {
      const stage = process === 'holo' ? 'holo' : process === 'coning' ? 'coning' : 'cutter';
      await downloadSummaryPdf(stage, 'issue', summaryDateFrom, summaryDateTo, summaryFromShifts, summaryToShifts);
      setSumMessage({ type: 'success', text: 'Summary downloaded successfully!' });
    } catch (err) {
      setSumMessage({ type: 'error', text: err.message || 'Failed to download summary' });
    } finally {
      setDownloadingSum(false);
      setTimeout(() => setSumMessage(null), 5000);
    }
  };

  const handleSummaryActionOpen = () => {
    if (sendingSum || downloadingSum || readOnly) return;
    setSummaryActionOpen(true);
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
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {summaryDateFrom === summaryDateTo ? (
              <>
                {formatDateDisplay(summaryDateFrom)}
                {summaryFromShifts.length === summaryToShifts.length && summaryFromShifts.every(s => summaryToShifts.includes(s)) ? (
                  ` (${summaryFromShifts.join(', ')})`
                ) : (
                  ` (${summaryFromShifts.join(', ')} -> ${summaryToShifts.join(', ')})`
                )}
              </>
            ) : (
              `${formatDateDisplay(summaryDateFrom)} (${summaryFromShifts.join(', ')}) to ${formatDateDisplay(summaryDateTo)} (${summaryToShifts.join(', ')})`
            )}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSummaryActionOpen}
            disabled={sendingSum || downloadingSum || readOnly}
            className="flex items-center gap-2"
          >
            <Send className="h-4 w-4" />
            {sendingSum ? 'Sending...' : 'Send Summary'}
          </Button>
        </div>
      </div>

      <Dialog open={summaryActionOpen} onOpenChange={setSummaryActionOpen}>
        <DialogContent title="Send / Download Summary" onOpenChange={setSummaryActionOpen}>
          <div className="space-y-4 my-3 text-left">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* From Column */}
              <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
                <label className="block text-xs font-bold text-foreground mb-1 uppercase tracking-wider">From Date & Shifts</label>
                <input
                  type="date"
                  value={summaryDateFrom}
                  onChange={(e) => setSummaryDateFrom(e.target.value)}
                  className="w-full rounded border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                <div>
                  <span className="block text-xs font-semibold text-muted-foreground mb-1">From Shifts</span>
                  <div className="flex gap-4 mt-1">
                    {['Day', 'Night'].map((shift) => {
                      const isChecked = summaryFromShifts.includes(shift);
                      return (
                        <label key={`from-${shift}`} className="flex items-center gap-2 text-sm font-medium select-none cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setSummaryFromShifts(summaryFromShifts.filter(s => s !== shift));
                              } else {
                                setSummaryFromShifts([...summaryFromShifts, shift]);
                              }
                            }}
                            className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                          />
                          <span>{shift}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* To Column */}
              <div className="space-y-3 p-3 rounded-lg border bg-muted/20">
                <label className="block text-xs font-bold text-foreground mb-1 uppercase tracking-wider">To Date & Shifts</label>
                <input
                  type="date"
                  value={summaryDateTo}
                  onChange={(e) => setSummaryDateTo(e.target.value)}
                  className="w-full rounded border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
                />
                <div>
                  <span className="block text-xs font-semibold text-muted-foreground mb-1">To Shifts</span>
                  <div className="flex gap-4 mt-1">
                    {['Day', 'Night'].map((shift) => {
                      const isChecked = summaryToShifts.includes(shift);
                      return (
                        <label key={`to-${shift}`} className="flex items-center gap-2 text-sm font-medium select-none cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              if (isChecked) {
                                setSummaryToShifts(summaryToShifts.filter(s => s !== shift));
                              } else {
                                setSummaryToShifts([...summaryToShifts, shift]);
                              }
                            }}
                            className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
                          />
                          <span>{shift}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button
              onClick={async () => {
                setSummaryActionOpen(false);
                await handleSendSummary();
              }}
              disabled={sendingSum || downloadingSum || readOnly || summaryFromShifts.length === 0 || summaryToShifts.length === 0}
              className="flex-1 flex items-center gap-2 justify-center"
            >
              <Send className="h-4 w-4" />
              {sendingSum ? 'Sending...' : 'Send Notification'}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                setSummaryActionOpen(false);
                await handleDownloadSummary();
              }}
              disabled={sendingSum || downloadingSum || summaryFromShifts.length === 0 || summaryToShifts.length === 0}
              className="flex-1 flex items-center gap-2 justify-center"
            >
              <Download className="h-4 w-4" />
              {downloadingSum ? 'Downloading...' : 'Download PDF'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
