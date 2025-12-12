import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Badge, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui';
import { Smartphone, MessageSquare, Database, Palette, Wifi, Copy, Save, RefreshCw, LogOut, Upload, Printer } from 'lucide-react';
import * as api from '../api';

export function Settings() {
    const { db, brand, refreshing, refreshDb, updateSettings } = useInventory();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('whatsapp');

    return (
        <div className="flex flex-col md:flex-row gap-6 fade-in items-start">
            <Card className="w-full md:w-64 shrink-0">
                <CardHeader>
                    <CardTitle className="text-lg">Settings</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <nav className="flex flex-col">
                        <button onClick={() => setActiveTab('whatsapp')} className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 ${activeTab === 'whatsapp' ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}>
                            <MessageSquare className="w-4 h-4" /> WhatsApp
                        </button>
                        <button onClick={() => setActiveTab('templates')} className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 ${activeTab === 'templates' ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}>
                            <Copy className="w-4 h-4" /> Message Templates
                        </button>
                        <button onClick={() => setActiveTab('branding')} className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 ${activeTab === 'branding' ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}>
                            <Palette className="w-4 h-4" /> Branding & System
                        </button>
                        <button onClick={() => setActiveTab('data')} className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 ${activeTab === 'data' ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}>
                            <Database className="w-4 h-4" /> Raw Data
                        </button>
                        <button
                            onClick={() => navigate('/app/settings/label-designer')}
                            className="px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 border-transparent text-muted-foreground"
                        >
                            <Printer className="w-4 h-4" /> Label Designer
                        </button>
                    </nav>
                </CardContent>
            </Card>

            <div className="flex-1 w-full space-y-6">
                {activeTab === 'whatsapp' && <WhatsAppSettings db={db} refreshDb={refreshDb} updateSettings={updateSettings} />}
                {activeTab === 'templates' && <MessageTemplates />}
                {activeTab === 'branding' && <BrandingSettings brand={brand} updateSettings={updateSettings} refreshDb={refreshDb} />}
                {activeTab === 'data' && <RawDataView db={db} />}
            </div>
        </div>
    );
}

