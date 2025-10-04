/**
 * RecentLots component for GLINTEX Inventory
 */

import React, { useState } from 'react';
import { useBrand } from '../../context';
import { Pagination } from '../common';
import { formatKg } from '../../utils';

export function RecentLots({ db }) {
  const { cls } = useBrand();
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const sorted = [...db.lots].sort((a,b)=> b.createdAt?.localeCompare?.(a.createdAt) || 0);
  const rows = sorted.slice((page-1)*pageSize, page*pageSize).map(l=>({
    ...l,
    itemName: db.items.find(i=>i.id===l.itemId)?.name || "—",
    firmName: db.firms.find(f=>f.id===l.firmId)?.name || "—",
    supplierName: db.suppliers.find(s=>s.id===l.supplierId)?.name || "—",
  }));
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm"><thead className={`text-left ${cls.muted}`}><tr><th className="py-2 pr-2">Lot No</th><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Firm</th><th className="py-2 pr-2">Supplier</th><th className="py-2 pr-2 text-right">Pieces</th><th className="py-2 pr-2 text-right">Weight (kg)</th></tr></thead>
        <tbody>
  {rows.length===0? <tr><td colSpan={7} className="py-4">No lots yet.</td></tr> : rows.map(r=> (
            <tr key={r.lotNo} className={`border-t ${cls.rowBorder} row-hover`}><td className="py-2 pr-2 font-medium">{r.lotNo}</td><td className="py-2 pr-2">{r.date}</td><td className="py-2 pr-2">{r.itemName}</td><td className="py-2 pr-2">{r.firmName}</td><td className="py-2 pr-2">{r.supplierName}</td><td className="py-2 pr-2 text-right">{r.totalPieces}</td><td className="py-2 pr-2 text-right">{formatKg(r.totalWeight)}</td></tr>
          ))}
        </tbody>
      </table>
      <Pagination total={sorted.length} page={page} setPage={setPage} pageSize={pageSize} />
    </div>
  );
}
