import React from 'react';
import { formatKg } from '../../utils';

export function ConingSupplyHistory({ issue }) {
  if (!issue?.coningBatchEnabled) return null;
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Supply history · {issue.barcode} · {(issue.supplies || []).length} deliveries
      </summary>
      <p className="my-2 text-xs text-muted-foreground">Every delivery keeps its own issue number. All supervisor stickers use {issue.barcode}.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b"><th className="p-2">Delivery</th><th className="p-2">Issued at (IST)</th><th className="p-2">Source crates</th><th className="p-2 text-right">Rolls</th><th className="p-2 text-right">Net kg</th></tr></thead>
          <tbody>{(issue.supplies || []).map((supply) => (
            <tr key={supply.id} className="border-b last:border-0">
              <td className="p-2 font-mono">{supply.barcode}</td>
              <td className="p-2 whitespace-nowrap">{new Date(supply.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
              <td className="p-2">{(supply.receivedRowRefs || []).map((ref) => ref.barcode || ref.rowId).join(', ')}</td>
              <td className="p-2 text-right">{supply.rollsIssued}</td>
              <td className="p-2 text-right">{formatKg(supply.issuedWeight)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}
