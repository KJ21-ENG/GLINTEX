import React, { useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { IssueToCutter } from '../components/issue';
import { IssueToHolo } from '../components/issue';
import { IssueToConing } from '../components/issue';
import { IssueHistory } from './IssueHistory';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui';

export function IssueToMachine() {
  const { process, db, refreshDb } = useInventory();

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

      {/* History Section */}
      <Card>
          <CardHeader>
              <CardTitle>Issue History</CardTitle>
          </CardHeader>
          <CardContent>
              <IssueHistory db={db} refreshDb={refreshDb} />
          </CardContent>
      </Card>
    </div>
  );
}