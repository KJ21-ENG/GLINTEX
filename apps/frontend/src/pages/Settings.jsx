import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui';
import { Smartphone, MessageSquare, Database, Palette, Wifi, Copy, Save, RefreshCw, LogOut, Upload, Printer, Users, Info, HardDrive, Download, Plus, AlertTriangle, Cloud, ExternalLink, FileText, Search } from 'lucide-react';
import * as api from '../api';
import UserManagement from './Settings/UserManagement';
import { usePermission } from '../hooks/usePermission';
import AccessDenied from '../components/common/AccessDenied';

const WHATSAPP_EVENTS_CONFIG = {
    inbound_created: {
        note: 'Triggered when a new inbound item is added to the system.',
        variables: [
            { key: 'lotNo', label: 'Lot No' },
            { key: 'itemName', label: 'Item Name' },
            { key: 'date', label: 'Date' },
            { key: 'totalPieces', label: 'Total Pieces' },
            { key: 'totalWeight', label: 'Total Weight' },
        ]
    },
    issue_to_cutter_machine_created: {
        note: 'Triggered when pieces are issued to a Cutter machine.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'date', label: 'Date' },
            { key: 'count', label: 'Pieces Count' },
            { key: 'totalWeight', label: 'Total Weight' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
            { key: 'cutName', label: 'Cut Name' },
        ]
    },
    issue_to_holo_machine_created: {
        note: 'Triggered when material is issued to a Holo machine.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'date', label: 'Date' },
            { key: 'metallicBobbins', label: 'Bobbins' },
            { key: 'metallicBobbinsWeight', label: 'Bobbin Weight' },
            { key: 'yarnKg', label: 'Yarn Weight' },
            { key: 'yarnName', label: 'Yarn Name' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
            { key: 'twistName', label: 'Twist Name' },
            { key: 'cutName', label: 'Cut Name' },
        ]
    },
    issue_to_coning_machine_created: {
        note: 'Triggered when material is issued to a Coning machine.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'date', label: 'Date' },
            { key: 'rollsIssued', label: 'Rolls' },
            { key: 'requiredPerConeNetWeight', label: 'Target Cone Wt' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
            { key: 'cutName', label: 'Cut Name' },
            { key: 'twistName', label: 'Twist Name' },
            { key: 'yarnName', label: 'Yarn Name' },
        ]
    },
    issue_to_cutter_machine_takeback_created: {
        note: 'Triggered when issued material is taken back from a Cutter machine issue.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'issueBarcode', label: 'Issue Barcode' },
            { key: 'date', label: 'Date' },
            { key: 'totalCount', label: 'Taken Back Count' },
            { key: 'totalWeight', label: 'Taken Back Weight' },
            { key: 'reason', label: 'Reason' },
            { key: 'note', label: 'Note' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
        ]
    },
    issue_to_holo_machine_takeback_created: {
        note: 'Triggered when issued material is taken back from a Holo machine issue.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'issueBarcode', label: 'Issue Barcode' },
            { key: 'date', label: 'Date' },
            { key: 'totalCount', label: 'Taken Back Count' },
            { key: 'totalWeight', label: 'Taken Back Weight' },
            { key: 'reason', label: 'Reason' },
            { key: 'note', label: 'Note' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
        ]
    },
    issue_to_coning_machine_takeback_created: {
        note: 'Triggered when issued material is taken back from a Coning machine issue.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'issueBarcode', label: 'Issue Barcode' },
            { key: 'date', label: 'Date' },
            { key: 'totalCount', label: 'Taken Back Count' },
            { key: 'totalWeight', label: 'Taken Back Weight' },
            { key: 'reason', label: 'Reason' },
            { key: 'note', label: 'Note' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
        ]
    },
    issue_to_cutter_machine_takeback_reversed: {
        note: 'Triggered when a Cutter machine take-back entry is reversed.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'issueBarcode', label: 'Issue Barcode' },
            { key: 'date', label: 'Date' },
            { key: 'totalCount', label: 'Reversed Count' },
            { key: 'totalWeight', label: 'Reversed Weight' },
            { key: 'reason', label: 'Reason' },
            { key: 'note', label: 'Note' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
        ]
    },
    issue_to_holo_machine_takeback_reversed: {
        note: 'Triggered when a Holo machine take-back entry is reversed.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'issueBarcode', label: 'Issue Barcode' },
            { key: 'date', label: 'Date' },
            { key: 'totalCount', label: 'Reversed Count' },
            { key: 'totalWeight', label: 'Reversed Weight' },
            { key: 'reason', label: 'Reason' },
            { key: 'note', label: 'Note' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
        ]
    },
    issue_to_coning_machine_takeback_reversed: {
        note: 'Triggered when a Coning machine take-back entry is reversed.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'issueBarcode', label: 'Issue Barcode' },
            { key: 'date', label: 'Date' },
            { key: 'totalCount', label: 'Reversed Count' },
            { key: 'totalWeight', label: 'Reversed Weight' },
            { key: 'reason', label: 'Reason' },
            { key: 'note', label: 'Note' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
        ]
    },
    receive_from_cutter_machine_created: {
        note: 'Triggered when a piece is received from a Cutter machine (Manual or Bulk).',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'date', label: 'Date' },
            { key: 'netWeight', label: 'Net Weight' },
            { key: 'bobbinQuantity', label: 'Bobbins' },
            { key: 'operatorName', label: 'Operator' },
            { key: 'challanNo', label: 'Challan No' },
        ]
    },
    receive_from_holo_machine_created: {
        note: 'Triggered when material is received from a Holo machine.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'date', label: 'Date' },
            { key: 'netWeight', label: 'Net Weight' },
            { key: 'rollCount', label: 'Rolls' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
            { key: 'barcode', label: 'Barcode' },
            { key: 'cutName', label: 'Cut Name' },
            { key: 'twistName', label: 'Twist Name' },
            { key: 'yarnName', label: 'Yarn Name' },
        ]
    },
    receive_from_coning_machine_created: {
        note: 'Triggered when material is received from a Coning machine.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'date', label: 'Date' },
            { key: 'netWeight', label: 'Net Weight' },
            { key: 'coneCount', label: 'Cones' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
            { key: 'barcode', label: 'Barcode' },
            { key: 'cutName', label: 'Cut Name' },
            { key: 'twistName', label: 'Twist Name' },
            { key: 'yarnName', label: 'Yarn Name' },
        ]
    },
    piece_wastage_marked_cutter: {
        note: 'Triggered when a piece is marked as wastage in the Cutter process.',
        variables: [
            { key: 'pieceId', label: 'Piece ID' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'itemName', label: 'Item Name' },
            { key: 'wastage', label: 'Wastage (kg)' },
            { key: 'wastagePercent', label: 'Wastage %' },
        ]
    },
    piece_wastage_marked_holo: {
        note: 'Triggered when a piece is marked as wastage in the Holo process.',
        variables: [
            { key: 'pieceId', label: 'Piece ID' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'itemName', label: 'Item Name' },
            { key: 'wastage', label: 'Wastage (kg)' },
            { key: 'wastagePercent', label: 'Wastage %' },
        ]
    },
    piece_wastage_marked_coning: {
        note: 'Triggered when a piece is marked as wastage in the Coning process.',
        variables: [
            { key: 'pieceId', label: 'Piece ID' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'itemName', label: 'Item Name' },
            { key: 'wastage', label: 'Wastage (kg)' },
            { key: 'wastagePercent', label: 'Wastage %' },
        ]
    },
    item_out_of_stock: {
        note: 'Triggered when available stock for an item falls to zero.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'available', label: 'Available Weight' },
        ]
    },
    lot_deleted: {
        note: 'Triggered when an entire lot is deleted.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'totalPieces', label: 'Total Pieces' },
            { key: 'date', label: 'Date' },
        ]
    },
    inbound_piece_deleted: {
        note: 'Triggered when a single piece is deleted from an inbound lot.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'pieceId', label: 'Piece ID' },
        ]
    },
    issue_to_cutter_machine_deleted: {
        note: 'Triggered when a Cutter machine issue record is deleted.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'date', label: 'Date' },
            { key: 'count', label: 'Pieces Count' },
            { key: 'totalWeight', label: 'Total Weight' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
        ]
    },
    issue_to_holo_machine_deleted: {
        note: 'Triggered when a Holo machine issue record is deleted.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'date', label: 'Date' },
            { key: 'metallicBobbins', label: 'Bobbins' },
            { key: 'metallicBobbinsWeight', label: 'Bobbin Weight' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
        ]
    },
    issue_to_coning_machine_deleted: {
        note: 'Triggered when a Coning machine issue record is deleted.',
        variables: [
            { key: 'itemName', label: 'Item Name' },
            { key: 'lotNo', label: 'Lot No' },
            { key: 'date', label: 'Date' },
            { key: 'rollsIssued', label: 'Rolls' },
            { key: 'machineName', label: 'Machine' },
            { key: 'operatorName', label: 'Operator' },
        ]
    },
    backup_failed: {
        note: 'Triggered when a system backup attempt fails.',
        variables: [
            { key: 'time', label: 'Time (ISO)' },
            { key: 'type', label: 'Backup Type' },
            { key: 'filename', label: 'Filename' },
            { key: 'error', label: 'Error Message' },
            { key: 'host', label: 'Host' },
        ]
    },
    documents_send: {
        note: 'Used by Send Documents. Manage WhatsApp groups and Telegram chat routing for document sends here.',
        variables: [
            { key: 'filename', label: 'Filename' },
            { key: 'customerName', label: 'Customer Name' },
            { key: 'phone', label: 'Direct Phone (if provided)' },
            { key: 'caption', label: 'Caption from Send Documents form' },
            { key: 'mimetype', label: 'File MIME type' },
            { key: 'fileSize', label: 'File size (bytes)' },
        ]
    }
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
    const isAdmin = user?.isAdmin || (user?.roleKeys || []).includes('admin');
    const { canRead, canEdit } = usePermission('settings');
    const isReadOnly = canRead && !canEdit;
    const [groups, setGroups] = useState([]);
    const [whatsappStatus, setWhatsappStatus] = useState({ status: 'disconnected' });
    const [whatsappQr, setWhatsappQr] = useState(null);
    const [telegramStatus, setTelegramStatus] = useState({ status: 'disconnected' });
    const groupsRequestedRef = useRef(false);

    useEffect(() => {
        let mounted = true;
        async function loadStatus() {
            try {
                const s = await api.whatsappStatus();
                if (!mounted) return;
                setWhatsappStatus(s);
                try {
                    const t = await api.telegramStatus();
                    if (mounted) setTelegramStatus(t || { status: 'disconnected' });
                } catch (_) {
                    if (mounted) setTelegramStatus({ status: 'disconnected' });
                }
                if (s.status === 'qr') {
                    const q = await api.whatsappQr();
                    if (mounted) setWhatsappQr(q.qr || null);
                } else {
                    if (mounted) {
                        setWhatsappQr(null);
                        // Load groups once per connected session unless explicitly refreshed
                        if (s.status === 'connected' && groups.length === 0 && !groupsRequestedRef.current) {
                            groupsRequestedRef.current = true;
                            const g = await api.whatsappGroups();
                            if (mounted) setGroups(g || []);
                        } else if (s.status !== 'connected') {
                            groupsRequestedRef.current = false;
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to auto-load WhatsApp status in Settings', e);
            }
        }
        loadStatus();
        const interval = setInterval(loadStatus, 5000);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [groups.length]);

    if (!canRead) {
        return (
            <div className="space-y-6 fade-in">
                <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
                <AccessDenied message="You do not have access to Settings. Contact an administrator." />
            </div>
        );
    }

    return (
        <div className="flex flex-col md:flex-row gap-6 fade-in items-start">
            <Card className="hidden md:block w-full md:w-64 shrink-0">
                <CardHeader>
                    <CardTitle className="text-lg">Settings</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <nav className="flex flex-col">
                        <button onClick={() => setActiveTab('whatsapp')} className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 ${activeTab === 'whatsapp' ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}>
                            <MessageSquare className="w-4 h-4" /> Notifications
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
                        <button onClick={() => setActiveTab('backup')} className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 ${activeTab === 'backup' ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}>
                            <HardDrive className="w-4 h-4" /> Backup
                        </button>
                        <button onClick={() => setActiveTab('challan')} className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 ${activeTab === 'challan' ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}>
                            <FileText className="w-4 h-4" /> Challan Settings
                        </button>
                        <button
                            onClick={() => { if (!isReadOnly) navigate('/app/settings/label-designer'); }}
                            disabled={isReadOnly}
                            className={`px-4 py-3 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 flex items-center gap-2 border-transparent text-muted-foreground ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                {/* Mobile Section Picker */}
                <div className="md:hidden">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">Settings</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Section</Label>
                                <select
                                    value={activeTab}
                                    onChange={(e) => setActiveTab(e.target.value)}
                                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <option value="whatsapp">Notifications</option>
                                    <option value="templates">Message Templates</option>
                                    <option value="branding">Branding & System</option>
                                    <option value="data">Raw Data</option>
                                    <option value="backup">Backup</option>
                                    <option value="challan">Challan Settings</option>
                                    {isAdmin ? <option value="users">Users & Roles</option> : null}
                                </select>
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => { if (!isReadOnly) navigate('/app/settings/label-designer'); }}
                                    disabled={isReadOnly}
                                >
                                    <Printer className="w-4 h-4 mr-2" /> Label Designer
                                </Button>
                                <Button type="button" variant="outline" className="flex-1" onClick={logout}>
                                    <LogOut className="w-4 h-4 mr-2" /> Logout
                                </Button>
                            </div>

                            {isReadOnly ? (
                                <div className="text-xs text-muted-foreground">
                                    Read-only access: you can view settings but cannot save changes.
                                </div>
                            ) : null}
                        </CardContent>
                    </Card>
                </div>

                {isReadOnly && (
                    <div className="text-sm text-muted-foreground">
                        Read-only access: you can view settings but cannot save changes.
                    </div>
                )}
                <Card>
                    <CardContent className="pt-6 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                        <div className="text-sm">
                            <span className="text-muted-foreground">Signed in as </span>
                            <span className="font-medium">{user?.displayName || user?.username || '—'}</span>
                            {/* role is shown elsewhere; avoid duplicating it here */}
                        </div>
                        <Button variant="outline" onClick={logout} className="hidden md:inline-flex">
                            <LogOut className="w-4 h-4 mr-2" /> Logout
                        </Button>
                    </CardContent>
                </Card>
                {activeTab === 'whatsapp' && (
                    <WhatsAppSettings
                        db={db}
                        refreshDb={refreshDb}
                        updateSettings={updateSettings}
                        groups={groups}
                        setGroups={setGroups}
                        whatsappStatus={whatsappStatus}
                        setWhatsappStatus={setWhatsappStatus}
                        whatsappQr={whatsappQr}
                        setWhatsappQr={setWhatsappQr}
                        resetWhatsappGroupsFetch={() => { groupsRequestedRef.current = false; setGroups([]); }}
                        telegramStatus={telegramStatus}
                        setTelegramStatus={setTelegramStatus}
                        readOnly={isReadOnly}
                        isAdmin={isAdmin}
                    />
                )}
                {activeTab === 'templates' && (
                    <MessageTemplates
                        db={db}
                        groups={groups}
                        setGroups={setGroups}
                        whatsappStatus={whatsappStatus}
                        readOnly={isReadOnly}
                    />
                )}
                {activeTab === 'branding' && <BrandingSettings brand={brand} updateSettings={updateSettings} refreshDb={refreshDb} readOnly={isReadOnly} />}
                {activeTab === 'data' && <RawDataView db={db} />}
                {activeTab === 'backup' && <BackupSettings isAdmin={isAdmin} db={db} updateSettings={updateSettings} readOnly={isReadOnly} />}
                {activeTab === 'challan' && <ChallanSettings db={db} updateSettings={updateSettings} refreshDb={refreshDb} readOnly={isReadOnly} />}
                {activeTab === 'users' && <UserManagement />}
            </div>
        </div>
    );
}

function MessageTemplates({ db, groups, setGroups, whatsappStatus, readOnly }) {
    const isReadOnly = !!readOnly;
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState(null); // { event, template, enabled, sendToPrimary, groupIds }
    const [searchQuery, setSearchQuery] = useState('');
    const textareaRef = useRef(null);
    const [mention, setMention] = useState({
        open: false,
        query: '',
        start: -1,
        caret: 0
    });
    const [mentionIndex, setMentionIndex] = useState(0);
    const settingsTelegramChatIds = Array.isArray(db?.settings?.[0]?.telegramChatIds)
        ? db.settings[0].telegramChatIds
        : [];
    const [telegramChatInfoMap, setTelegramChatInfoMap] = useState({});

    const eventVariables = editing ? (WHATSAPP_EVENTS_CONFIG[editing.event]?.variables || []) : [];

    useEffect(() => {
        load();
        if (groups.length === 0 && whatsappStatus?.status === 'connected') {
            loadGroups();
        }
    }, [whatsappStatus?.status]);

    useEffect(() => {
        let mounted = true;
        async function resolveTelegramChats() {
            if (!Array.isArray(settingsTelegramChatIds) || settingsTelegramChatIds.length === 0) {
                if (mounted) setTelegramChatInfoMap({});
                return;
            }
            try {
                const response = await api.telegramResolveChats(settingsTelegramChatIds);
                if (!mounted) return;
                const map = {};
                (response?.items || []).forEach((item) => {
                    if (item?.chatId) map[item.chatId] = item;
                });
                setTelegramChatInfoMap(map);
            } catch (_) {
                if (mounted) setTelegramChatInfoMap({});
            }
        }
        resolveTelegramChats();
        return () => { mounted = false; };
    }, [settingsTelegramChatIds.join(',')]);

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
        if (isReadOnly) return;
        if (!editing) return;
        try {
            // Only keep group IDs that are currently valid/accessible
            const validGroupIds = (editing.groupIds || []).filter(gid =>
                groups.some(g => g.id === gid)
            );

            await api.updateWhatsappTemplate(editing.event, {
                template: editing.template,
                enabled: editing.enabled,
                sendToPrimary: editing.sendToPrimary,
                groupIds: validGroupIds,
                telegramChatIds: editing.telegramChatIds || []
            });
            setEditing(null);
            load();
            alert('Template updated');
        } catch (e) {
            alert(e.message);
        }
    }

    const toggleGroup = (groupId) => {
        if (!editing || isReadOnly) return;
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
        if (isReadOnly) return;
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
        if (isReadOnly) return;
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
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by event or content..."
                            className="pl-10"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    {loading && <div className="text-sm text-muted-foreground">Loading...</div>}
                    {!loading && templates.length === 0 && <div className="text-sm text-muted-foreground">No templates found.</div>}
                    {!loading && templates.length > 0 && searchQuery && templates.filter(t =>
                        t.event.toLowerCase().replace(/_/g, ' ').includes(searchQuery.toLowerCase()) ||
                        t.template.toLowerCase().includes(searchQuery.toLowerCase())
                    ).length === 0 && (
                            <div className="text-sm text-muted-foreground py-8 text-center border rounded-md border-dashed">
                                No templates matching "{searchQuery}"
                            </div>
                        )}

                    <div className="grid gap-4">
                        {templates
                            .filter(t =>
                                t.event.toLowerCase().replace(/_/g, ' ').includes(searchQuery.toLowerCase()) ||
                                t.template.toLowerCase().includes(searchQuery.toLowerCase())
                            )
                            .map(t => {
                                const primaryNumber = db?.settings?.[0]?.whatsappNumber;
                                const assignedGroups = (t.groupIds || [])
                                    .map(gid => {
                                        const g = groups.find(x => x.id === gid);
                                        if (g) return { id: gid, name: g.name };
                                        if (groups.length === 0) return { id: gid, name: 'Loading...' };
                                        return null;
                                    })
                                    .filter(Boolean);

                                return (
                                    <div key={t.event} className={`border p-4 rounded-md space-y-2 ${!t.enabled ? 'opacity-50 grayscale bg-muted/20' : ''}`}>
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-medium capitalize">{t.event.replace(/_/g, ' ')}</h4>
                                                {!t.enabled && <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground uppercase font-bold">Disabled</span>}
                                            </div>
                                            <Button variant="outline" size="sm" onClick={() => setEditing(t)} disabled={isReadOnly}>Edit</Button>
                                        </div>
                                        {WHATSAPP_EVENTS_CONFIG[t.event]?.note && (
                                            <p className="text-[11px] text-primary/80 font-medium italic bg-primary/5 p-2 rounded border-l-2 border-primary">
                                                Note: {WHATSAPP_EVENTS_CONFIG[t.event].note}
                                            </p>
                                        )}
                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{t.template}</p>

                                        {(t.sendToPrimary || assignedGroups.length > 0 || (t.telegramChatIds || []).length > 0) && (
                                            <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-muted/50">
                                                {t.sendToPrimary && primaryNumber && (
                                                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-600 dark:bg-blue-700 text-white rounded-md text-[11px] font-bold shadow-sm border border-blue-700 dark:border-blue-800">
                                                        <Smartphone className="w-3.5 h-3.5 text-white/90" />
                                                        <span>+{primaryNumber}</span>
                                                    </div>
                                                )}
                                                {whatsappStatus?.status === 'connected' && assignedGroups.map(group => (
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
                                                {(t.telegramChatIds || []).map(chatId => {
                                                    const chatInfo = telegramChatInfoMap[chatId];
                                                    const label = chatInfo?.displayName || chatId;
                                                    return (
                                                    <div key={chatId} className="flex items-center gap-1.5 px-2.5 py-1 bg-sky-600 text-white rounded-md text-[11px] font-bold shadow-sm border border-sky-700">
                                                        <MessageSquare className="w-3.5 h-3.5 text-white/90" />
                                                        <span className="max-w-[220px] truncate">TG: {label} ({chatId})</span>
                                                    </div>
                                                    );
                                                })}
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
                                            disabled={isReadOnly}
                                        />
                                        <span className="text-sm font-medium">Enabled</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={editing.sendToPrimary}
                                            onChange={e => setEditing({ ...editing, sendToPrimary: e.target.checked })}
                                            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                            disabled={isReadOnly}
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
                                            disabled={isReadOnly}
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
                                    <p className="text-[10px] text-muted-foreground">Use tagging syntax (e.g., <b>@variableName</b>) for dynamic data.</p>
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
                                                        disabled={isReadOnly}
                                                    />
                                                    <span className="text-sm truncate">{g.name}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label>Send to Telegram Chat IDs</Label>
                                    {settingsTelegramChatIds.length === 0 ? (
                                        <p className="text-xs text-muted-foreground italic bg-muted/30 p-2 rounded">
                                            No Telegram chat IDs configured in Notification Settings.
                                        </p>
                                    ) : (
                                        <div className="border rounded-md divide-y max-h-[180px] overflow-y-auto">
                                            {settingsTelegramChatIds.map(chatId => {
                                                const chatInfo = telegramChatInfoMap[chatId];
                                                const label = chatInfo?.displayName || chatId;
                                                return (
                                                <label key={chatId} className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer transition-colors">
                                                    <input
                                                        type="checkbox"
                                                        checked={(editing.telegramChatIds || []).includes(chatId)}
                                                        onChange={() => {
                                                            const current = editing.telegramChatIds || [];
                                                            if (current.includes(chatId)) {
                                                                setEditing({ ...editing, telegramChatIds: current.filter(id => id !== chatId) });
                                                            } else {
                                                                setEditing({ ...editing, telegramChatIds: [...current, chatId] });
                                                            }
                                                        }}
                                                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                                        disabled={isReadOnly}
                                                    />
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-sm truncate">{label}</span>
                                                        <span className="text-[11px] text-muted-foreground truncate">{chatId}</span>
                                                    </div>
                                                </label>
                                                );
                                            })}
                                        </div>
                                    )}
                                    <p className="text-[10px] text-muted-foreground">
                                        Mandatory for Telegram: select one or more chat IDs for this template, or Telegram will not send for this event.
                                    </p>
                                </div>

                                <div className="flex justify-end gap-2 pt-2 border-t mt-4">
                                    <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                                    <Button onClick={handleSave} disabled={isReadOnly}>Save Changes</Button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function WhatsAppSettings({
    db,
    refreshDb,
    updateSettings,
    groups,
    setGroups,
    whatsappStatus,
    setWhatsappStatus,
    whatsappQr,
    setWhatsappQr,
    resetWhatsappGroupsFetch,
    telegramStatus,
    setTelegramStatus,
    readOnly,
    isAdmin
}) {
    const isReadOnly = !!readOnly;
    const isAdminUser = !!isAdmin;
    const canManageConnection = isAdminUser && !isReadOnly;
    const [working, setWorking] = useState(false);
    const [testingTelegram, setTestingTelegram] = useState(false);
    const [whatsappEnabled, setWhatsappEnabled] = useState(true);
    const [primaryMobile, setPrimaryMobile] = useState('');
    const [allowedGroupIds, setAllowedGroupIds] = useState([]);
    const [telegramEnabled, setTelegramEnabled] = useState(false);
    const [telegramBotToken, setTelegramBotToken] = useState('');
    const [telegramChatIds, setTelegramChatIds] = useState([]);
    const [telegramChatIdInput, setTelegramChatIdInput] = useState('');
    const [telegramChatInfoMap, setTelegramChatInfoMap] = useState({});
    const [resolvingTelegramChats, setResolvingTelegramChats] = useState(false);

    useEffect(() => {
        const settings = db?.settings?.[0];
        const num = settings?.whatsappNumber || '';
        setWhatsappEnabled(settings?.whatsappEnabled !== false);
        setPrimaryMobile(num ? String(num).replace(/^91/, '') : '');
        setAllowedGroupIds(settings?.whatsappGroupIds || []);
        setTelegramEnabled(settings?.telegramEnabled === true);
        setTelegramBotToken((prev) => {
            const incoming = settings?.telegramBotToken;
            if (incoming === '********') return prev;
            return incoming || '';
        });
        setTelegramChatIds(Array.isArray(settings?.telegramChatIds) ? settings.telegramChatIds : []);
    }, [db]);

    useEffect(() => {
        let mounted = true;
        async function resolveTelegramChats() {
            if (!Array.isArray(telegramChatIds) || telegramChatIds.length === 0) {
                if (mounted) setTelegramChatInfoMap({});
                return;
            }
            setResolvingTelegramChats(true);
            try {
                const response = await api.telegramResolveChats(telegramChatIds);
                if (!mounted) return;
                const map = {};
                (response?.items || []).forEach((item) => {
                    if (item?.chatId) map[item.chatId] = item;
                });
                setTelegramChatInfoMap(map);
            } catch (_) {
                if (mounted) setTelegramChatInfoMap({});
            } finally {
                if (mounted) setResolvingTelegramChats(false);
            }
        }
        resolveTelegramChats();
        return () => { mounted = false; };
    }, [telegramChatIds.join(',')]);

    const isConnected = whatsappStatus.status === 'connected';
    const isTelegramConnected = telegramStatus?.status === 'connected';

    const handleConnect = async () => {
        if (!canManageConnection) return;
        setWorking(true);
        try {
            await api.whatsappStart();
            const q = await api.whatsappQr();
            setWhatsappQr(q.qr || null);
        } finally { setWorking(false); }
    };

    const handleLogout = async () => {
        if (!canManageConnection) return;
        setWorking(true);
        try {
            await api.whatsappLogout();
            setWhatsappQr(null);
            setWhatsappStatus({ status: 'disconnected' });
            setGroups([]);
        } finally { setWorking(false); }
    };

    const handleRefreshGroups = () => {
        if (!canManageConnection) return;
        if (typeof resetWhatsappGroupsFetch === 'function') {
            resetWhatsappGroupsFetch();
            return;
        }
        setGroups([]);
    };

    const handleTelegramTest = async () => {
        if (isReadOnly || testingTelegram) return;
        const firstChatId = telegramChatIds[0];
        if (!firstChatId) {
            alert('Enter at least one Telegram chat ID before sending test message.');
            return;
        }
        setTestingTelegram(true);
        try {
            await api.telegramSendTest(firstChatId);
            const refreshed = await api.telegramStatus();
            setTelegramStatus(refreshed || { status: 'disconnected' });
            alert('Telegram test message sent.');
        } catch (e) {
            alert(e.message || 'Failed to send Telegram test message');
        } finally {
            setTestingTelegram(false);
        }
    };

    const handleSaveSettings = async () => {
        if (isReadOnly) return;
        setWorking(true);
        try {
            const validGroupIds = groups.length > 0
                ? allowedGroupIds.filter(id => groups.some(g => g.id === id))
                : allowedGroupIds;

            const payload = {
                whatsappEnabled,
                whatsappNumber: primaryMobile,
                whatsappGroupIds: validGroupIds,
                telegramEnabled,
                telegramChatIds,
            };
            if (telegramBotToken.trim()) {
                payload.telegramBotToken = telegramBotToken.trim();
            }
            await updateSettings(payload);
            const refreshed = await api.telegramStatus();
            setTelegramStatus(refreshed || { status: 'disconnected' });
            alert('Notification settings saved');
            refreshDb();
        } catch (e) { alert(e.message); } finally { setWorking(false); }
    };

    const toggleAllowedGroup = (id) => {
        if (isReadOnly) return;
        if (allowedGroupIds.includes(id)) {
            setAllowedGroupIds(allowedGroupIds.filter(x => x !== id));
        } else {
            setAllowedGroupIds([...allowedGroupIds, id]);
        }
    };

    const handleAddTelegramChatId = async () => {
        if (isReadOnly) return;
        const chatId = String(telegramChatIdInput || '').trim();
        if (!chatId) return;
        if (telegramChatIds.includes(chatId)) {
            setTelegramChatIdInput('');
            return;
        }
        setTelegramChatIds([...telegramChatIds, chatId]);
        setTelegramChatIdInput('');
    };

    const handleRemoveTelegramChatId = (chatId) => {
        if (isReadOnly) return;
        setTelegramChatIds(telegramChatIds.filter((id) => id !== chatId));
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Connection Status</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-md border p-3">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                                <div className="flex flex-col">
                                    <span className="font-medium">WhatsApp: {whatsappStatus.status === 'qr' ? 'scan qr' : whatsappStatus.status}</span>
                                    {whatsappStatus.mobile ? <span className="text-xs text-muted-foreground">+{whatsappStatus.mobile}</span> : null}
                                </div>
                            </div>
                        </div>
                        <div className="rounded-md border p-3">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${isTelegramConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                                <div className="flex flex-col">
                                    <span className="font-medium">Telegram: {telegramStatus?.status || 'disconnected'}</span>
                                    {telegramStatus?.lastError ? <span className="text-xs text-muted-foreground truncate">{telegramStatus.lastError}</span> : null}
                                </div>
                            </div>
                        </div>
                    </div>

                    {isAdminUser ? (
                        <div className="flex gap-2 w-full sm:w-auto">
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleRefreshGroups}
                                disabled={!isConnected || working || !canManageConnection}
                                title="Refresh Groups"
                                className="flex-1 sm:flex-none"
                            >
                                <RefreshCw className={`w-4 h-4 ${working ? 'animate-spin' : ''}`} />
                            </Button>
                            <Button size="sm" onClick={handleConnect} disabled={working || isConnected || !canManageConnection} className="flex-1 sm:flex-none">
                                {working ? 'Working...' : isConnected ? 'Reconnect' : 'Connect'}
                            </Button>
                            {isConnected ? (
                                <Button size="sm" variant="destructive" onClick={handleLogout} disabled={working || !canManageConnection} className="flex-1 sm:flex-none">
                                    <LogOut className="w-4 h-4 mr-2" /> Logout
                                </Button>
                            ) : null}
                        </div>
                    ) : (
                        <p className="text-[10px] text-muted-foreground italic">
                            Only administrators can manage WhatsApp connection.
                        </p>
                    )}
                    {whatsappQr ? (
                        <div className="mt-2 flex justify-center p-4 bg-white rounded-lg border">
                            <img src={whatsappQr} alt="QR Code" className="max-w-[200px]" />
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Notification Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-3">
                        <Label className="text-sm">Channel Toggles</Label>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <label className="flex items-center gap-2 border rounded-md p-3">
                                <input
                                    type="checkbox"
                                    checked={whatsappEnabled}
                                    onChange={e => setWhatsappEnabled(e.target.checked)}
                                    disabled={isReadOnly}
                                />
                                <span className="text-sm font-medium">Enable WhatsApp notifications</span>
                            </label>
                            <label className="flex items-center gap-2 border rounded-md p-3">
                                <input
                                    type="checkbox"
                                    checked={telegramEnabled}
                                    onChange={e => setTelegramEnabled(e.target.checked)}
                                    disabled={isReadOnly}
                                />
                                <span className="text-sm font-medium">Enable Telegram notifications</span>
                            </label>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Primary Mobile Number (10 digits)</Label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">+91</span>
                            <Input
                                className="pl-12"
                                value={primaryMobile}
                                onChange={e => setPrimaryMobile(e.target.value.replace(/\D/g, ''))}
                                placeholder="9876543210"
                                maxLength={10}
                                disabled={isReadOnly}
                            />
                        </div>
                        <p className="text-[10px] text-muted-foreground">Used for WhatsApp direct sends when WhatsApp is enabled.</p>
                    </div>

                    <div className="space-y-2">
                        <Label>Authorized WhatsApp Groups</Label>
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
                                            disabled={isReadOnly}
                                        />
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium truncate">{g.name}</span>
                                            <span className="text-[10px] text-muted-foreground truncate opacity-70">{g.id}</span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}
                        <p className="text-[10px] text-muted-foreground">Only selected groups can receive template-driven WhatsApp notifications.</p>
                    </div>

                    <div className="space-y-2">
                        <Label>Telegram Bot Token</Label>
                        <Input
                            type="password"
                            value={telegramBotToken}
                            onChange={e => setTelegramBotToken(e.target.value)}
                            placeholder="123456789:AA..."
                            disabled={isReadOnly}
                        />
                        <p className="text-[10px] text-muted-foreground">
                            Required only when Telegram notifications are enabled.
                            {telegramStatus?.hasBotToken ? ' A token is already configured.' : ''}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label>Telegram Chat IDs</Label>
                        <div className="flex gap-2">
                            <Input
                                value={telegramChatIdInput}
                                onChange={(e) => setTelegramChatIdInput(e.target.value)}
                                placeholder="Paste chat ID (e.g. -1001234567890)"
                                disabled={isReadOnly}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleAddTelegramChatId}
                                disabled={isReadOnly || !telegramChatIdInput.trim()}
                            >
                                Add
                            </Button>
                        </div>
                        <div className="border rounded-md divide-y max-h-[220px] overflow-y-auto">
                            {telegramChatIds.length === 0 ? (
                                <div className="p-3 text-xs text-muted-foreground">No Telegram chats added yet.</div>
                            ) : (
                                telegramChatIds.map((chatId) => {
                                    const info = telegramChatInfoMap[chatId];
                                    const label = info?.displayName || (resolvingTelegramChats ? 'Resolving...' : chatId);
                                    return (
                                        <div key={chatId} className="flex items-center justify-between gap-3 p-3">
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium truncate">{label}</p>
                                                <p className="text-[11px] text-muted-foreground truncate">{chatId}</p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleRemoveTelegramChatId(chatId)}
                                                disabled={isReadOnly}
                                            >
                                                Remove
                                            </Button>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                        <div className="flex justify-between items-center">
                            <p className="text-[10px] text-muted-foreground">Messages are sent to all listed chats when Telegram is enabled.</p>
                            <Button type="button" size="sm" variant="outline" onClick={handleTelegramTest} disabled={isReadOnly || testingTelegram}>
                                {testingTelegram ? 'Testing...' : 'Send Telegram Test'}
                            </Button>
                        </div>
                    </div>

                    <Button className="w-full" onClick={handleSaveSettings} disabled={working || isReadOnly}>
                        <Save className="w-4 h-4 mr-2" /> Save Notification Settings
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}

function BrandingSettings({ brand, updateSettings, refreshDb, readOnly }) {
    const isReadOnly = !!readOnly;
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
        if (isReadOnly) return;
        setSaving(true);
        try {
            await updateSettings(localBrand);
            alert('Branding updated');
        } catch (e) { alert(e.message); } finally { setSaving(false); }
    };

    const handleLogo = (e) => {
        if (isReadOnly) return;
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setLocalBrand(p => ({ ...p, logoDataUrl: reader.result }));
        reader.readAsDataURL(file);
    };

    const handleFavicon = (e) => {
        if (isReadOnly) return;
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <Label>Primary Color (Hex)</Label>
                            <Input value={localBrand.primary} onChange={e => setLocalBrand({ ...localBrand, primary: e.target.value })} disabled={isReadOnly} />
                        </div>
                        <div>
                            <Label>Accent Color (Hex)</Label>
                            <Input value={localBrand.gold} onChange={e => setLocalBrand({ ...localBrand, gold: e.target.value })} disabled={isReadOnly} />
                        </div>
                    </div>
                    <div>
                        <Label>Logo</Label>
                        <div className="flex items-center gap-4 mt-2">
                            <div className="h-16 w-16 border rounded-md flex items-center justify-center overflow-hidden bg-muted">
                                {localBrand.logoDataUrl ? <img src={localBrand.logoDataUrl} className="h-full w-full object-contain" /> : <span className="text-xs text-muted-foreground">No Logo</span>}
                            </div>
                            <div>
                                <Button variant="outline" onClick={() => logoInputRef.current?.click()} disabled={isReadOnly}><Upload className="w-4 h-4 mr-2" /> Upload</Button>
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
                                <Button variant="outline" onClick={() => faviconInputRef.current?.click()} disabled={isReadOnly}><Upload className="w-4 h-4 mr-2" /> Upload</Button>
                                <input ref={faviconInputRef} type="file" className="hidden" accept="image/*" onChange={handleFavicon} />
                            </div>
                        </div>
                    </div>
                    <Button onClick={handleSave} disabled={saving || isReadOnly}><Save className="w-4 h-4 mr-2" /> Save Branding</Button>
                </CardContent>
            </Card>
        </div>
    );
}

function BackupSettings({ isAdmin, db, updateSettings, readOnly }) {
    const isReadOnly = !!readOnly;
    const [backups, setBackups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [diskUsage, setDiskUsage] = useState(null);
    const [driveStatus, setDriveStatus] = useState({ loading: true, connected: false, configured: true });
    const [connectingDrive, setConnectingDrive] = useState(false);
    const [disconnectingDrive, setDisconnectingDrive] = useState(false);
    const [driveFiles, setDriveFiles] = useState([]);
    const [driveFilesLoading, setDriveFilesLoading] = useState(false);
    const [driveFilesError, setDriveFilesError] = useState('');
    const [backupTime, setBackupTime] = useState('03:00');
    const [currentBackupTime, setCurrentBackupTime] = useState('03:00');
    const [savingSchedule, setSavingSchedule] = useState(false);
    const [activeTab, setActiveTab] = useState('server');

    const settingsBackupTime = db?.settings?.[0]?.backupTime || '03:00';

    useEffect(() => {
        loadBackups();
        loadDiskUsage();
        if (isAdmin) {
            loadDriveStatus();
        }
    }, [isAdmin]);

    useEffect(() => {
        setCurrentBackupTime(settingsBackupTime);
        setBackupTime(settingsBackupTime);
    }, [settingsBackupTime]);

    useEffect(() => {
        if (!isAdmin || activeTab !== 'drive') return;
        loadDriveStatus();
        loadDriveFiles();
    }, [isAdmin, activeTab]);

    async function loadBackups() {
        setLoading(true);
        try {
            const res = await api.listBackups();
            setBackups(res?.backups || []);
        } catch (err) {
            console.error('Failed to load backups', err);
        } finally {
            setLoading(false);
        }
    }

    async function loadDiskUsage() {
        try {
            const res = await api.getDiskUsage();
            setDiskUsage(res);
        } catch (err) {
            console.error('Failed to load disk usage', err);
        }
    }

    async function loadDriveStatus() {
        try {
            setDriveStatus(prev => ({ ...prev, loading: true }));
            const res = await api.googleDriveStatus();
            setDriveStatus({ loading: false, ...res });
        } catch (err) {
            console.error('Failed to load Google Drive status', err);
            setDriveStatus({ loading: false, connected: false, configured: true, error: err.message || 'Failed to load status' });
        }
    }

    async function loadDriveFiles() {
        setDriveFilesLoading(true);
        setDriveFilesError('');
        try {
            const res = await api.googleDriveFiles();
            const files = res?.connected ? (res?.files || []) : [];
            setDriveFiles(files);
            if (res?.folderUrl) {
                setDriveStatus(prev => ({ ...prev, folderUrl: res.folderUrl }));
            }
        } catch (err) {
            console.error('Failed to load Google Drive files', err);
            setDriveFilesError(err.message || 'Failed to load Google Drive backups');
            setDriveFiles([]);
        } finally {
            setDriveFilesLoading(false);
        }
    }

    async function handleCreateBackup() {
        if (isReadOnly) return;
        if (creating) return;
        setCreating(true);
        try {
            await api.createBackup();
            alert('Backup created successfully');
            loadBackups();
        } catch (err) {
            alert(err.message || 'Failed to create backup');
        } finally {
            setCreating(false);
        }
    }

    async function handleConnectDrive() {
        if (isReadOnly) return;
        if (connectingDrive) return;
        setConnectingDrive(true);
        try {
            const res = await api.googleDriveConnect();
            if (res?.authUrl) {
                window.open(res.authUrl, 'glintex-google-drive', 'width=520,height=680');
            } else {
                alert('Failed to start Google Drive connection');
            }
        } catch (err) {
            alert(err.message || 'Failed to connect Google Drive');
        } finally {
            setConnectingDrive(false);
        }
    }

    async function handleDisconnectDrive() {
        if (isReadOnly) return;
        if (disconnectingDrive) return;
        setDisconnectingDrive(true);
        try {
            await api.googleDriveDisconnect();
            await loadDriveStatus();
        } catch (err) {
            alert(err.message || 'Failed to disconnect Google Drive');
        } finally {
            setDisconnectingDrive(false);
        }
    }

    async function handleRefreshDrive() {
        await loadDriveStatus();
        await loadDriveFiles();
    }

    const driveLabel = driveStatus.connected ? 'Connected' : 'Not connected';
    const driveBadgeClass = driveStatus.connected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200' : 'bg-muted text-muted-foreground';
    const tabBaseClass = 'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors';
    const tabActiveClass = 'border-primary text-primary';
    const tabInactiveClass = 'border-transparent text-muted-foreground hover:text-foreground';
    const serverTabClass = `${tabBaseClass} ${activeTab === 'server' ? tabActiveClass : tabInactiveClass}`;
    const driveTabClass = `${tabBaseClass} ${activeTab === 'drive' ? tabActiveClass : tabInactiveClass}`;

    async function handleSaveSchedule() {
        if (!isAdmin || savingSchedule || isReadOnly) return;
        setSavingSchedule(true);
        try {
            await updateSettings({ backupTime });
            alert('Backup schedule updated');
        } catch (err) {
            alert(err.message || 'Failed to update backup schedule');
        } finally {
            setSavingSchedule(false);
        }
    }

    function formatTimeLabel(value) {
        const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
        if (!match) return value || '03:00';
        const hour = Number(match[1]);
        const minute = Number(match[2]);
        const hour12 = ((hour + 11) % 12) + 1;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        return `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${ampm}`;
    }

    function formatDate(isoString) {
        try {
            const date = new Date(isoString);
            return date.toLocaleString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            });
        } catch {
            return isoString;
        }
    }

    function formatBytes(value) {
        const bytes = Number(value);
        if (!Number.isFinite(bytes)) return '-';
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex += 1;
        }
        const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
        return `${size.toFixed(precision)} ${units[unitIndex]}`;
    }

    return (
        <div className="space-y-6">
            {/* Disk Space Alert */}
            {diskUsage?.alert && (
                <Card className={`border-2 ${diskUsage.critical ? 'border-red-500 bg-red-50 dark:bg-red-950' : 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950'}`}>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                            <AlertTriangle className={`w-6 h-6 ${diskUsage.critical ? 'text-red-500' : 'text-yellow-500'}`} />
                            <div>
                                <p className={`font-semibold ${diskUsage.critical ? 'text-red-700 dark:text-red-300' : 'text-yellow-700 dark:text-yellow-300'}`}>
                                    {diskUsage.critical ? 'Critical: ' : 'Warning: '}Disk space {diskUsage.usedPercent}% used
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {diskUsage.freeFormatted} free of {diskUsage.totalFormatted} total
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <CardTitle>Database Backups</CardTitle>
                    {isAdmin && (
                        <Button onClick={handleCreateBackup} disabled={creating || isReadOnly} size="sm" className="w-full sm:w-auto">
                            <Plus className="w-4 h-4 mr-2" />
                            {creating ? 'Creating...' : 'Create Backup'}
                        </Button>
                    )}
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="p-3 bg-muted/50 rounded-md border border-muted">
                        <p className="text-xs text-muted-foreground">
                            <strong>Automatic backups</strong> are created daily at {formatTimeLabel(currentBackupTime)} IST.
                            The system retains the last 3 days of backups automatically.
                        </p>
                    </div>

                    {isAdmin && (
                        <div className="space-y-2">
                            <Label>Auto backup time (IST)</Label>
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    type="time"
                                    value={backupTime}
                                    onChange={(e) => setBackupTime(e.target.value)}
                                    className="w-[140px]"
                                    disabled={isReadOnly}
                                />
                                <Button
                                    size="sm"
                                    onClick={handleSaveSchedule}
                                    disabled={savingSchedule || backupTime === currentBackupTime || isReadOnly}
                                >
                                    <Save className="w-4 h-4 mr-2" />
                                    {savingSchedule ? 'Saving...' : 'Save Time'}
                                </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground">Timezone: Asia/Kolkata (IST).</p>
                        </div>
                    )}

                    <div className="flex items-center gap-2 border-b">
                        <button type="button" className={serverTabClass} onClick={() => setActiveTab('server')}>
                            Server
                        </button>
                        {isAdmin && (
                            <button type="button" className={driveTabClass} onClick={() => setActiveTab('drive')}>
                                Google Drive
                            </button>
                        )}
                    </div>

                    {activeTab === 'server' && (
                        <div className="space-y-4">
                            {/* Disk usage summary (when not alerting) */}
                            {diskUsage && !diskUsage.alert && (
                                <div className="text-xs text-muted-foreground">
                                    Disk: {diskUsage.usedFormatted} used / {diskUsage.freeFormatted} free ({diskUsage.usedPercent}%)
                                </div>
                            )}

                            {loading ? (
                                <div className="text-sm text-muted-foreground py-4 text-center">Loading backups...</div>
                            ) : backups.length === 0 ? (
                                <div className="text-sm text-muted-foreground py-4 text-center">No backups available.</div>
                            ) : (
                                <div className="rounded-md border overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Filename</TableHead>
                                                <TableHead>Created</TableHead>
                                                <TableHead>Size</TableHead>
                                                <TableHead>Type</TableHead>
                                                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {backups.map((backup) => (
                                                <TableRow key={backup.filename}>
                                                    <TableCell className="font-mono text-xs">{backup.filename}</TableCell>
                                                    <TableCell className="whitespace-nowrap text-sm">{formatDate(backup.createdAt)}</TableCell>
                                                    <TableCell className="text-sm">{backup.sizeFormatted}</TableCell>
                                                    <TableCell>
                                                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${backup.type === 'auto' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'}`}>
                                                            {backup.type}
                                                        </span>
                                                    </TableCell>
                                                    {isAdmin && (
                                                        <TableCell className="text-right">
                                                            <a
                                                                href={api.downloadBackupUrl(backup.filename)}
                                                                download
                                                                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:underline"
                                                            >
                                                                <Download className="w-3 h-3" /> Download
                                                            </a>
                                                        </TableCell>
                                                    )}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}

                            {!isAdmin && (
                                <p className="text-[10px] text-muted-foreground italic text-center">
                                    Only administrators can create or download backups.
                                </p>
                            )}
                        </div>
                    )}

                    {activeTab === 'drive' && (
                        <div className="space-y-4">
                            {!isAdmin ? (
                                <p className="text-sm text-muted-foreground">Only administrators can access Google Drive backups.</p>
                            ) : (
                                <>
                                    <div className="space-y-3 rounded-md border p-4">
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <Cloud className="w-4 h-4 text-muted-foreground" />
                                                <h4 className="text-sm font-semibold">Google Drive</h4>
                                            </div>
                                            <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded inline-block w-fit ${driveBadgeClass}`}>
                                                {driveLabel}
                                            </span>
                                        </div>

                                        {!driveStatus.configured && (
                                            <div className="text-xs text-muted-foreground space-y-1">
                                                <p>Google Drive OAuth is not configured. Add the required env vars on the backend and restart the server.</p>
                                                {Array.isArray(driveStatus.missing) && driveStatus.missing.length > 0 && (
                                                    <p>Missing: {driveStatus.missing.join(', ')}</p>
                                                )}
                                            </div>
                                        )}

                                        {driveStatus.configured && driveStatus.connected && (
                                            <div className="text-xs text-muted-foreground space-y-1">
                                                <div>Account: {driveStatus.email || 'Unknown email'}</div>
                                                <div>Folder: GLINTEX_Backups (keeps last 3 backups)</div>
                                            </div>
                                        )}

                                        {driveStatus.configured && !driveStatus.connected && (
                                            <p className="text-xs text-muted-foreground">
                                                Connect Google Drive to upload every backup offsite. The system keeps the latest 3 backups.
                                            </p>
                                        )}

                                        {driveStatus.error && (
                                            <p className="text-xs text-red-600 dark:text-red-400">{driveStatus.error}</p>
                                        )}

                                        <div className="flex flex-wrap gap-2">
                                            <Button size="sm" variant="outline" onClick={handleRefreshDrive} disabled={driveStatus.loading}>
                                                <RefreshCw className={`w-4 h-4 mr-2 ${driveStatus.loading ? 'animate-spin' : ''}`} />
                                                Refresh Status
                                            </Button>
                                            {driveStatus.connected ? (
                                                <Button size="sm" variant="destructive" onClick={handleDisconnectDrive} disabled={disconnectingDrive || isReadOnly}>
                                                    {disconnectingDrive ? 'Disconnecting...' : 'Disconnect'}
                                                </Button>
                                            ) : (
                                                <Button size="sm" onClick={handleConnectDrive} disabled={connectingDrive || !driveStatus.configured || isReadOnly}>
                                                    {connectingDrive ? 'Connecting...' : 'Connect Google Drive'}
                                                </Button>
                                            )}
                                            {driveStatus.connected && driveStatus.folderUrl && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => window.open(driveStatus.folderUrl, '_blank', 'noopener,noreferrer')}
                                                >
                                                    <ExternalLink className="w-4 h-4 mr-2" />
                                                    Open Folder
                                                </Button>
                                            )}
                                        </div>
                                    </div>

                                    {driveStatus.configured && driveStatus.connected && (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-sm font-semibold">Drive Backups</h4>
                                                <span className="text-[10px] text-muted-foreground">GLINTEX_Backups</span>
                                            </div>

                                            {driveFilesLoading ? (
                                                <div className="text-sm text-muted-foreground py-4 text-center">Loading Drive backups...</div>
                                            ) : driveFilesError ? (
                                                <div className="text-sm text-red-600 dark:text-red-400 py-4 text-center">{driveFilesError}</div>
                                            ) : driveFiles.length === 0 ? (
                                                <div className="text-sm text-muted-foreground py-4 text-center">No backups on Google Drive yet.</div>
                                            ) : (
                                                <div className="rounded-md border overflow-x-auto">
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead>Filename</TableHead>
                                                                <TableHead>Created</TableHead>
                                                                <TableHead>Size</TableHead>
                                                                <TableHead className="text-right">Actions</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {driveFiles.map((file) => (
                                                                <TableRow key={file.id}>
                                                                    <TableCell className="font-mono text-xs">{file.name}</TableCell>
                                                                    <TableCell className="whitespace-nowrap text-sm">{formatDate(file.createdTime)}</TableCell>
                                                                    <TableCell className="text-sm">{formatBytes(file.size)}</TableCell>
                                                                    <TableCell className="text-right">
                                                                        <a
                                                                            href={file.webViewLink}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary hover:underline"
                                                                        >
                                                                            <ExternalLink className="w-3 h-3" /> Open
                                                                        </a>
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
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

function ChallanSettings({ db, updateSettings, refreshDb, readOnly }) {
    const isReadOnly = !!readOnly;
    const [working, setWorking] = useState(false);
    const [fromDetails, setFromDetails] = useState({
        name: '',
        address: '',
        mobile: ''
    });
    const [fieldsConfig, setFieldsConfig] = useState({
        showFromName: true,
        showFromAddress: true,
        showFromMobile: true,
        showToDetails: true,
        showDate: true,
        showLotNo: true,
        showItem: true,
        showOperator: true,
        showHelper: true,
        showCut: true,
        showWastageNote: true,
        showTotals: true
    });

    useEffect(() => {
        const settings = db?.settings?.[0];
        if (settings) {
            setFromDetails({
                name: settings.challanFromName || '',
                address: settings.challanFromAddress || '',
                mobile: settings.challanFromMobile || ''
            });
            if (settings.challanFieldsConfig) {
                setFieldsConfig(prev => ({ ...prev, ...settings.challanFieldsConfig }));
            }
        }
    }, [db]);

    const handleSave = async () => {
        if (isReadOnly) return;
        setWorking(true);
        try {
            await updateSettings({
                challanFromName: fromDetails.name,
                challanFromAddress: fromDetails.address,
                challanFromMobile: fromDetails.mobile,
                challanFieldsConfig: fieldsConfig
            });
            alert('Challan settings saved');
            refreshDb();
        } catch (e) {
            alert(e.message);
        } finally {
            setWorking(false);
        }
    };

    const toggleField = (key) => {
        if (isReadOnly) return;
        setFieldsConfig(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const fieldLabels = {
        showFromName: 'Show From Name',
        showFromAddress: 'Show From Address',
        showFromMobile: 'Show From Mobile',
        showToDetails: 'Show To Details (Firm Info)',
        showDate: 'Show Date',
        showLotNo: 'Show Lot No',
        showItem: 'Show Item Name',
        showOperator: 'Show Operator Name',
        showHelper: 'Show Helper Name',
        showCut: 'Show Cut Name',
        showWastageNote: 'Show Wastage Note',
        showTotals: 'Show Summary Totals'
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Challan "From" Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Name / Business Name</Label>
                        <Input
                            value={fromDetails.name}
                            onChange={e => setFromDetails({ ...fromDetails, name: e.target.value })}
                            placeholder="e.g. GLINTEX INDUSTRIES"
                            disabled={isReadOnly}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Address</Label>
                        <textarea
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={fromDetails.address}
                            onChange={e => setFromDetails({ ...fromDetails, address: e.target.value })}
                            placeholder="Enter full address..."
                            disabled={isReadOnly}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Mobile / Contact Number</Label>
                        <Input
                            value={fromDetails.mobile}
                            onChange={e => setFromDetails({ ...fromDetails, mobile: e.target.value })}
                            placeholder="e.g. +91 98765 43210"
                            disabled={isReadOnly}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Visibility Settings</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {Object.entries(fieldLabels).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-3 p-3 border rounded-md hover:bg-muted/50 cursor-pointer transition-colors">
                                <input
                                    type="checkbox"
                                    checked={fieldsConfig[key]}
                                    onChange={() => toggleField(key)}
                                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    disabled={isReadOnly}
                                />
                                <span className="text-sm font-medium">{label}</span>
                            </label>
                        ))}
                    </div>
                    <Button className="w-full mt-6" onClick={handleSave} disabled={working || isReadOnly}>
                        <Save className="w-4 h-4 mr-2" /> Save Challan Settings
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
