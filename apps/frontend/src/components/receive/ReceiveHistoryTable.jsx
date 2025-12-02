import React, { useMemo, useState } from 'react';
import { useInventory } from '../../context/InventoryContext';
import { formatKg } from '../../utils';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Button, Card, CardHeader, CardTitle, CardContent } from '../ui';
import { Trash2 } from 'lucide-react';
import * as api from '../../api';

export function ReceiveHistoryTable() {
    const { db, process, refreshDb } = useInventory();
    const [deletingId, setDeletingId] = useState(null);

    // Determine which collection to use based on process
    const history = useMemo(() => {
        let rows = [];
        if (process === 'holo') {
            rows = db.receive_from_holo_machine || [];
        } else if (process === 'coning') {
            rows = db.receive_from_coning_machine || [];
        } else {
            rows = db.receive_from_cutter_machine || [];
        }
        return rows.sort((a, b) => (b.receiveDate || '').localeCompare(a.receiveDate || ''));
    }, [db, process]);

    // Helper Maps
    const itemNameById = useMemo(() => {
        const map = new Map();
        (db.items || []).forEach(i => map.set(i.id, i.name || '—'));
        return map;
    }, [db.items]);

    const handleDelete = async (id) => {
        if (!confirm('Delete this receive record?')) return;
        setDeletingId(id);
        try {
            // Assuming generic delete endpoint or specific ones
            // The context actions usually wrap these.
            // Let's use api directly if context doesn't have it exposed generically enough
            // Actually context has deleteIssueToMachine but not explicit deleteReceive...
            // Let's assume an API endpoint exists like /api/receive_from_cutter_machine/:id
            // I'll try to use a generic approach or specific based on process

            let endpoint = '';
            if (process === 'holo') endpoint = `/api/receive_from_holo_machine/${id}`;
            else if (process === 'coning') endpoint = `/api/receive_from_coning_machine/${id}`;
            else endpoint = `/api/receive_from_cutter_machine/${id}`;

            // Using internal request helper if possible, or just fetch
            // Since I can't import 'request' from api/client easily (it's not exported), 
            // I will rely on the fact that I might need to add these delete functions to client.js or use a raw fetch if needed.
            // But wait, I can add them to client.js? No, I should check if they exist.
            // client.js has deleteIssueToMachine but not deleteReceive...
            // I'll assume for now I can't delete or I need to add it.
            // User didn't explicitly ask for delete in history, but "Display tailored receive history table" implies full functionality usually.
            // I'll skip delete implementation for now to avoid breaking if API is missing, or just show the table.
            // Actually, I'll add a simple alert "Delete not implemented" if I can't find the function, 
            // OR I can try to add it to client.js if I was allowed to modify it extensively.
            // I'll stick to just displaying for now as per requirement "Display tailored receive history table".

            alert("Delete functionality not yet configured for this table.");

        } catch (e) {
            alert(e.message);
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <Card>
            <CardHeader><CardTitle>Receive History ({process})</CardTitle></CardHeader>
            <CardContent>
                <div className="rounded-md border max-h-[400px] overflow-y-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Lot</TableHead>
                                <TableHead>Item</TableHead>
                                <TableHead className="">Net Weight</TableHead>
                                {/* Add specific columns based on process if needed */}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {history.length === 0 ? (
                                <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No records found.</TableCell></TableRow>
                            ) : (
                                history.map(r => (
                                    <TableRow key={r.id}>
                                        <TableCell>{r.receiveDate}</TableCell>
                                        <TableCell>{r.lotNo}</TableCell>
                                        <TableCell>{itemNameById.get(r.itemId) || '—'}</TableCell>
                                        <TableCell className="">{formatKg(r.netWeight)}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}
