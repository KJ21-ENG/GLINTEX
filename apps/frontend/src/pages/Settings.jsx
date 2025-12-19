import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui';
import { Smartphone, MessageSquare, Database, Palette, Wifi, Copy, Save, RefreshCw, LogOut, Upload, Printer, Users, Info } from 'lucide-react';
import * as api from '../api';
import UserManagement from './Settings/UserManagement';

const WHATSAPP_VARIABLES = {
    inbound_created: [
        { key: 'lotNo', label: 'Lot No' },
        { key: 'itemName', label: 'Item Name' },
        { key: 'date', label: 'Date' },
        { key: 'totalPieces', label: 'Total Pieces' },
        { key: 'totalWeight', label: 'Total Weight' },
    ],
    issue_to_machine_created: [
        { key: 'itemName', label: 'Item Name' },
        { key: 'lotNo', label: 'Lot No' },
        { key: 'date', label: 'Date' },
        { key: 'count', label: 'Pieces Count' },
        { key: 'totalWeight', label: 'Total Weight' },
        { key: 'machineName', label: 'Machine' },
        { key: 'operatorName', label: 'Operator' },
        { key: 'cutName', label: 'Cut' },
    ],
    issue_to_machine_deleted: [
        { key: 'itemName', label: 'Item Name' },
        { key: 'lotNo', label: 'Lot No' },
        { key: 'date', label: 'Date' },
        { key: 'count', label: 'Pieces Count' },
        { key: 'totalWeight', label: 'Total Weight' },
        { key: 'machineName', label: 'Machine' },
        { key: 'operatorName', label: 'Operator' },
    ],
    piece_wastage_marked: [
        { key: 'pieceId', label: 'Piece ID' },
        { key: 'lotNo', label: 'Lot No' },
        { key: 'itemName', label: 'Item Name' },
        { key: 'wastage', label: 'Wastage (kg)' },
        { key: 'wastagePercent', label: 'Wastage %' },
    ],
    item_out_of_stock: [
        { key: 'itemName', label: 'Item Name' },
        { key: 'available', label: 'Available Weight' },
    ],
    lot_deleted: [
        { key: 'itemName', label: 'Item Name' },
        { key: 'lotNo', label: 'Lot No' },
        { key: 'totalPieces', label: 'Total Pieces' },
        { key: 'date', label: 'Date' },
    ],
    inbound_piece_deleted: [
        { key: 'itemName', label: 'Item Name' },
        { key: 'lotNo', label: 'Lot No' },
        { key: 'pieceId', label: 'Piece ID' },
    ],
};

