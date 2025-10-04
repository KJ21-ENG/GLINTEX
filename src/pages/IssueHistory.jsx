/**
 * IssueHistory page component for GLINTEX Inventory
 */

import React from 'react';
import { useBrand } from '../context';
import { formatKg } from '../utils';

export function IssueHistory({ db }) {
  const { cls } = useBrand();
  const rows = [...db.consumptions].sort((a,b)=> b.date.localeCompare(a.date));
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Lot</th><th className="py-2 pr-2 text-right">Qty</th><th className="py-2 pr-2 text-right">Weight (kg)</th><th className="py-2 pr-2">Pieces</th><th className="py-2 pr-2">Note</th></tr></thead>
        <tbody>
          {rows.length===0? <tr><td colSpan={7} className="py-4">No issues yet.</td></tr> : rows.map((r, idx) => (
            <tr key={r.id || idx} className={`border-t ${cls.rowBorder} align-top row-hover`}>
              <td className="py-2 pr-2">{r.date}</td>
              <td className="py-2 pr-2">{db.items.find(i=>i.id===r.itemId)?.name || "—"}</td>
              <td className="py-2 pr-2">{r.lotNo}</td>
              <td className="py-2 pr-2 text-right">{r.count}</td>
              <td className="py-2 pr-2 text-right">{formatKg(r.totalWeight)}</td>
              <td className="py-2 pr-2 font-mono whitespace-pre-wrap">{r.pieceIds.join(", ")}</td>
              <td className="py-2 pr-2">{r.note || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