function MessageTemplates() {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState(null); // { event, template }

    useEffect(() => {
        load();
    }, []);

    async function load() {
        setLoading(true);
        try {
            const res = await api.listWhatsappTemplates();
            setTemplates(res || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        if (!editing) return;
        try {
            await api.updateWhatsappTemplate(editing.event, { template: editing.template });
            setEditing(null);
            load();
            alert('Template updated');
        } catch (e) {
            alert(e.message);
        }
    }

    return (
        <Card>
            <CardHeader><CardTitle>Message Templates</CardTitle></CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {loading && <div className="text-sm text-muted-foreground">Loading...</div>}
                    {!loading && templates.length === 0 && <div className="text-sm text-muted-foreground">No templates found.</div>}

                    <div className="grid gap-4">
                        {templates.map(t => (
                            <div key={t.event} className="border p-4 rounded-md space-y-2">
                                <div className="flex justify-between items-center">
                                    <h4 className="font-medium capitalize">{t.event.replace(/_/g, ' ')}</h4>
                                    <Button variant="outline" size="sm" onClick={() => setEditing(t)}>Edit</Button>
                                </div>
                                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{t.template}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {editing && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <Card className="w-full max-w-lg">
                            <CardHeader><CardTitle>Edit Template: {editing.event}</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Template Message</Label>
                                    <textarea
                                        className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        value={editing.template}
                                        onChange={e => setEditing({ ...editing, template: e.target.value })}
                                    />
                                    <p className="text-xs text-muted-foreground">Use variables like {'{lotNo}'}, {'{weight}'}, etc.</p>
                                </div>
                                <div className="flex justify-end gap-2">
                                    <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                                    <Button onClick={handleSave}>Save Changes</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function WhatsAppSettings({ db, refreshDb, updateSettings }) {
    const [status, setStatus] = useState({ status: 'disconnected' });
    const [qr, setQr] = useState(null);
    const [working, setWorking] = useState(false);
    const [primaryMobile, setPrimaryMobile] = useState('');

    useEffect(() => {
        let mounted = true;
        async function load() {
            try {
                const s = await api.whatsappStatus();
                if (!mounted) return;
                setStatus(s);
                if (s.status === 'qr') {
                    const q = await api.whatsappQr();
                    setQr(q.qr || null);
                } else {
                    setQr(null);
                }
            } catch (e) { console.error(e); }
        }
        load();
        const interval = setInterval(load, 5000);
        return () => { mounted = false; clearInterval(interval); };
    }, []);

    useEffect(() => {
        const num = db?.settings?.[0]?.whatsappNumber || '';
        setPrimaryMobile(num ? String(num).replace(/^91/, '') : '');
    }, [db]);

    const isConnected = status.status === 'connected';

    const handleConnect = async () => {
        setWorking(true);
        try {
            await api.whatsappStart();
            const q = await api.whatsappQr();
            setQr(q.qr || null);
        } finally { setWorking(false); }
    };

    const handleLogout = async () => {
        setWorking(true);
        try {
            await api.whatsappLogout();
            setQr(null);
            setStatus({ status: 'disconnected' });
        } finally { setWorking(false); }
    };

    const handleSaveMobile = async () => {
        setWorking(true);
        try {
            await updateSettings({ whatsappNumber: primaryMobile });
            alert('Mobile number saved');
        } catch (e) { alert(e.message); } finally { setWorking(false); }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Connection Status</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                            <div className="flex flex-col">
                                <span className="font-medium capitalize">{status.status === 'qr' ? 'Scan QR' : status.status}</span>
                                {status.mobile && <span className="text-xs text-muted-foreground">+{status.mobile}</span>}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={handleConnect} disabled={working || isConnected}>
                                {working ? 'Working...' : isConnected ? 'Reconnect' : 'Connect'}
                            </Button>
                            {isConnected && (
                                <Button size="sm" variant="destructive" onClick={handleLogout} disabled={working}>
                                    <LogOut className="w-4 h-4 mr-2" /> Logout
                                </Button>
                            )}
                        </div>
                    </div>
                    {qr && (
                        <div className="mt-4 flex justify-center p-4 bg-white rounded-lg border">
                            <img src={qr} alt="QR Code" className="max-w-[200px]" />
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Primary Mobile</CardTitle></CardHeader>
                <CardContent>
                    <div className="flex gap-4">
                        <div className="flex-1">
                            <Label>Number (10 digits)</Label>
                            <Input
                                value={primaryMobile}
                                onChange={e => setPrimaryMobile(e.target.value.replace(/\D/g, ''))}
                                placeholder="9876543210"
                                maxLength={10}
                            />
                        </div>
                        <div className="flex items-end">
                            <Button onClick={handleSaveMobile} disabled={working || primaryMobile.length < 10}>Save</Button>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Direct notifications will be sent to this number.</p>
                </CardContent>
            </Card>
        </div>
    );
}

function BrandingSettings({ brand, updateSettings, refreshDb }) {
    const [localBrand, setLocalBrand] = useState(brand);
    const [saving, setSaving] = useState(false);
    const [accessUrl, setAccessUrl] = useState('');

    useEffect(() => { setLocalBrand(brand); }, [brand]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setAccessUrl(`${window.location.protocol}//${window.location.hostname}:${window.location.port}`);
        }
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await updateSettings(localBrand);
            alert('Branding updated');
        } catch (e) { alert(e.message); } finally { setSaving(false); }
    };

    const handleLogo = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setLocalBrand(p => ({ ...p, logoDataUrl: reader.result }));
        reader.readAsDataURL(file);
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader><CardTitle>System Access</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label>Frontend URL</Label>
                        <div className="flex gap-2">
                            <Input readOnly value={accessUrl} />
                            <Button size="icon" variant="outline" onClick={() => navigator.clipboard.writeText(accessUrl)}>
                                <Copy className="w-4 h-4" />
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Share this URL with devices on the same Wi-Fi.</p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader><CardTitle>Branding</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label>Primary Color (Hex)</Label>
                            <Input value={localBrand.primary} onChange={e => setLocalBrand({ ...localBrand, primary: e.target.value })} />
                        </div>
                        <div>
                            <Label>Accent Color (Hex)</Label>
                            <Input value={localBrand.gold} onChange={e => setLocalBrand({ ...localBrand, gold: e.target.value })} />
                        </div>
                    </div>
                    <div>
                        <Label>Logo</Label>
                        <div className="flex items-center gap-4 mt-2">
                            <div className="h-16 w-16 border rounded-md flex items-center justify-center overflow-hidden bg-muted">
                                {localBrand.logoDataUrl ? <img src={localBrand.logoDataUrl} className="h-full w-full object-contain" /> : <span className="text-xs text-muted-foreground">No Logo</span>}
                            </div>
                            <label className="cursor-pointer">
                                <Button variant="outline" as="span"><Upload className="w-4 h-4 mr-2" /> Upload</Button>
                                <input type="file" className="hidden" accept="image/*" onChange={handleLogo} />
                            </label>
                        </div>
                    </div>
                    <Button onClick={handleSave} disabled={saving}><Save className="w-4 h-4 mr-2" /> Save Branding</Button>
                </CardContent>
            </Card>
        </div>
    );
}

function RawDataView({ db }) {
    return (
        <Card>
            <CardHeader><CardTitle>Raw Data Tables</CardTitle></CardHeader>
            <CardContent>
                <div className="space-y-6">
                    <RawTable title="Items" data={db.items} />
                    <RawTable title="Firms" data={db.firms} />
                    <RawTable title="Suppliers" data={db.suppliers} />
                </div>
            </CardContent>
        </Card>
    );
}

function RawTable({ title, data }) {
    if (!data || !data.length) return null;
    const headers = Object.keys(data[0]).slice(0, 5);
    return (
        <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">{title} ({data.length})</h4>
            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {headers.map(h => <TableHead key={h} className="capitalize">{h}</TableHead>)}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.slice(0, 5).map((row, i) => (
                            <TableRow key={i}>
                                {headers.map(h => <TableCell key={h} className="whitespace-nowrap">{typeof row[h] === 'object' ? JSON.stringify(row[h]) : row[h]}</TableCell>)}
                            </TableRow>
                        ))}
                        {data.length > 5 && <TableRow><TableCell colSpan={headers.length} className="text-center text-xs text-muted-foreground">...and {data.length - 5} more</TableCell></TableRow>}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