function VariablesPopover({ variables }) {
    const [isOpen, setIsOpen] = useState(false);
    const closeTimeoutRef = useRef(null);

    const handleMouseEnter = () => {
        if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
        }
        setIsOpen(true);
    };

    const handleMouseLeave = () => {
        closeTimeoutRef.current = setTimeout(() => {
            setIsOpen(false);
        }, 150);
    };

    useEffect(() => {
        return () => {
            if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
        };
    }, []);

    return (
        <div
            className="relative inline-block"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full hover:bg-muted"
                onClick={(e) => {
                    e.stopPropagation();
                    if (!isOpen) handleMouseEnter();
                    else setIsOpen(false);
                }}
            >
                <Info className="h-4 w-4 text-primary" />
            </Button>

            {isOpen && (
                <div
                    className="absolute left-0 top-full mt-2 z-50 w-64 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none animate-in fade-in-0 zoom-in-95"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="max-h-[300px] overflow-y-auto overscroll-contain text-xs space-y-1 pr-1">
                        {!variables || variables.length === 0 ? (
                            <div className="text-muted-foreground">No variables for this event.</div>
                        ) : (
                            variables.map((v) => (
                                <div key={v.key} className="flex justify-between border-b last:border-0 py-1 gap-2">
                                    <span className="font-mono text-[11px] shrink-0">@{v.key}</span>
                                    <span className="text-muted-foreground text-right">{v.label}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export function Settings() {
    const { db, brand, refreshing, refreshDb, updateSettings } = useInventory();
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('whatsapp');
    const isAdmin = user?.roleKey === 'admin';
    const [groups, setGroups] = useState([]);

    useEffect(() => {
        let mounted = true;
        async function loadGroupsIfConnected() {
            try {
                const s = await api.whatsappStatus();
                if (!mounted) return;
                if (s.status === 'connected' && groups.length === 0) {
                    const g = await api.whatsappGroups();
                    if (mounted) setGroups(g || []);
                }
            } catch (e) {
                console.warn('Failed to auto-load groups in Settings', e);
            }
        }
        loadGroupsIfConnected();
    }, [groups.length]);

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
                        {isAdmin && (
                            <button
                                onClick={() => setActiveTab('users')}
                                className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 ${activeTab === 'users' ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}
                            >
                                <Users className="w-4 h-4" /> Users & Roles
                            </button>
                        )}
                    </nav>
                </CardContent>
            </Card>

            <div className="flex-1 w-full space-y-6">
                <Card>
                    <CardContent className="pt-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                        <div className="text-sm">
                            <span className="text-muted-foreground">Signed in as </span>
                            <span className="font-medium">{user?.displayName || user?.username || '—'}</span>
                            {/* role is shown elsewhere; avoid duplicating it here */}
                        </div>
                        <Button variant="outline" onClick={logout}>
                            <LogOut className="w-4 h-4 mr-2" /> Logout
                        </Button>
                    </CardContent>
                </Card>
                {activeTab === 'whatsapp' && <WhatsAppSettings db={db} refreshDb={refreshDb} updateSettings={updateSettings} groups={groups} setGroups={setGroups} />}
                {activeTab === 'templates' && <MessageTemplates db={db} groups={groups} setGroups={setGroups} />}
                {activeTab === 'branding' && <BrandingSettings brand={brand} updateSettings={updateSettings} refreshDb={refreshDb} />}
                {activeTab === 'data' && <RawDataView db={db} />}
                {activeTab === 'users' && <UserManagement />}
            </div>
        </div>
    );
}

function MessageTemplates({ db, groups, setGroups }) {
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState(null); // { event, template, enabled, sendToPrimary, groupIds }
    const textareaRef = useRef(null);
    const [mention, setMention] = useState({
        open: false,
        query: '',
        start: -1,
        caret: 0
    });
    const [mentionIndex, setMentionIndex] = useState(0);

    const eventVariables = editing ? WHATSAPP_VARIABLES[editing.event] || [] : [];

    useEffect(() => {
        load();
        if (groups.length === 0) {
            loadGroups();
        }
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

    async function loadGroups() {
        try {
            const res = await api.whatsappGroups();
            setGroups(res || []);
        } catch (e) {
            console.warn('Failed to load whatsapp groups', e);
        }
    }

    async function handleSave() {
        if (!editing) return;
        try {
            await api.updateWhatsappTemplate(editing.event, {
                template: editing.template,
                enabled: editing.enabled,
                sendToPrimary: editing.sendToPrimary,
                groupIds: editing.groupIds
            });
            setEditing(null);
            load();
            alert('Template updated');
        } catch (e) {
            alert(e.message);
        }
    }

    const toggleGroup = (groupId) => {
        if (!editing) return;
        const current = editing.groupIds || [];
        if (current.includes(groupId)) {
            setEditing({ ...editing, groupIds: current.filter(id => id !== groupId) });
        } else {
            setEditing({ ...editing, groupIds: [...current, groupId] });
        }
    };

    const closeMention = () => {
        setMention({ open: false, query: '', start: -1, caret: 0 });
        setMentionIndex(0);
    };

    const handleValueChange = (nextValue, caretPos) => {
        setEditing({ ...editing, template: nextValue });
        const beforeCaret = nextValue.slice(0, caretPos);
        const lastAt = beforeCaret.lastIndexOf('@');
        if (lastAt === -1) {
            closeMention();
            return;
        }
        const afterAt = beforeCaret.slice(lastAt + 1);
        if (!/^[a-zA-Z0-9_]*$/.test(afterAt)) {
            closeMention();
            return;
        }
        setMention({
            open: true,
            query: afterAt,
            start: lastAt,
            caret: caretPos
        });
        setMentionIndex(0);
    };

    const applyMention = (key) => {
        if (!editing) return;
        const value = editing.template || '';
        const start = mention.start ?? -1;
        const caret = mention.caret ?? value.length;
        if (start < 0 || start > caret) return;
        const before = value.slice(0, start);
        const after = value.slice(caret);
        const inserted = `@${key}`;
        const nextValue = `${before}${inserted}${after}`;
        setEditing({ ...editing, template: nextValue });
        closeMention();
        
        requestAnimationFrame(() => {
            if (textareaRef.current) {
                const pos = before.length + inserted.length;
                try {
                    textareaRef.current.setSelectionRange(pos, pos);
                    textareaRef.current.focus();
                } catch (e) { /* ignore */ }
            }
        });
    };

    return (
        <Card>
            <CardHeader><CardTitle>Message Templates</CardTitle></CardHeader>
            <CardContent>
                <div className="space-y-4">
                    {loading && <div className="text-sm text-muted-foreground">Loading...</div>}
                    {!loading && templates.length === 0 && <div className="text-sm text-muted-foreground">No templates found.</div>}

                    <div className="grid gap-4">
                        {templates.map(t => {
                            const primaryNumber = db?.settings?.[0]?.whatsappNumber;
                            const assignedGroups = (t.groupIds || []).map(gid => {
                                const g = groups.find(x => x.id === gid);
                                if (g) return { id: gid, name: g.name };
                                if (groups.length === 0) return { id: gid, name: 'Loading...' };
                                return { id: gid, name: null };
                            });

                            return (
                                <div key={t.event} className={`border p-4 rounded-md space-y-2 ${!t.enabled ? 'opacity-50 grayscale bg-muted/20' : ''}`}>
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <h4 className="font-medium capitalize">{t.event.replace(/_/g, ' ')}</h4>
                                            {!t.enabled && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground uppercase font-bold">Disabled</span>}
                                        </div>
                                        <Button variant="outline" size="sm" onClick={() => setEditing(t)}>Edit</Button>
                                    </div>
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{t.template}</p>

                                    {(t.sendToPrimary || assignedGroups.length > 0) && (
                                        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-muted/50">
                                            {t.sendToPrimary && primaryNumber && (
                                                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 dark:bg-blue-700 text-white rounded-md text-[11px] font-bold shadow-sm border border-blue-700 dark:border-blue-800">
                                                    <Smartphone className="w-3.5 h-3.5 text-white/90" />
                                                    <span>+{primaryNumber}</span>
                                                </div>
                                            )}
                                            {assignedGroups.map(group => (
                                                <div key={group.id} className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 dark:bg-emerald-700 text-white rounded-md text-[11px] font-bold shadow-sm border border-emerald-700 dark:border-emerald-800">
                                                    <Users className="w-3.5 h-3.5 text-white/90" />
                                                    <span className="max-w-[150px] truncate">
                                                        {group.name === 'Loading...' ? (
                                                            <span className="animate-pulse">Loading...</span>
                                                        ) : group.name ? (
                                                            group.name
                                                        ) : (
                                                            `Unknown Group (${group.id.split('@')[0]})`
                                                        )}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {editing && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <Card className="w-full max-w-lg max-h-[90vh] flex flex-col">
                            <CardHeader><CardTitle>Edit Template: {editing.event.replace(/_/g, ' ')}</CardTitle></CardHeader>
                            <CardContent className="space-y-4 overflow-y-auto">
                                <div className="flex items-center gap-6 py-2 border-b">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={editing.enabled}
                                            onChange={e => setEditing({ ...editing, enabled: e.target.checked })}
                                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                        <span className="text-sm font-medium">Enabled</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={editing.sendToPrimary}
                                            onChange={e => setEditing({ ...editing, sendToPrimary: e.target.checked })}
                                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                        <span className="text-sm font-medium">Send to Primary No.</span>
                                    </label>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1">
                                            <Label>Template Content</Label>
                                            <VariablesPopover variables={eventVariables} />
                                        </div>
                                        <span className="text-[10px] text-muted-foreground italic">Type @ to see variables</span>
                                    </div>
                                    <div className="relative">
                                        <textarea
                                            ref={textareaRef}
                                            className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                            value={editing.template}
                                            onChange={e => handleValueChange(e.target.value, e.target.selectionStart)}
                                            onSelect={e => handleValueChange(e.target.value, e.target.selectionStart)}
                                            onKeyDown={e => {
                                                if (!mention.open) return;
                                                const filtered = eventVariables.filter(v =>
                                                    mention.query ? v.key.toLowerCase().startsWith(mention.query.toLowerCase()) : true
                                                );
                                                if (filtered.length === 0) return;
                                                if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)) {
                                                    e.preventDefault();
                                                }
                                                if (e.key === 'ArrowDown') {
                                                    setMentionIndex(prev => (prev + 1) % filtered.length);
                                                } else if (e.key === 'ArrowUp') {
                                                    setMentionIndex(prev => (prev - 1 + filtered.length) % filtered.length);
                                                } else if (e.key === 'Enter' || e.key === 'Tab') {
                                                    const pick = filtered[mentionIndex] || filtered[0];
                                                    if (pick) applyMention(pick.key);
                                                } else if (e.key === 'Escape') {
                                                    closeMention();
                                                }
                                            }}
                                            placeholder="Enter message template..."
                                        />
                                        {mention.open && (
                                            <div className="absolute z-[60] mt-1 w-full max-w-sm rounded-md border bg-white shadow-lg overflow-hidden">
                                                <div className="max-h-48 overflow-y-auto overscroll-contain text-sm" onWheel={e => e.stopPropagation()}>
                                                    {eventVariables
                                                        .filter(v =>
                                                            mention.query ? v.key.toLowerCase().startsWith(mention.query.toLowerCase()) : true
                                                        )
                                                        .map((v, idx) => (
                                                            <button
                                                                key={v.key}
                                                                type="button"
                                                                className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors ${idx === mentionIndex ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'
                                                                    }`}
                                                                onMouseDown={e => {
                                                                    e.preventDefault();
                                                                    applyMention(v.key);
                                                                }}
                                                            >
                                                                <span className="font-mono text-xs">@{v.key}</span>
                                                                <span className="text-[10px] opacity-70">{v.label}</span>
                                                            </button>
                                                        ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">Supports both {'{{variable}}'} and @variable syntax.</p>
                                </div>

                                <div className="space-y-2">
                                    <Label>Send to Groups</Label>
                                    {groups.length === 0 ? (
                                        <p className="text-xs text-muted-foreground italic bg-muted/30 p-2 rounded">No WhatsApp groups found. Ensure WhatsApp is connected.</p>
                                    ) : (
                                        <div className="border rounded-md divide-y max-h-[160px] overflow-y-auto">
                                            {groups.map(g => (
                                                <label key={g.id} className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        checked={(editing.groupIds || []).includes(g.id)}
                                                        onChange={() => toggleGroup(g.id)}
                                                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                    />
                                                    <span className="text-sm truncate">{g.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="flex justify-end gap-2 pt-2 border-t mt-4">
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

function WhatsAppSettings({ db, refreshDb, updateSettings, groups, setGroups }) {
    const [status, setStatus] = useState({ status: 'disconnected' });
    const [qr, setQr] = useState(null);
    const [working, setWorking] = useState(false);
    const [primaryMobile, setPrimaryMobile] = useState('');
    const [allowedGroupIds, setAllowedGroupIds] = useState([]);

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
                    // If connected, also load groups
                    if (s.status === 'connected' && groups.length === 0) {
                        const g = await api.whatsappGroups();
                        setGroups(g || []);
                    }
                }
            } catch (e) { console.error(e); }
        }
        load();
        const interval = setInterval(load, 5000);
        return () => { mounted = false; clearInterval(interval); };
    }, [groups.length, setGroups]);

    useEffect(() => {
        const settings = db?.settings?.[0];
        const num = settings?.whatsappNumber || '';
        setPrimaryMobile(num ? String(num).replace(/^91/, '') : '');
        setAllowedGroupIds(settings?.whatsappGroupIds || []);
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
            setGroups([]);
        } finally { setWorking(false); }
    };

    const handleSaveSettings = async () => {
        setWorking(true);
        try {
            await updateSettings({
                whatsappNumber: primaryMobile,
                whatsappGroupIds: allowedGroupIds
            });
            alert('WhatsApp settings saved');
            refreshDb();
        } catch (e) { alert(e.message); } finally { setWorking(false); }
    };

    const toggleAllowedGroup = (id) => {
        if (allowedGroupIds.includes(id)) {
            setAllowedGroupIds(allowedGroupIds.filter(x => x !== id));
        } else {
            setAllowedGroupIds([...allowedGroupIds, id]);
        }
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
                            <Button size="sm" variant="outline" onClick={() => { setGroups([]); }} disabled={!isConnected || working} title="Refresh Groups">
                                <RefreshCw className={`w-4 h-4 ${working ? 'animate-spin' : ''}`} />
                            </Button>
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
                <CardHeader>
                    <CardTitle>Notification Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <Label>Primary Mobile Number (10 digits)</Label>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">+91</span>
                                <Input
                                    className="pl-12"
                                    value={primaryMobile}
                                    onChange={e => setPrimaryMobile(e.target.value.replace(/\D/g, ''))}
                                    placeholder="9876543210"
                                    maxLength={10}
                                />
                            </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground">Direct alerts will be sent to this administrator number.</p>
                    </div>

                    <div className="space-y-2">
                        <Label>Authorized Groups</Label>
                        {!isConnected ? (
                            <p className="text-xs text-muted-foreground italic bg-muted/30 p-3 rounded-md">Connect WhatsApp to view and authorize groups for notifications.</p>
                        ) : groups.length === 0 ? (
                            <p className="text-xs text-muted-foreground p-3 border rounded-md animate-pulse">Fetching groups...</p>
                        ) : (
                            <div className="border rounded-md divide-y max-h-[200px] overflow-y-auto">
                                {groups.map(g => (
                                    <label key={g.id} className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={allowedGroupIds.includes(g.id)}
                                            onChange={() => toggleAllowedGroup(g.id)}
                                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                        />
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium truncate">{g.name}</span>
                                            <span className="text-[10px] text-muted-foreground truncate opacity-70">{g.id}</span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}
                        <p className="text-[10px] text-muted-foreground">Select which groups are allowed to receive system notifications.</p>
                    </div>

                    <Button className="w-full" onClick={handleSaveSettings} disabled={working}>
                        <Save className="w-4 h-4 mr-2" /> Save Notification Settings
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

function BrandingSettings({ brand, updateSettings, refreshDb }) {
    const [localBrand, setLocalBrand] = useState(brand);
    const [saving, setSaving] = useState(false);
    const [accessUrl, setAccessUrl] = useState('');
    const logoInputRef = React.useRef(null);
    const faviconInputRef = React.useRef(null);

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

    const handleFavicon = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setLocalBrand(p => ({ ...p, faviconDataUrl: reader.result }));
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
                            <div>
                                <Button variant="outline" onClick={() => logoInputRef.current?.click()}><Upload className="w-4 h-4 mr-2" /> Upload</Button>
                                <input ref={logoInputRef} type="file" className="hidden" accept="image/*" onChange={handleLogo} />
                            </div>
                        </div>
                    </div>
                    <div>
                        <Label>Favicon</Label>
                        <div className="flex items-center gap-4 mt-2">
                            <div className="h-16 w-16 border rounded-md flex items-center justify-center overflow-hidden bg-muted">
                                {localBrand.faviconDataUrl ? <img src={localBrand.faviconDataUrl} className="h-full w-full object-contain" /> : <span className="text-xs text-muted-foreground">No Favicon</span>}
                            </div>
                            <div>
                                <Button variant="outline" onClick={() => faviconInputRef.current?.click()}><Upload className="w-4 h-4 mr-2" /> Upload</Button>
                                <input ref={faviconInputRef} type="file" className="hidden" accept="image/*" onChange={handleFavicon} />
                            </div>
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
