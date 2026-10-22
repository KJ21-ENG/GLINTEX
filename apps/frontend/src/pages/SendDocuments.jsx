import React, { useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCw, Search } from 'lucide-react';
import * as api from '../api/client';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '../components/ui';
import { formatDateDDMMYYYY } from '../utils';
import { UserBadge } from '../components/common/UserBadge';

export function SendDocuments() {
    const [history, setHistory] = useState([]);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    async function loadHistory() {
        setLoading(true);
        setError('');
        try {
            const response = await api.getDocumentHistory();
            setHistory(response.messages || []);
        } catch (err) {
            setError(err.message || 'Failed to load document history');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { loadHistory(); }, []);
    const filtered = useMemo(() => {
        const term = query.trim().toLowerCase();
        return history.filter(row => !term || [row.customer?.name, row.phone, row.filename, row.caption]
            .some(value => String(value || '').toLowerCase().includes(term)));
    }, [history, query]);

    return (
        <div className="space-y-6 fade-in">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><FileText className="w-6 h-6" /> Document History</h1>
                    <p className="text-sm text-muted-foreground">Previously sent customer documents. Production summaries are sent through Telegram.</p>
                </div>
                <Button variant="outline" onClick={loadHistory} disabled={loading}><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Sent Documents</CardTitle>
                    <div className="relative"><Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search documents or customers..." value={query} onChange={event => setQuery(event.target.value)} /></div>
                </CardHeader>
                <CardContent>
                    {error ? <p role="alert" className="text-sm text-destructive mb-4">{error}</p> : null}
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Recipient</TableHead><TableHead>Document</TableHead><TableHead>Caption</TableHead><TableHead>Sent by</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {loading ? <TableRow><TableCell colSpan={6}>Loading document history...</TableCell></TableRow> : filtered.length === 0 ? <TableRow><TableCell colSpan={6}>No documents found.</TableCell></TableRow> : filtered.map(row => (
                                    <TableRow key={row.id}>
                                        <TableCell>{formatDateDDMMYYYY(row.sentAt)}</TableCell>
                                        <TableCell>{row.customer?.name || '—'}</TableCell>
                                        <TableCell>{row.phone || '—'}</TableCell>
                                        <TableCell>{row.filename}</TableCell>
                                        <TableCell className="max-w-xs whitespace-pre-wrap">{row.caption || '—'}</TableCell>
                                        <TableCell><UserBadge user={row.createdByUser} /></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
