/**
 * RawTable component for GLINTEX Inventory
 */

import React, { useState } from 'react';
import { useBrand } from '../../context';
import { Pagination } from '../common';

export function RawTable({ title, rows }) {
  const { cls } = useBrand();
  const keys = Object.keys(rows[0] || {});
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const start = (page-1)*pageSize;
  const pageRows = rows.slice(start, start+pageSize);
  return (
    <div className="mb-6">
      <h3 className={`text-sm uppercase tracking-wide mb-2 ${cls.muted}`}>{title}</h3>
      {rows.length === 0 ? (<div className="text-sm">No rows.</div>) : (
        <div className="overflow-auto">
          <table className="w-full text-xs md:text-sm"><thead className={`text-left ${cls.muted}`}><tr>{keys.map(k => <th key={k} className="py-1 pr-2">{k}</th>)}</tr></thead>
            <tbody>
              {pageRows.map((r, i) => (<tr key={start+i} className={`border-t ${cls.rowBorder} row-hover`}>{keys.map(k => <td key={k} className="py-1 pr-2 font-mono whitespace-pre">{String(r[k])}</td>)}</tr>))}
            </tbody>
          </table>
          <Pagination total={rows.length} page={page} setPage={setPage} pageSize={pageSize} />
        </div>
      )}
    </div>
  );
}
