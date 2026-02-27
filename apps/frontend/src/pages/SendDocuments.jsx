import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useInventory } from '../context/InventoryContext';
import * as api from '../api/client';
import {
    Button, Input, Select, Card, CardContent, CardHeader, CardTitle,
    Label, Table, TableHeader, TableRow, TableHead, TableBody, TableCell, Badge
} from '../components/ui';
import { Dialog, DialogContent } from '../components/ui/Dialog';
import { formatDateDDMMYYYY, todayISO } from '../utils';
import { FileText, Send, History, Camera, Upload, Image, X, Loader2, CheckCircle2, Plus, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import { useMobileDetect } from '../utils/useMobileDetect';
import { UserBadge } from '../components/common/UserBadge';

export function SendDocuments() {
    const { db } = useInventory();
    const { isMobile, isTouchDevice } = useMobileDetect();
    const [activeTab, setActiveTab] = useState('send'); // 'send' | 'history'
    const [customers, setCustomers] = useState([]); // This now holds WhatsApp contacts
    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [historySearch, setHistorySearch] = useState('');

    // Form state
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [filePreview, setFilePreview] = useState(null);
    const [caption, setCaption] = useState('');
    const [phone, setPhone] = useState('');
    const [recipientMode, setRecipientMode] = useState('contact'); // 'contact' | 'manual'
    const [sending, setSending] = useState(false);
    const [sendSuccess, setSendSuccess] = useState(false);
    const fileInputRef = useRef(null);

    // New customer modal
    const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
    const [newCustomerForm, setNewCustomerForm] = useState({ name: '', phone: '', address: '' });
    const [savingCustomer, setSavingCustomer] = useState(false);

    // Load contacts
    useEffect(() => {
        async function loadContacts() {
            try {
                const res = await api.getWhatsappContacts();
                const contacts = res.contacts || [];
                // Map to format expected by Select: { id: number, name: name, phone: number }
                // Since we don't have IDs for whatsapp contacts like we do for database customers, 
                // we'll use the number as the ID.
                const normalizeNumber = (value) => {
                    const digits = String(value || '').replace(/\D/g, '');
                    if (digits.length > 10 && digits.startsWith('91')) return digits.slice(-10);
                    return digits;
                };
                const deduped = new Map();
                contacts
                    .filter(c => c.name && /[A-Za-z]/.test(c.name))
                    .forEach(c => {
                        const key = normalizeNumber(c.number);
                        if (!key) return;
                        if (!deduped.has(key)) deduped.set(key, c);
                    });
                const mapped = Array.from(deduped.values()).map(c => ({
                    id: c.number, // Use number as ID
                    name: c.name || c.number,
                    phone: c.number,
                    address: null
                }));
                // Sort by name
                mapped.sort((a, b) => a.name.localeCompare(b.name));
                setCustomers(mapped);
            } catch (err) {
                console.error('Failed to load whatsapp contacts', err);
            }
        }
        loadContacts();
    }, []);

    // Load history when tab changes
    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory();
        }
    }, [activeTab]);

    async function loadHistory() {
        setLoadingHistory(true);
        try {
            const res = await api.getDocumentHistory();
            setHistory(res.messages || []);
        } catch (err) {
            console.error('Failed to load document history', err);
        } finally {
            setLoadingHistory(false);
        }
    }

    // Filter history by search
    const filteredHistory = useMemo(() => {
        if (!historySearch.trim()) return history;
        const term = historySearch.toLowerCase();
        return history.filter(h =>
            (h.customer?.name || '').toLowerCase().includes(term) ||
            (h.phone || '').includes(term) ||
            (h.filename || '').toLowerCase().includes(term) ||
            (h.caption || '').toLowerCase().includes(term)
        );
    }, [history, historySearch]);

    // Update phone when customer changes
    useEffect(() => {
        if (recipientMode !== 'contact') return;
        if (selectedCustomerId) {
            const customer = customers.find(c => c.id === selectedCustomerId);
            if (customer?.phone) {
                setPhone(customer.phone);
            } else {
                setPhone('');
            }
        } else {
            setPhone('');
        }
    }, [selectedCustomerId, customers, recipientMode]);

    function handleFileSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        setSelectedFile(file);
        setSendSuccess(false);

        // Create preview
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => setFilePreview(ev.target?.result);
            reader.readAsDataURL(file);
        } else {
            setFilePreview(null);
        }
    }

    function clearFile() {
        setSelectedFile(null);
        setFilePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }

    async function handleSend() {
        if (!selectedFile) {
            alert('Please select a file');
            return;
        }

        setSending(true);
        setSendSuccess(false);
        try {
            const formData = new FormData();
            formData.append('file', selectedFile);
            if (selectedCustomerId) {
                formData.append('customerId', selectedCustomerId);
            }
            if (selectedCustomer?.name) {
                formData.append('customerName', selectedCustomer.name);
            }
            if (phone) {
                formData.append('phone', phone);
            }
            if (caption.trim()) {
                formData.append('caption', caption.trim());
            }

            const response = await api.sendDocument(formData);
            if (!response?.ok) {
                const channelErrors = Object.entries(response?.channels || {})
                    .flatMap(([channel, detail]) => (detail?.results || [])
                        .filter(r => !r.success)
                        .map(r => `${channel}: ${r.error || 'failed'}`));
                throw new Error(channelErrors[0] || response?.error || 'Failed to send document');
            }
            const partialErrors = Object.entries(response?.channels || {})
                .flatMap(([channel, detail]) => (detail?.results || [])
                    .filter(r => !r.success)
                    .map(r => `${channel}: ${r.error || 'failed'}`));
            setSendSuccess(true);
            if (partialErrors.length > 0) {
                alert(`Document sent with partial failures (${partialErrors[0]})`);
            }
            setTimeout(() => setSendSuccess(false), 3000);
            clearFile();
            setCaption('');
            setSelectedCustomerId('');
            setPhone('');
            // Refresh history if on history tab
            if (activeTab === 'history') {
                loadHistory();
            }
        } catch (err) {
            alert(err.message || 'Failed to send document');
        } finally {
            setSending(false);
        }
    }

    async function handleCreateCustomer() {
        if (!newCustomerForm.name.trim()) {
            alert('Customer name is required');
            return;
        }
        setSavingCustomer(true);
        try {
            const res = await api.createCustomer({
                name: newCustomerForm.name.trim(),
                phone: newCustomerForm.phone.trim() || null,
                address: newCustomerForm.address.trim() || null,
            });
            setCustomers(prev => [...prev, res.customer].sort((a, b) => a.name.localeCompare(b.name)));
            setSelectedCustomerId(res.customer.id);
            if (res.customer.phone) {
                setPhone(res.customer.phone);
            }
            setNewCustomerModalOpen(false);
            setNewCustomerForm({ name: '', phone: '', address: '' });
        } catch (err) {
            alert(err.message || 'Failed to create customer');
        } finally {
            setSavingCustomer(false);
        }
    }

    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
    const useMobileLayout = isMobile && isTouchDevice;

    return (
        <div className="space-y-6 fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <FileText className="w-6 h-6" />
                        Send Documents
                    </h1>
                    <p className="text-muted-foreground text-sm">Routing is controlled by the "documents send" template in Settings → Message Templates.</p>
                </div>

                {/* Tab Toggle */}
                <div className="flex p-1 bg-muted rounded-lg w-full sm:w-auto">
                    <button
                        onClick={() => setActiveTab('send')}
                        className={cn(
                            "flex-1 sm:flex-none px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center justify-center gap-2",
                            activeTab === 'send'
                                ? "bg-background shadow text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Send className="w-4 h-4" />
                        Send
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={cn(
                            "flex-1 sm:flex-none px-4 py-2 text-sm font-medium rounded-md transition-all flex items-center justify-center gap-2",
                            activeTab === 'history'
                                ? "bg-background shadow text-foreground"
                                : "text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <History className="w-4 h-4" />
                        History
                    </button>
                </div>
            </div>

            {activeTab === 'send' ? (
                useMobileLayout ? (
                    <div className="flex flex-col gap-4">
                        {/* 1. File Selection - Compact Horizontal Bar */}
                        <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
                                Document source
                            </Label>

                            {selectedFile ? (
                                <div className="flex items-center gap-3 bg-background p-2 rounded border shadow-sm">
                                    {filePreview ? (
                                        <img src={filePreview} alt="Preview" className="w-10 h-10 object-cover rounded" />
                                    ) : (
                                        <div className="w-10 h-10 bg-primary/10 grid place-items-center rounded text-primary">
                                            <FileText className="w-5 h-5" />
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                                        <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={clearFile}>
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-3 gap-2">
                                    <label className="cursor-pointer flex flex-col items-center justify-center gap-1 p-3 bg-background border rounded hover:bg-accent active:bg-accent/80 transition-colors h-20 text-center">
                                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />
                                        <Camera className="w-6 h-6 text-primary mb-1" />
                                        <span className="text-[10px] font-medium leading-none">Camera</span>
                                    </label>

                                    <label className="cursor-pointer flex flex-col items-center justify-center gap-1 p-3 bg-background border rounded hover:bg-accent active:bg-accent/80 transition-colors h-20 text-center">
                                        <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileSelect} />
                                        <Image className="w-6 h-6 text-blue-500 mb-1" />
                                        <span className="text-[10px] font-medium leading-none">Gallery</span>
                                    </label>

                                    <label className="cursor-pointer flex flex-col items-center justify-center gap-1 p-3 bg-background border rounded hover:bg-accent active:bg-accent/80 transition-colors h-20 text-center">
                                        <input type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} />
                                        <FileText className="w-6 h-6 text-red-500 mb-1" />
                                        <span className="text-[10px] font-medium leading-none">PDF</span>
                                    </label>
                                </div>
                            )}
                        </div>

                        {/* 2. Recipient Selection - Compact */}
                        <div className="bg-muted/30 p-3 rounded-lg border border-border/50 space-y-3">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground block">
                                Recipient Details
                            </Label>

                            {/* Toggle Mode */}
                            <div className="grid grid-cols-2 p-1 bg-muted rounded-md mb-2">
                                <button
                                    className={cn("text-xs font-medium py-1.5 rounded-sm transition-all", recipientMode === 'contact' ? "bg-background shadow text-foreground" : "text-muted-foreground")}
                                    onClick={() => { setRecipientMode('contact'); setPhone(''); }}
                                >
                                    Contact
                                </button>
                                <button
                                    className={cn("text-xs font-medium py-1.5 rounded-sm transition-all", recipientMode === 'manual' ? "bg-background shadow text-foreground" : "text-muted-foreground")}
                                    onClick={() => { setRecipientMode('manual'); setSelectedCustomerId(''); setPhone(''); }}
                                >
                                    Manual
                                </button>
                            </div>

                            {recipientMode === 'contact' ? (
                                <Select
                                    value={selectedCustomerId}
                                    onChange={e => setSelectedCustomerId(e.target.value)}
                                    options={[
                                        { value: "", label: "Select Contact..." },
                                        ...customers.map(c => ({
                                            value: c.id,
                                            label: `${c.name} (${c.phone})`
                                        }))
                                    ]}
                                    className="bg-background"
                                />
                            ) : (
                                <Input
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                    placeholder="Enter number (e.g. +91...)"
                                    className="bg-background"
                                />
                            )}
                        </div>

                        {/* 3. Message */}
                        <div className="bg-muted/30 p-3 rounded-lg border border-border/50">
                            <div className="relative">
                                <Input
                                    value={caption}
                                    onChange={e => setCaption(e.target.value)}
                                    placeholder="Add a message..."
                                    className="bg-background pr-8"
                                />
                                {caption && (
                                    <button onClick={() => setCaption('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* 4. Send Action */}
                        <div className="pt-2">
                            <Button
                                className="w-full h-12 text-base font-semibold shadow-md"
                                onClick={handleSend}
                                disabled={sending || !selectedFile || !phone || (recipientMode === 'contact' && !selectedCustomerId)}
                            >
                                {sending ? (
                                    <>
                                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    <>
                                        <Send className="w-5 h-5 mr-2" />
                                        Send Now
                                    </>
                                )}
                            </Button>
                            {sendSuccess && (
                                <p className="text-center text-green-600 font-medium text-sm mt-2 animate-in fade-in slide-in-from-bottom-1">
                                    <CheckCircle2 className="w-4 h-4 inline mr-1" /> Sent successfully
                                </p>
                            )}
                        </div>
                    </div>
                ) : (
                    // Desktop Layout (Original)
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* File Selection Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Select Document</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div
                                    className={cn(
                                        "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
                                        selectedFile ? "border-green-500/50 bg-green-500/5" : "border-muted-foreground/25 hover:border-primary/50"
                                    )}
                                >
                                    {selectedFile ? (
                                        <div className="space-y-3">
                                            {filePreview ? (
                                                <img
                                                    src={filePreview}
                                                    alt="Preview"
                                                    className="max-h-48 mx-auto rounded-lg shadow-sm"
                                                />
                                            ) : (
                                                <FileText className="w-16 h-16 mx-auto text-muted-foreground" />
                                            )}
                                            <div className="text-sm">
                                                <p className="font-medium truncate">{selectedFile.name}</p>
                                                <p className="text-muted-foreground">
                                                    {(selectedFile.size / 1024).toFixed(1)} KB
                                                </p>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={clearFile}>
                                                <X className="w-4 h-4 mr-1" /> Remove
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            <div className="flex justify-center gap-4">

                                                <label className="cursor-pointer">
                                                    <input
                                                        ref={fileInputRef}
                                                        type="file"
                                                        accept="image/*,application/pdf"
                                                        className="hidden"
                                                        onChange={handleFileSelect}
                                                    />
                                                    <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
                                                        <Image className="w-8 h-8 text-primary" />
                                                        <span className="text-sm font-medium">Gallery</span>
                                                    </div>
                                                </label>

                                                <label className="cursor-pointer">
                                                    <input
                                                        type="file"
                                                        accept="application/pdf"
                                                        className="hidden"
                                                        onChange={handleFileSelect}
                                                    />
                                                    <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
                                                        <FileText className="w-8 h-8 text-primary" />
                                                        <span className="text-sm font-medium">PDF</span>
                                                    </div>
                                                </label>
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                                Select an image or PDF to share
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <Label>Message (Optional)</Label>
                                    <Input
                                        value={caption}
                                        onChange={e => setCaption(e.target.value)}
                                        placeholder="Add a caption or message..."
                                        className="mt-1"
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Customer & Send Card */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Recipient</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div>
                                    <Label>Recipient *</Label>
                                    <div className="flex gap-2 mt-1">
                                        <Button
                                            type="button"
                                            variant={recipientMode === 'contact' ? 'default' : 'outline'}
                                            className="flex-1"
                                            onClick={() => {
                                                setRecipientMode('contact');
                                                setSendSuccess(false);
                                                setPhone('');
                                            }}
                                        >
                                            WhatsApp Contact
                                        </Button>
                                        <Button
                                            type="button"
                                            variant={recipientMode === 'manual' ? 'default' : 'outline'}
                                            className="flex-1"
                                            onClick={() => {
                                                setRecipientMode('manual');
                                                setSelectedCustomerId('');
                                                setSendSuccess(false);
                                                setPhone('');
                                            }}
                                        >
                                            Manual Number
                                        </Button>
                                    </div>
                                </div>

                                {recipientMode === 'contact' && (
                                    <div>
                                        <Label>WhatsApp Contact *</Label>
                                        <div className="flex gap-2 mt-1">
                                            <Select
                                                className="flex-1"
                                                value={selectedCustomerId}
                                                onChange={e => setSelectedCustomerId(e.target.value)}
                                                options={[
                                                    { value: "", label: "Select Contact" },
                                                    ...customers.map(c => ({
                                                        value: c.id,
                                                        label: `${c.name} (${c.phone})`
                                                    }))
                                                ]}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <Label>WhatsApp Number *</Label>
                                    <Input
                                        value={phone}
                                        onChange={e => setPhone(e.target.value)}
                                        placeholder="e.g. +91 9876543210"
                                        className="mt-1"
                                        disabled={recipientMode === 'contact'}
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {recipientMode === 'manual'
                                            ? 'Add +91 or your country code before the number.'
                                            : 'Use the full WhatsApp number.'}
                                    </p>
                                </div>

                                {recipientMode === 'contact' && selectedCustomer && (
                                    <div className="p-3 bg-muted rounded-lg">
                                        <div className="font-medium">{selectedCustomer.name}</div>
                                        {selectedCustomer.phone && (
                                            <div className="text-sm text-muted-foreground">{selectedCustomer.phone}</div>
                                        )}
                                    </div>
                                )}

                                {sendSuccess && (
                                    <div className="flex items-center gap-2 p-3 bg-green-500/10 text-green-600 rounded-lg">
                                        <CheckCircle2 className="w-5 h-5" />
                                        Document sent successfully!
                                    </div>
                                )}

                                <Button
                                    className="w-full"
                                    size="lg"
                                    onClick={handleSend}
                                    disabled={sending || !selectedFile || !phone || (recipientMode === 'contact' && !selectedCustomerId)}
                                >
                                    {sending ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Sending...
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-4 h-4 mr-2" />
                                            Send via WhatsApp
                                        </>
                                    )}
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                )
            ) : (
                /* History Tab */
                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <CardTitle className="text-lg">Sent Documents</CardTitle>
                            <div className="relative w-full sm:w-64">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search history..."
                                    className="pl-10 h-9"
                                    value={historySearch}
                                    onChange={e => setHistorySearch(e.target.value)}
                                />
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {loadingHistory ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : filteredHistory.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">
                                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                <p>No documents sent yet</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Date</TableHead>
                                            <TableHead>Customer</TableHead>
                                            <TableHead>Phone</TableHead>
                                            <TableHead>File</TableHead>
                                            <TableHead>Caption</TableHead>
                                            <TableHead>Sent By</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredHistory.map(msg => (
                                            <TableRow key={msg.id}>
                                                <TableCell className="whitespace-nowrap">
                                                    {formatDateDDMMYYYY(msg.sentAt)}
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    {msg.customer?.name || '—'}
                                                </TableCell>
                                                <TableCell className="font-mono text-sm">
                                                    {msg.phone}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-2">
                                                        {msg.mimetype?.startsWith('image/') ? (
                                                            <Image className="w-4 h-4 text-blue-500" />
                                                        ) : (
                                                            <FileText className="w-4 h-4 text-red-500" />
                                                        )}
                                                        <span className="truncate max-w-[150px]" title={msg.filename}>
                                                            {msg.filename}
                                                        </span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-muted-foreground max-w-[200px] truncate">
                                                    {msg.caption || '—'}
                                                </TableCell>
                                                <TableCell>
                                                    <UserBadge user={msg.createdByUser} timestamp={msg.sentAt} />
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* New Customer Modal */}
            <Dialog open={newCustomerModalOpen} onOpenChange={setNewCustomerModalOpen}>
                <DialogContent title="Add Customer" onOpenChange={setNewCustomerModalOpen}>
                    <div className="space-y-4">
                        <div>
                            <Label>Name *</Label>
                            <Input
                                value={newCustomerForm.name}
                                onChange={e => setNewCustomerForm(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Customer name"
                            />
                        </div>
                        <div>
                            <Label>Phone</Label>
                            <Input
                                value={newCustomerForm.phone}
                                onChange={e => setNewCustomerForm(prev => ({ ...prev, phone: e.target.value }))}
                                placeholder="WhatsApp number"
                            />
                        </div>
                        <div>
                            <Label>Address</Label>
                            <Input
                                value={newCustomerForm.address}
                                onChange={e => setNewCustomerForm(prev => ({ ...prev, address: e.target.value }))}
                                placeholder="Optional"
                            />
                        </div>
                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" className="flex-1" onClick={() => setNewCustomerModalOpen(false)}>
                                Cancel
                            </Button>
                            <Button
                                className="flex-1"
                                onClick={handleCreateCustomer}
                                disabled={savingCustomer || !newCustomerForm.name.trim()}
                            >
                                {savingCustomer ? 'Saving...' : 'Add Customer'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default SendDocuments;
