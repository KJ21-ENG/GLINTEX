import React, { useMemo } from 'react';
import { useInventory } from '../context/InventoryContext';
import { Card, CardHeader, CardTitle, CardContent, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui';
import { formatKg } from '../utils';

function groupBy(arr, keyFn) {
    const m = {};
    for (const x of arr) {
        const k = keyFn(x);
        (m[k] ||= []).push(x);
    }
    return m;
}

export function Reports() {
    const { db } = useInventory();

    const supplierRows = useMemo(() => {
        if (!db?.lots) return [];
        const bySupplier = groupBy(db.lots.filter(l => l.supplierId), l => l.supplierId);
        return Object.entries(bySupplier).map(([supplierId, lots]) => ({
            supplierName: db.suppliers.find(s => s.id === supplierId)?.name || "—",
            lotsCount: lots.length,
            pieces: lots.reduce((s, l) => s + (l.totalPieces || 0), 0),
            weight: lots.reduce((s, l) => s + (l.totalWeight || 0), 0)
        }));
    }, [db.lots, db.suppliers]);

    const firmRows = useMemo(() => {
        if (!db?.lots) return [];
        const byFirm = groupBy(db.lots, l => l.firmId);
        return Object.entries(byFirm).map(([firmId, lots]) => ({
            firmName: db.firms.find(f => f.id === firmId)?.name || "—",
            lotsCount: lots.length,
            pieces: lots.reduce((s, l) => s + (l.totalPieces || 0), 0),
            weight: lots.reduce((s, l) => s + (l.totalWeight || 0), 0)
        }));
    }, [db.lots, db.firms]);

    return (
        <div className="space-y-6 fade-in">
            <h1 className="text-2xl font-bold tracking-tight">Reports & Analytics</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                    <CardHeader><CardTitle>Supplier Summary</CardTitle></CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Supplier</TableHead>
                                        <TableHead className="">Lots</TableHead>
                                        <TableHead className="">Pieces</TableHead>
                                        <TableHead className="">Weight</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {supplierRows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center">No data</TableCell></TableRow> :
                                        supplierRows.map((r, i) => (
                                            <TableRow key={i}>
                                                <TableCell>{r.supplierName}</TableCell>
                                                <TableCell className="">{r.lotsCount}</TableCell>
                                                <TableCell className="">{r.pieces}</TableCell>
                                                <TableCell className="">{formatKg(r.weight)}</TableCell>
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader><CardTitle>Firm Summary</CardTitle></CardHeader>
                    <CardContent>
                        <div className="rounded-md border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Firm</TableHead>
                                        <TableHead className="">Lots</TableHead>
                                        <TableHead className="">Pieces</TableHead>
                                        <TableHead className="">Weight</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {firmRows.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center">No data</TableCell></TableRow> :
                                        firmRows.map((r, i) => (
                                            <TableRow key={i}>
                                                <TableCell>{r.firmName}</TableCell>
                                                <TableCell className="">{r.lotsCount}</TableCell>
                                                <TableCell className="">{r.pieces}</TableCell>
                                                <TableCell className="">{formatKg(r.weight)}</TableCell>
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}