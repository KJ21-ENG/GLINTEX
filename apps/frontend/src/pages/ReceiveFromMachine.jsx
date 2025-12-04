import React, { useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { ManualReceiveForm, HoloReceiveForm, ConingReceiveForm, CutterReceiveForm, ReceiveHistoryTable } from '../components/receive';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui';

export function ReceiveFromMachine() {
  const { process } = useInventory();

  return (
    <div className="space-y-6 fade-in">
      <h1 className="text-2xl font-bold tracking-tight">Receive from Machine</h1>

      {process === 'holo' ? (
        <HoloReceiveForm />
      ) : process === 'coning' ? (
        <ConingReceiveForm />
      ) : process === 'cutter' ? (
        <CutterReceiveForm />
      ) : (
        <ManualReceiveForm />
      )}

      <ReceiveHistoryTable />
    </div>
  );
}