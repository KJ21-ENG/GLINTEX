import React, { useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { IssueToCutter } from '../components/issue';
import { IssueToHolo } from '../components/issue';
import { IssueToConing } from '../components/issue';
import { OnMachineTable } from '../components/issue';
import { IssueHistory } from './IssueHistory';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui';

export function IssueToMachine() {
  const { process, db, refreshDb } = useInventory();
  const [activeTab, setActiveTab] = useState('on-machine');

  return (
    <div className="space-y-6 fade-in">
      <h1 className="text-2xl font-bold tracking-tight">Issue to Machine</h1>

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
          <div className="flex items-center justify-between">
            <CardTitle>Issue Tracking</CardTitle>
            <div className="flex gap-1 bg-muted p-1 rounded-lg">
              <button
                onClick={() => setActiveTab('on-machine')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'on-machine'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                  }`}
              >
                On Machine
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${activeTab === 'history'
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