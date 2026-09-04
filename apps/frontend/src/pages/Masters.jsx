import React, { useEffect, useRef, useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Select, Badge, Checkbox, Label } from '../components/ui';
import { TableStateRow } from '../components/data-table';
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2, Edit2, Save, X, Search } from 'lucide-react';
import { formatKg } from '../utils';
import { usePermission } from '../hooks/usePermission';
import { DisabledWithTooltip } from '../components/common/DisabledWithTooltip';
import AccessDenied from '../components/common/AccessDenied';
import { UserBadge } from '../components/common/UserBadge';
import * as api from '../api/client';

// Process type options for dropdowns
const PROCESS_OPTIONS = [
    { value: 'all', label: 'All Processes' },
    { value: 'cutter', label: 'Cutter' },
    { value: 'holo', label: 'Holo' },
    { value: 'coning', label: 'Coning' },
];

const MACHINE_PROCESS_OPTIONS = [
    ...PROCESS_OPTIONS,
    { value: 'boiler', label: 'Boiler' },
];



export function Masters() {
    const {
        db,
        createItem, updateItem, deleteItem,
        createYarn, updateYarn, deleteYarn,
        createCut, updateCut, deleteCut,
        createTwist, updateTwist, deleteTwist,
        createTwistMapping, updateTwistMapping, deleteTwistMapping,
        updateSettings,
        createFirm, updateFirm, deleteFirm,
        createCustomer, updateCustomer, deleteCustomer,
        createSupplier, updateSupplier, deleteSupplier,
        createMachine, updateMachine, deleteMachine,
        createOperator, updateOperator, deleteOperator,
        createBobbin, updateBobbin, deleteBobbin,
        createRollType, updateRollType, deleteRollType,
        createHoloProductionPerHour, updateHoloProductionPerHour, deleteHoloProductionPerHour,
        createHoloOtherWastageItem, updateHoloOtherWastageItem, deleteHoloOtherWastageItem,
        createConeType, updateConeType, deleteConeType,
        createWrapper, updateWrapper, deleteWrapper,
        createBox, updateBox, deleteBox,
        createContractor, updateContractor, deleteContractor,
        createContractorAssignment, updateContractorAssignment, deleteContractorAssignment,
        createContractorRate, updateContractorRate, deleteContractorRate,
        updateCombinedStockView, reorderCombinedStockViews, updateCombinedStockConfig,
        refreshing
    } = useInventory();
    const { canRead, canWrite, canEdit, canDelete } = usePermission('masters');
    const canCreate = canWrite;
    const { user } = useAuth();
    const isAdmin = user?.isAdmin || (user?.roleKeys || []).includes('admin');

    const [activeTab, setActiveTab] = useState('items');

    if (!canRead) {
        return (
            <div className="space-y-6 fade-in">
                <h1 className="text-2xl font-bold tracking-tight">Masters</h1>
                <AccessDenied message="You do not have access to master data. Contact an administrator to request access." />
            </div>
        );
    }

    const renderContent = () => {
        switch (activeTab) {
            case 'items': return <ItemsMasterCrud data={db.items} onCreate={createItem} onUpdate={updateItem} onDelete={deleteItem} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'yarns': return <SimpleMasterCrud title="Yarns" data={db.yarns} onCreate={createYarn} onUpdate={updateYarn} onDelete={deleteYarn} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'cuts': return <SimpleMasterCrud title="Cuts" data={db.cuts} onCreate={createCut} onUpdate={updateCut} onDelete={deleteCut} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'twists': return <SimpleMasterCrud title="Twists" data={db.twists} onCreate={createTwist} onUpdate={updateTwist} onDelete={deleteTwist} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'twistMappings': return <TwistMappingsMasterCrud data={db.twist_mappings || []} machines={db.machines || []} twists={db.twists || []} settings={db?.settings?.[0]} onCreate={createTwistMapping} onUpdate={updateTwistMapping} onDelete={deleteTwistMapping} updateSettings={updateSettings} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} isAdmin={isAdmin} />;
            case 'firms': return <FirmsMasterCrud data={db.firms} onCreate={createFirm} onUpdate={updateFirm} onDelete={deleteFirm} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'customers': return <CustomersMasterCrud data={db.customers} onCreate={createCustomer} onUpdate={updateCustomer} onDelete={deleteCustomer} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'suppliers': return <SimpleMasterCrud title="Suppliers" data={db.suppliers} onCreate={createSupplier} onUpdate={updateSupplier} onDelete={deleteSupplier} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'machines': return <MachinesMasterCrud data={db.machines || []} onCreate={createMachine} onUpdate={updateMachine} onDelete={deleteMachine} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'workers': return <WorkersMaster data={db.workers || []} onCreate={createOperator} onUpdate={updateOperator} onDelete={deleteOperator} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'bobbins': return <WeightMasterCrud title="Bobbins" data={db.bobbins} onCreate={createBobbin} onUpdate={updateBobbin} onDelete={deleteBobbin} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'rollTypes': return <WeightMasterCrud title="Roll Types" data={db.rollTypes} onCreate={createRollType} onUpdate={updateRollType} onDelete={deleteRollType} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'holoProductionPerHour': return <HoloProductionPerHourCrud data={db.holo_production_per_hours || []} yarns={db.yarns || []} cuts={db.cuts || []} onCreate={createHoloProductionPerHour} onUpdate={updateHoloProductionPerHour} onDelete={deleteHoloProductionPerHour} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'holoOtherWastageItems': return <SimpleMasterCrud title="Other Wastage" data={db.holo_other_wastage_items || []} onCreate={createHoloOtherWastageItem} onUpdate={updateHoloOtherWastageItem} onDelete={deleteHoloOtherWastageItem} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'coneTypes': return <WeightMasterCrud title="Cone Types" data={db.cone_types} onCreate={createConeType} onUpdate={updateConeType} onDelete={deleteConeType} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'wrappers': return <SimpleMasterCrud title="Wrappers" data={db.wrappers} onCreate={createWrapper} onUpdate={updateWrapper} onDelete={deleteWrapper} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'boxes': return <BoxesMasterCrud data={db.boxes || []} onCreate={createBox} onUpdate={updateBox} onDelete={deleteBox} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'contractors': return <ContractorsMasterCrud data={db.contractors || []} onCreate={createContractor} onUpdate={updateContractor} onDelete={deleteContractor} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'contractorAssignments': return <ContractorAssignmentsMasterCrud data={db.contractor_assignments || []} contractors={db.contractors || []} onCreate={createContractorAssignment} onUpdate={updateContractorAssignment} onDelete={deleteContractorAssignment} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'boilerSequence': return isAdmin ? <BoilerSequenceMaster /> : null;
            case 'contractorRates': return <ContractorRatesMasterCrud data={db.contractor_rates || []} contractors={db.contractors || []} items={db.items || []} yarns={db.yarns || []} cuts={db.cuts || []} twists={db.twists || []} coneTypes={db.cone_types || []} onCreate={createContractorRate} onUpdate={updateContractorRate} onDelete={deleteContractorRate} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'combinedStock': return <CombinedStockMasterCrud data={db.combined_stock_views || []} config={(db.combined_stock_config || [])[0]} onUpdateView={updateCombinedStockView} onReorderViews={reorderCombinedStockViews} onUpdateConfig={updateCombinedStockConfig} loading={refreshing} canEdit={canEdit} />;
            default: return null;
        }
    }

    // Render a tab button
    const TabButton = ({ id, label }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`w-full px-4 py-2.5 text-sm font-medium text-left hover:bg-muted/50 transition-colors border-l-2 ${activeTab === id ? 'border-primary bg-muted text-primary' : 'border-transparent text-muted-foreground'}`}
        >
            {label}
        </button>
    );

    // Render a section divider
    const SectionDivider = ({ label }) => (
        <div className="px-4 py-2 mt-2 first:mt-0">
            <div className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest border-b border-border pb-1">
                {label}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col md:flex-row gap-6 fade-in items-start">
            <Card className="w-full md:w-56 shrink-0">
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Master Data</CardTitle>
                </CardHeader>
                <CardContent className="p-0 pb-2">
                    <nav className="flex flex-col">
                        <SectionDivider label="Global" />
                        <TabButton id="items" label="Items" />
                        <TabButton id="firms" label="Firms" />
                        <TabButton id="customers" label="Customers" />
                        <TabButton id="suppliers" label="Suppliers" />

                        <SectionDivider label="Cutter" />
                        <TabButton id="cuts" label="Cuts" />
                        <TabButton id="bobbins" label="Bobbins" />

                        <SectionDivider label="Holo" />
                        <TabButton id="yarns" label="Yarns" />
                        <TabButton id="twists" label="Twists" />
                        <TabButton id="twistMappings" label="Twist Mapping" />
                        <TabButton id="rollTypes" label="Roll Types" />
                        <TabButton id="holoProductionPerHour" label="Production Per Hour" />
                        <TabButton id="holoOtherWastageItems" label="Other Wastage" />

                        <SectionDivider label="Coning" />
                        <TabButton id="coneTypes" label="Cone Types" />
                        <TabButton id="wrappers" label="Wrappers" />

                        {isAdmin && (
                            <>
                                <SectionDivider label="Boiler" />
                                <TabButton id="boilerSequence" label="Boiler Numbers" />
                            </>
                        )}

                        <SectionDivider label="Shared" />
                        <TabButton id="machines" label="Machines" />
                        <TabButton id="workers" label="Workers" />
                        <TabButton id="boxes" label="Boxes" />

                        <SectionDivider label="Stock" />
                        <TabButton id="combinedStock" label="Combined Stock" />

                        <SectionDivider label="Contractors" />
                        <TabButton id="contractors" label="Contractors" />
                        <TabButton id="contractorAssignments" label="Process Assignments" />
                        <TabButton id="contractorRates" label="Contractor Rates" />
                    </nav>
                </CardContent>
            </Card>

            <div className="flex-1 w-full">
                {renderContent()}
            </div>
        </div>
    );
}

// --- Sub Components ---

function SimpleMasterCrud({ title, data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [newName, setNewName] = useState('');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [deletingId, setDeletingId] = useState(null);
    const [deleteResult, setDeleteResult] = useState(null);
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const filtered = (data || []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const handleCreate = async () => {
        if (!allowCreate) return;
        if (!newName.trim()) return;
        await onCreate(newName);
        setNewName('');
    }

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        if (!editName.trim()) return;
        await onUpdate(id, editName);
        setEditingId(null);
    }

    const handleDelete = async (item) => {
        if (!allowDelete || deletingId) return;
        if (!confirm(`Delete ${item.name}?`)) return;

        setDeletingId(item.id);
        setDeleteResult(null);
        try {
            await onDelete(item.id);
            setDeleteResult({ type: 'success', message: `${item.name} deleted successfully.` });
        } catch (err) {
            setDeleteResult({
                type: 'error',
                message: err?.message || `Failed to delete ${item.name}.`,
            });
        } finally {
            setDeletingId(null);
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle>{title}</CardTitle>
                <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {deleteResult && (
                    <div
                        role={deleteResult.type === 'error' ? 'alert' : 'status'}
                        className={`rounded-md border px-3 py-2 text-sm ${deleteResult.type === 'error'
                            ? 'border-destructive/40 bg-destructive/10 text-destructive'
                            : 'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400'}`}
                    >
                        {deleteResult.message}
                    </div>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                    <Input placeholder={`New ${title} name`} value={newName} onChange={e => setNewName(e.target.value)} disabled={!allowCreate} />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate} className="w-full sm:w-auto">
                        <Plus className="w-4 h-4 mr-2" /> Add
                    </Button>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={3} emptyMessage="No records found." />
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8" disabled={!allowEdit} />
                                        ) : item.name}
                                    </TableCell>
                                    <TableCell>
                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                    </TableCell>
                                    <TableCell className="">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name) }}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-8 w-8 text-destructive"
                                                        onClick={() => handleDelete(item)}
                                                        disabled={!allowDelete || deletingId === item.id}
                                                        aria-label={`Delete ${item.name}`}
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile Card View */}
                <div className="block sm:hidden space-y-2">
                    {filtered.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No records found</div>
                    ) : filtered.map(item => (
                        <div key={item.id} className="border rounded-lg bg-card p-3 flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                {editingId === item.id ? (
                                    <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8" disabled={!allowEdit} />
                                ) : (
                                    <span className="font-medium">{item.name}</span>
                                )}
                            </div>
                            <div className="flex gap-1">
                                {editingId === item.id ? (
                                    <>
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                    </>
                                ) : (
                                    <>
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name) }}><Edit2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                className="h-8 w-8 text-destructive"
                                                onClick={() => handleDelete(item)}
                                                disabled={!allowDelete || deletingId === item.id}
                                                aria-label={`Delete ${item.name}`}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </DisabledWithTooltip>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

// Admin-only: manage the last used boiler number per boiler machine.
// Next steam entry gets max(last used, max used in logs) + 1.
function BoilerSequenceMaster() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        setLoadError('');
        try {
            const res = await api.boilerSequenceList();
            setRows(res?.rows || []);
        } catch (err) {
            setLoadError(err.message || 'Failed to load boiler sequences');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleSave = async (machineId) => {
        const num = Number(editValue);
        if (!Number.isInteger(num) || num < 0) {
            alert('Last used number must be a non-negative integer');
            return;
        }
        setSaving(true);
        try {
            await api.boilerSequenceSet(machineId, num);
            setEditingId(null);
            await load();
        } catch (err) {
            alert(err.message || 'Failed to set boiler sequence');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Boiler Numbers</CardTitle>
                <p className="text-sm text-muted-foreground">
                    Set the last used boiler number per boiler. The next steam entry is auto-assigned that number + 1.
                    If actual usage is ahead of the set value, the higher number wins.
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {loadError && (
                    <div className="text-sm text-destructive">{loadError}</div>
                )}
                <div className="rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Boiler Machine</TableHead>
                                <TableHead>Last Used (set)</TableHead>
                                <TableHead>Max Used (entries)</TableHead>
                                <TableHead>Next No</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading || rows.length === 0 ? (
                                <TableStateRow colSpan={5} isLoading={loading} emptyMessage="No boiler machines found. Add BOILER machines in Masters > Machines first." />
                            ) : rows.map(row => (
                                <TableRow key={row.machineId}>
                                    <TableCell className="font-medium">{row.machineName}</TableCell>
                                    <TableCell>
                                        {editingId === row.machineId ? (
                                            <Input
                                                type="number"
                                                min="0"
                                                step="1"
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                className="h-8 w-28"
                                                disabled={saving}
                                            />
                                        ) : row.sequenceValue}
                                    </TableCell>
                                    <TableCell>{row.maxUsed}</TableCell>
                                    <TableCell>
                                        <span className="font-semibold">{row.effectiveNext}</span>
                                        {row.maxUsed > row.sequenceValue && row.sequenceValue > 0 && (
                                            <span className="ml-2 text-xs text-amber-600">usage is ahead; next is max used + 1</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === row.machineId ? (
                                            <div className="flex justify-end gap-1">
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" disabled={saving} onClick={() => handleSave(row.machineId)}><Save className="w-4 h-4" /></Button>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" disabled={saving} onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(row.machineId); setEditValue(String(Math.max(row.sequenceValue, row.maxUsed))); }}><Edit2 className="w-4 h-4" /></Button>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

function TwistMappingsMasterCrud({ data, machines, twists, settings, onCreate, onUpdate, onDelete, updateSettings, loading, canCreate, canEdit, canDelete, isAdmin }) {
    const [newMachineId, setNewMachineId] = useState('');
    const [newTwistId, setNewTwistId] = useState('');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editTwistId, setEditTwistId] = useState('');
    const [savingToggle, setSavingToggle] = useState(false);
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;
    const autoEnabled = !!settings?.autoSelectTwistForMachine;

    const eligibleMachines = (machines || []).filter(m => ['all', 'holo', 'coning'].includes(m.processType || 'all'));
    const mappedMachineIds = new Set((data || []).map(r => r.machineId));
    const addableMachines = eligibleMachines
        .filter(m => !mappedMachineIds.has(m.id))
        .map(m => ({ id: m.id, name: m.name }));
    const twistOptions = (twists || []).map(t => ({ id: t.id, name: t.name }));

    const machineName = (id) => (machines || []).find(m => m.id === id)?.name || '—';
    const twistName = (id) => (twists || []).find(t => t.id === id)?.name || '—';

    const filtered = (data || []).filter(r => {
        if (!search) return true;
        const s = search.toLowerCase();
        return machineName(r.machineId).toLowerCase().includes(s) || twistName(r.twistId).toLowerCase().includes(s);
    });

    const handleCreate = async () => {
        if (!allowCreate) return;
        if (!newMachineId || !newTwistId) return;
        await onCreate(newMachineId, newTwistId);
        setNewMachineId('');
        setNewTwistId('');
    };

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        if (!editTwistId) return;
        await onUpdate(id, editTwistId);
        setEditingId(null);
    };

    const handleToggle = async (e) => {
        const next = !!e.target.checked;
        setSavingToggle(true);
        try {
            await updateSettings({ autoSelectTwistForMachine: next });
        } catch (err) {
            alert(err?.message || 'Failed to update setting');
        } finally {
            setSavingToggle(false);
        }
    };

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                    <CardTitle>Twist Mapping</CardTitle>
                    <p className="text-xs text-muted-foreground">
                        Map each machine to a default Twist. When the toggle is on, picking a machine on the Issue to Machine form will auto-select and lock the Twist.
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                    <div className="relative w-full sm:w-48">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {isAdmin && (
                    <div className="flex items-center justify-between gap-3 border rounded-md p-3 bg-muted/30">
                        <div>
                            <Label className="text-sm font-medium">Auto-select Twist on Machine selection</Label>
                            <p className="text-xs text-muted-foreground mt-1">
                                When enabled, the Twist field on Issue to Machine (Holo &amp; Coning) is set from the mapping and locked. Machines without a mapping leave Twist blank for manual selection.
                            </p>
                        </div>
                        <label className="inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={autoEnabled}
                                disabled={savingToggle}
                                onChange={handleToggle}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary relative" />
                        </label>
                    </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                    <Select
                        value={newMachineId}
                        onChange={e => setNewMachineId(e.target.value)}
                        options={addableMachines}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Machine"
                        className="flex-1"
                        disabled={!allowCreate || addableMachines.length === 0}
                    />
                    <Select
                        value={newTwistId}
                        onChange={e => setNewTwistId(e.target.value)}
                        options={twistOptions}
                        labelKey="name"
                        valueKey="id"
                        placeholder="Select Twist"
                        className="flex-1"
                        disabled={!allowCreate || twistOptions.length === 0}
                    />
                    <Button onClick={handleCreate} disabled={loading || !allowCreate || !newMachineId || !newTwistId} className="w-full sm:w-auto">
                        <Plus className="w-4 h-4 mr-2" /> Add
                    </Button>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Machine</TableHead>
                                <TableHead>Twist</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={4} emptyMessage="No mappings yet." />
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>{machineName(item.machineId)}</TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Select
                                                value={editTwistId}
                                                onChange={e => setEditTwistId(e.target.value)}
                                                options={twistOptions}
                                                labelKey="name"
                                                valueKey="id"
                                                className="h-8"
                                                disabled={!allowEdit}
                                            />
                                        ) : twistName(item.twistId)}
                                    </TableCell>
                                    <TableCell>
                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditTwistId(item.twistId); }}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete mapping?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile Card View */}
                <div className="block sm:hidden space-y-2">
                    {filtered.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No mappings yet</div>
                    ) : filtered.map(item => (
                        <div key={item.id} className="border rounded-lg bg-card p-3">
                            {editingId === item.id ? (
                                <div className="space-y-2">
                                    <div className="text-sm font-medium">{machineName(item.machineId)}</div>
                                    <Select
                                        value={editTwistId}
                                        onChange={e => setEditTwistId(e.target.value)}
                                        options={twistOptions}
                                        labelKey="name"
                                        valueKey="id"
                                        disabled={!allowEdit}
                                    />
                                    <div className="flex justify-end gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4 mr-1" /> Save</Button>
                                        </DisabledWithTooltip>
                                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <div className="font-medium">{machineName(item.machineId)}</div>
                                        <div className="text-xs text-muted-foreground">Twist: {twistName(item.twistId)}</div>
                                    </div>
                                    <div className="flex gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditTwistId(item.twistId); }}><Edit2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete mapping?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

function WeightMasterCrud({ title, data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [newName, setNewName] = useState('');
    const [newWeight, setNewWeight] = useState('');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editWeight, setEditWeight] = useState('');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const filtered = (data || []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const handleCreate = async () => {
        if (!allowCreate) return;
        if (!newName.trim()) return;
        await onCreate(newName, Number(newWeight));
        setNewName('');
        setNewWeight('');
    }

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        if (!editName.trim()) return;
        await onUpdate(id, editName, Number(editWeight));
        setEditingId(null);
    }

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle>{title}</CardTitle>
                <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2">
                    <Input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} className="flex-1" disabled={!allowCreate} />
                    <Input placeholder="Weight (kg)" type="number" step="0.001" value={newWeight} onChange={e => setNewWeight(e.target.value)} className="w-full sm:w-32" disabled={!allowCreate} />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate} className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" /> Add</Button>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead className="">Weight (kg)</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={4} emptyMessage="No records found." />
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8" disabled={!allowEdit} /> : item.name}
                                    </TableCell>
                                    <TableCell className="">
                                        {editingId === item.id ? <Input type="number" step="0.001" value={editWeight} onChange={e => setEditWeight(e.target.value)} className="h-8 w-24 ml-auto" disabled={!allowEdit} /> : formatKg(item.weight)}
                                    </TableCell>
                                    <TableCell>
                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                    </TableCell>
                                    <TableCell className="">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditWeight(item.weight) }}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile Card View */}
                <div className="block sm:hidden space-y-2">
                    {filtered.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No records found</div>
                    ) : filtered.map(item => (
                        <div key={item.id} className="border rounded-lg bg-card p-3">
                            {editingId === item.id ? (
                                <div className="space-y-2">
                                    <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" disabled={!allowEdit} />
                                    <Input type="number" step="0.001" value={editWeight} onChange={e => setEditWeight(e.target.value)} placeholder="Weight (kg)" disabled={!allowEdit} />
                                    <div className="flex justify-end gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4 mr-1" /> Save</Button>
                                        </DisabledWithTooltip>
                                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <span className="font-medium">{item.name}</span>
                                        <span className="text-xs text-muted-foreground ml-2">({formatKg(item.weight)})</span>
                                    </div>
                                    <div className="flex gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditWeight(item.weight) }}><Edit2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

function HoloProductionPerHourCrud({ data, yarns, cuts, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [search, setSearch] = useState('');
    const [newYarnId, setNewYarnId] = useState('');
    const [newCutId, setNewCutId] = useState('ANY');
    const [newRate, setNewRate] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editYarnId, setEditYarnId] = useState('');
    const [editCutId, setEditCutId] = useState('ANY');
    const [editRate, setEditRate] = useState('');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const yarnOptions = [
        { value: '', label: 'Select Yarn' },
        ...(yarns || []).map((yarn) => ({ value: yarn.id, label: yarn.name })),
    ];
    const cutOptions = [
        { value: 'ANY', label: 'ANY' },
        ...(cuts || []).map((cut) => ({ value: cut.id, label: cut.name })),
    ];

    const filtered = (data || []).filter((item) => {
        const yarnName = item.yarn?.name || '';
        const cutName = item.cut?.name || item.cutMatcher || 'ANY';
        return `${yarnName} ${cutName}`.toLowerCase().includes(search.toLowerCase());
    });

    const handleCreate = async () => {
        if (!allowCreate) return;
        const rate = Number(newRate);
        if (!newYarnId || !Number.isFinite(rate) || rate <= 0) return;
        await onCreate({
            yarnId: newYarnId,
            cutId: newCutId === 'ANY' ? '' : newCutId,
            productionPerHourKg: rate,
        });
        setNewYarnId('');
        setNewCutId('ANY');
        setNewRate('');
    };

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        const rate = Number(editRate);
        if (!editYarnId || !Number.isFinite(rate) || rate <= 0) return;
        await onUpdate(id, {
            yarnId: editYarnId,
            cutId: editCutId === 'ANY' ? '' : editCutId,
            productionPerHourKg: rate,
        });
        setEditingId(null);
    };

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle>Holo Production Per Hour</CardTitle>
                <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_180px_auto] gap-2">
                    <Select value={newYarnId} onChange={e => setNewYarnId(e.target.value)} options={yarnOptions} searchable={false} disabled={!allowCreate} />
                    <Select value={newCutId} onChange={e => setNewCutId(e.target.value)} options={cutOptions} searchable={false} disabled={!allowCreate} />
                    <Input placeholder="Rate (kg)" type="number" step="0.001" value={newRate} onChange={e => setNewRate(e.target.value)} disabled={!allowCreate} />
                    <Button onClick={handleCreate} disabled={loading || !newYarnId || !newRate || !allowCreate}><Plus className="w-4 h-4 mr-2" /> Add</Button>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Yarn</TableHead>
                                <TableHead>Cut</TableHead>
                                <TableHead className="text-right">Rate (kg)</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={5} emptyMessage="No records found." />
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id
                                            ? <Select value={editYarnId} onChange={e => setEditYarnId(e.target.value)} options={yarnOptions} searchable={false} disabled={!allowEdit} />
                                            : (item.yarn?.name || '—')}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id
                                            ? <Select value={editCutId} onChange={e => setEditCutId(e.target.value)} options={cutOptions} searchable={false} disabled={!allowEdit} />
                                            : (item.cut?.name || 'ANY')}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {editingId === item.id
                                            ? <Input type="number" step="0.001" value={editRate} onChange={e => setEditRate(e.target.value)} className="h-8 w-28 ml-auto" disabled={!allowEdit} />
                                            : formatKg(item.productionPerHourKg)}
                                    </TableCell>
                                    <TableCell>
                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                                                        setEditingId(item.id);
                                                        setEditYarnId(item.yarnId || '');
                                                        setEditCutId(item.cutId || 'ANY');
                                                        setEditRate(item.productionPerHourKg);
                                                    }}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

// New component for Machines with processType support
function MachinesMasterCrud({ data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [newName, setNewName] = useState('');
    const [newProcessType, setNewProcessType] = useState('all');
    const [newSpindle, setNewSpindle] = useState('');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editProcessType, setEditProcessType] = useState('all');
    const [editSpindle, setEditSpindle] = useState('');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const filtered = (data || []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const handleCreate = async () => {
        if (!allowCreate) return;
        if (!newName.trim()) return;
        await onCreate(newName, newProcessType, newSpindle === '' ? null : Number(newSpindle));
        setNewName('');
        setNewProcessType('all');
        setNewSpindle('');
    }

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        if (!editName.trim()) return;
        await onUpdate(id, editName, editProcessType, editSpindle === '' ? null : Number(editSpindle));
        setEditingId(null);
    }



    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle>Machines</CardTitle>
                <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-2">
                    <Input placeholder="Machine Name" value={newName} onChange={e => setNewName(e.target.value)} className="flex-1" disabled={!allowCreate} />
                    <Select
                        value={newProcessType}
                        onChange={e => setNewProcessType(e.target.value)}
                        className="w-full sm:w-40"
                        options={MACHINE_PROCESS_OPTIONS}
                        searchable={false}
                        disabled={!allowCreate}
                    />
                    <Input placeholder="Spindle" type="number" min="0" step="1" value={newSpindle} onChange={e => setNewSpindle(e.target.value)} className="w-full sm:w-28" disabled={!allowCreate} />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate} className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" /> Add</Button>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Process</TableHead>
                                <TableHead className="text-right">Spindle</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={5} emptyMessage="No records found." />
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8" disabled={!allowEdit} /> : item.name}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Select
                                                value={editProcessType}
                                                onChange={e => setEditProcessType(e.target.value)}
                                                className="h-8"
                                                options={MACHINE_PROCESS_OPTIONS}
                                                searchable={false}
                                                disabled={!allowEdit}
                                            />
                                        ) : (
                                            <span className="text-sm text-muted-foreground">
                                                {MACHINE_PROCESS_OPTIONS.find(o => o.value === item.processType)?.label || 'All Processes'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        {editingId === item.id
                                            ? <Input type="number" min="0" step="1" value={editSpindle} onChange={e => setEditSpindle(e.target.value)} className="h-8 w-24 ml-auto" disabled={!allowEdit} />
                                            : (item.spindle ?? '—')}
                                    </TableCell>
                                    <TableCell>
                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                    </TableCell>
                                    <TableCell className="">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditProcessType(item.processType || 'all'); setEditSpindle(item.spindle ?? '') }}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile Card View */}
                <div className="block sm:hidden space-y-2">
                    {filtered.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No records found</div>
                    ) : filtered.map(item => (
                        <div key={item.id} className="border rounded-lg bg-card p-3">
                            {editingId === item.id ? (
                                <div className="space-y-2">
                                    <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Machine Name" disabled={!allowEdit} />
                                    <Select value={editProcessType} onChange={e => setEditProcessType(e.target.value)} options={MACHINE_PROCESS_OPTIONS} searchable={false} disabled={!allowEdit} />
                                    <Input type="number" min="0" step="1" value={editSpindle} onChange={e => setEditSpindle(e.target.value)} placeholder="Spindle" disabled={!allowEdit} />
                                    <div className="flex justify-end gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4 mr-1" /> Save</Button>
                                        </DisabledWithTooltip>
                                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <span className="font-medium">{item.name}</span>
                                        <span className="text-xs text-muted-foreground ml-2">({MACHINE_PROCESS_OPTIONS.find(o => o.value === item.processType)?.label || 'All'})</span>
                                        <span className="text-xs text-muted-foreground ml-2">Spindle: {item.spindle ?? '—'}</span>
                                    </div>
                                    <div className="flex gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditProcessType(item.processType || 'all'); setEditSpindle(item.spindle ?? '') }}><Edit2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

// Updated Workers component with processType support
function WorkersMaster({ data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [newName, setNewName] = useState('');
    const [newRole, setNewRole] = useState('operator');
    const [newProcessType, setNewProcessType] = useState('all');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editRole, setEditRole] = useState('operator');
    const [editProcessType, setEditProcessType] = useState('all');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const filtered = (data || []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const handleCreate = async () => {
        if (!allowCreate) return;
        if (!newName.trim()) return;
        await onCreate(newName, newRole, newProcessType);
        setNewName('');
        setNewProcessType('all');
    }

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        if (!editName.trim()) return;
        await onUpdate(id, editName, editRole, editProcessType);
        setEditingId(null);
    }



    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle>Workers</CardTitle>
                <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                    <Input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} className="flex-1 min-w-[150px]" disabled={!allowCreate} />
                    <Select
                        value={newRole}
                        onChange={e => setNewRole(e.target.value)}
                        className="w-32"
                        options={[{ value: 'operator', label: 'Operator' }, { value: 'helper', label: 'Helper' }]}
                        searchable={false}
                        disabled={!allowCreate}
                    />
                    <Select
                        value={newProcessType}
                        onChange={e => setNewProcessType(e.target.value)}
                        className="w-40"
                        options={PROCESS_OPTIONS}
                        searchable={false}
                        disabled={!allowCreate}
                    />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate} className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" /> Add</Button>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Process</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={5} emptyMessage="No records found." />
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8" disabled={!allowEdit} /> : item.name}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Select
                                                value={editRole}
                                                onChange={e => setEditRole(e.target.value)}
                                                className="h-8"
                                                options={[{ value: 'operator', label: 'Operator' }, { value: 'helper', label: 'Helper' }]}
                                                searchable={false}
                                                disabled={!allowEdit}
                                            />
                                        ) : <span className="text-sm text-muted-foreground capitalize">{item.role || 'operator'}</span>}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Select
                                                value={editProcessType}
                                                onChange={e => setEditProcessType(e.target.value)}
                                                className="h-8"
                                                options={PROCESS_OPTIONS}
                                                searchable={false}
                                                disabled={!allowEdit}
                                            />
                                        ) : (
                                            <span className="text-sm text-muted-foreground">
                                                {PROCESS_OPTIONS.find(o => o.value === item.processType)?.label || 'All Processes'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                    </TableCell>
                                    <TableCell className="">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditRole(item.role || 'operator'); setEditProcessType(item.processType || 'all') }}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile Card View */}
                <div className="block sm:hidden space-y-2">
                    {filtered.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No records found</div>
                    ) : filtered.map(item => (
                        <div key={item.id} className="border rounded-lg bg-card p-3">
                            {editingId === item.id ? (
                                <div className="space-y-2">
                                    <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" disabled={!allowEdit} />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <Select value={editRole} onChange={e => setEditRole(e.target.value)} options={[{ value: 'operator', label: 'Operator' }, { value: 'helper', label: 'Helper' }]} searchable={false} disabled={!allowEdit} />
                                        <Select value={editProcessType} onChange={e => setEditProcessType(e.target.value)} options={PROCESS_OPTIONS} searchable={false} disabled={!allowEdit} />
                                    </div>
                                    <div className="flex justify-end gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4 mr-1" /> Save</Button>
                                        </DisabledWithTooltip>
                                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <span className="font-medium">{item.name}</span>
                                        <div className="text-xs text-muted-foreground">
                                            <span className="capitalize">{item.role || 'operator'}</span> • {PROCESS_OPTIONS.find(o => o.value === item.processType)?.label || 'All'}
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditRole(item.role || 'operator'); setEditProcessType(item.processType || 'all') }}><Edit2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

// Boxes component with weight and processType support
function BoxesMasterCrud({ data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [newName, setNewName] = useState('');
    const [newWeight, setNewWeight] = useState('');
    const [newProcessType, setNewProcessType] = useState('all');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editWeight, setEditWeight] = useState('');
    const [editProcessType, setEditProcessType] = useState('all');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const filtered = (data || []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const handleCreate = async () => {
        if (!allowCreate) return;
        if (!newName.trim()) return;
        await onCreate(newName, Number(newWeight), newProcessType);
        setNewName('');
        setNewWeight('');
        setNewProcessType('all');
    }

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        if (!editName.trim()) return;
        await onUpdate(id, editName, Number(editWeight), editProcessType);
        setEditingId(null);
    }

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle>Boxes</CardTitle>
                <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2 flex-wrap">
                    <Input placeholder="Box Name" value={newName} onChange={e => setNewName(e.target.value)} className="flex-1 min-w-[120px]" disabled={!allowCreate} />
                    <Input placeholder="Weight (kg)" type="number" step="0.001" value={newWeight} onChange={e => setNewWeight(e.target.value)} className="w-28" disabled={!allowCreate} />
                    <Select
                        value={newProcessType}
                        onChange={e => setNewProcessType(e.target.value)}
                        className="w-36"
                        options={PROCESS_OPTIONS}
                        searchable={false}
                        disabled={!allowCreate}
                    />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate} className="w-full sm:w-auto"><Plus className="w-4 h-4 mr-2" /> Add</Button>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Weight (kg)</TableHead>
                                <TableHead>Process</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={5} emptyMessage="No records found." />
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8" disabled={!allowEdit} /> : item.name}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id ? <Input type="number" step="0.001" value={editWeight} onChange={e => setEditWeight(e.target.value)} className="h-8 w-24" disabled={!allowEdit} /> : formatKg(item.weight)}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Select
                                                value={editProcessType}
                                                onChange={e => setEditProcessType(e.target.value)}
                                                className="h-8"
                                                options={PROCESS_OPTIONS}
                                                searchable={false}
                                                disabled={!allowEdit}
                                            />
                                        ) : (
                                            <span className="text-sm text-muted-foreground">
                                                {PROCESS_OPTIONS.find(o => o.value === item.processType)?.label || 'All Processes'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                    </TableCell>
                                    <TableCell className="">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditWeight(item.weight); setEditProcessType(item.processType || 'all') }}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile Card View */}
                <div className="block sm:hidden space-y-2">
                    {filtered.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No records found</div>
                    ) : filtered.map(item => (
                        <div key={item.id} className="border rounded-lg bg-card p-3">
                            {editingId === item.id ? (
                                <div className="space-y-2">
                                    <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Box Name" disabled={!allowEdit} />
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <Input type="number" step="0.001" value={editWeight} onChange={e => setEditWeight(e.target.value)} placeholder="Weight (kg)" disabled={!allowEdit} />
                                        <Select value={editProcessType} onChange={e => setEditProcessType(e.target.value)} options={PROCESS_OPTIONS} searchable={false} disabled={!allowEdit} />
                                    </div>
                                    <div className="flex justify-end gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4 mr-1" /> Save</Button>
                                        </DisabledWithTooltip>
                                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <span className="font-medium">{item.name}</span>
                                        <div className="text-xs text-muted-foreground">
                                            {formatKg(item.weight)} • {PROCESS_OPTIONS.find(o => o.value === item.processType)?.label || 'All'}
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditWeight(item.weight); setEditProcessType(item.processType || 'all') }}><Edit2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

function FirmsMasterCrud({ data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [newName, setNewName] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [newMobile, setNewMobile] = useState('');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editAddress, setEditAddress] = useState('');
    const [editMobile, setEditMobile] = useState('');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const filtered = (data || []).filter(i =>
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        (i.address || '').toLowerCase().includes(search.toLowerCase()) ||
        (i.mobile || '').toLowerCase().includes(search.toLowerCase())
    );

    const handleCreate = async () => {
        if (!allowCreate) return;
        if (!newName.trim()) return;
        await onCreate(newName, newAddress, newMobile);
        setNewName('');
        setNewAddress('');
        setNewMobile('');
    }

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        if (!editName.trim()) return;
        await onUpdate(id, editName, editAddress, editMobile);
        setEditingId(null);
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Firms</CardTitle>
                <div className="relative w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input placeholder="Firm Name" value={newName} onChange={e => setNewName(e.target.value)} disabled={!allowCreate} />
                    <Input placeholder="Address" value={newAddress} onChange={e => setNewAddress(e.target.value)} disabled={!allowCreate} />
                    <Input placeholder="Mobile/Contact" value={newMobile} onChange={e => setNewMobile(e.target.value)} disabled={!allowCreate} />
                </div>
                <div className="flex justify-end">
                    <DisabledWithTooltip disabled={!allowCreate} tooltip="You do not have permission to create firms.">
                        <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate}><Plus className="w-4 h-4 mr-2" /> Add Firm</Button>
                    </DisabledWithTooltip>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Firm Details</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={3} emptyMessage="No records found." />
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <div className="space-y-2 py-1">
                                                <div className="flex items-center gap-2">
                                                    <Label className="w-16 text-[10px] uppercase">Name</Label>
                                                    <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 flex-1" disabled={!allowEdit} />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Label className="w-16 text-[10px] uppercase">Address</Label>
                                                    <Input value={editAddress} onChange={e => setEditAddress(e.target.value)} className="h-8 flex-1" disabled={!allowEdit} />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Label className="w-16 text-[10px] uppercase">Mobile</Label>
                                                    <Input value={editMobile} onChange={e => setEditMobile(e.target.value)} className="h-8 flex-1" disabled={!allowEdit} />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="py-1">
                                                <div className="font-bold text-sm text-primary">{item.name}</div>
                                                <div className="text-xs text-muted-foreground mt-0.5">{item.address || 'No address added'}</div>
                                                <div className="text-xs font-mono mt-0.5">{item.mobile || 'No contact added'}</div>
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                    </TableCell>
                                    <TableCell className="">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit firms.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)} disabled={!allowEdit || !editName.trim()}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit firms.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                                                        setEditingId(item.id);
                                                        setEditName(item.name);
                                                        setEditAddress(item.address || '');
                                                        setEditMobile(item.mobile || '');
                                                    }} disabled={!allowEdit}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete firms.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }} disabled={!allowDelete}><Trash2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile Card View */}
                <div className="block sm:hidden space-y-2">
                    {filtered.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No records found</div>
                    ) : filtered.map(item => (
                        <div key={item.id} className="border rounded-lg bg-card p-3">
                            {editingId === item.id ? (
                                <div className="space-y-2">
                                    <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Firm Name" disabled={!allowEdit} />
                                    <Input value={editAddress} onChange={e => setEditAddress(e.target.value)} placeholder="Address" disabled={!allowEdit} />
                                    <Input value={editMobile} onChange={e => setEditMobile(e.target.value)} placeholder="Mobile/Contact" disabled={!allowEdit} />
                                    <div className="flex justify-end gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit firms.">
                                            <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleUpdate(item.id)} disabled={!allowEdit || !editName.trim()}><Save className="w-4 h-4 mr-1" /> Save</Button>
                                        </DisabledWithTooltip>
                                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="font-medium text-primary">{item.name}</div>
                                        <div className="text-xs text-muted-foreground mt-0.5 truncate">{item.address || 'No address'}</div>
                                        <div className="text-xs font-mono mt-0.5">{item.mobile || 'No contact'}</div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit firms.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                                                setEditingId(item.id);
                                                setEditName(item.name);
                                                setEditAddress(item.address || '');
                                                setEditMobile(item.mobile || '');
                                            }} disabled={!allowEdit}><Edit2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete firms.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }} disabled={!allowDelete}><Trash2 className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

function CustomersMasterCrud({ data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [newName, setNewName] = useState('');
    const [newPhone, setNewPhone] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editPhone, setEditPhone] = useState('');
    const [editAddress, setEditAddress] = useState('');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const filtered = (data || []).filter(i =>
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        (i.phone || '').toLowerCase().includes(search.toLowerCase()) ||
        (i.address || '').toLowerCase().includes(search.toLowerCase())
    );

    const handleCreate = async () => {
        if (!allowCreate) return;
        if (!newName.trim()) return;
        await onCreate(newName, newPhone, newAddress);
        setNewName('');
        setNewPhone('');
        setNewAddress('');
    }

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        if (!editName.trim()) return;
        await onUpdate(id, editName, editPhone, editAddress);
        setEditingId(null);
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Customers</CardTitle>
                <div className="relative w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input placeholder="Customer Name" value={newName} onChange={e => setNewName(e.target.value)} disabled={!allowCreate} />
                    <Input placeholder="Phone" value={newPhone} onChange={e => setNewPhone(e.target.value)} disabled={!allowCreate} />
                    <Input placeholder="Address" value={newAddress} onChange={e => setNewAddress(e.target.value)} disabled={!allowCreate} />
                </div>
                <div className="flex justify-end">
                    <DisabledWithTooltip disabled={!allowCreate} tooltip="You do not have permission to create customers.">
                        <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate}><Plus className="w-4 h-4 mr-2" /> Add Customer</Button>
                    </DisabledWithTooltip>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Customer Details</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={3} emptyMessage="No records found." />
                            ) : filtered.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <div className="space-y-2 py-1">
                                                <div className="flex items-center gap-2">
                                                    <Label className="w-16 text-[10px] uppercase">Name</Label>
                                                    <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 flex-1" disabled={!allowEdit} />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Label className="w-16 text-[10px] uppercase">Phone</Label>
                                                    <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} className="h-8 flex-1" disabled={!allowEdit} />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <Label className="w-16 text-[10px] uppercase">Address</Label>
                                                    <Input value={editAddress} onChange={e => setEditAddress(e.target.value)} className="h-8 flex-1" disabled={!allowEdit} />
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="py-1">
                                                <div className="font-bold text-sm text-primary">{item.name}</div>
                                                <div className="text-xs text-muted-foreground mt-0.5">{item.address || 'No address added'}</div>
                                                <div className="text-xs font-mono mt-0.5">{item.phone || 'No phone added'}</div>
                                            </div>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <UserBadge user={item.createdByUser} timestamp={item.createdAt} />
                                    </TableCell>
                                    <TableCell className="">
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit customers.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)} disabled={!allowEdit || !editName.trim()}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit customers.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => {
                                                        setEditingId(item.id);
                                                        setEditName(item.name);
                                                        setEditPhone(item.phone || '');
                                                        setEditAddress(item.address || '');
                                                    }} disabled={!allowEdit}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete customers.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }} disabled={!allowDelete}><Trash2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>

                {/* Mobile Card View */}
                <div className="block sm:hidden space-y-2">
                    {filtered.length === 0 ? (
                        <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No records found</div>
                    ) : filtered.map(item => (
                        <div key={item.id} className="border rounded-lg bg-card p-3">
                            {editingId === item.id ? (
                                <div className="space-y-2">
                                    <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Customer Name" disabled={!allowEdit} />
                                    <Input value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="Phone" disabled={!allowEdit} />
                                    <Input value={editAddress} onChange={e => setEditAddress(e.target.value)} placeholder="Address" disabled={!allowEdit} />
                                    <div className="flex justify-end gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit customers.">
                                            <Button size="sm" variant="ghost" className="text-green-600" onClick={() => handleUpdate(item.id)} disabled={!allowEdit || !editName.trim()}><Save className="w-4 h-4 mr-1" /> Save</Button>
                                        </DisabledWithTooltip>
                                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4 mr-1" /> Cancel</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <div className="font-semibold text-primary">{item.name}</div>
                                    <div className="text-xs text-muted-foreground">{item.address || 'No address added'}</div>
                                    <div className="text-xs font-mono">{item.phone || 'No phone added'}</div>
                                    <div className="flex justify-end gap-1 pt-2">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit customers.">
                                            <Button size="sm" variant="ghost" onClick={() => {
                                                setEditingId(item.id);
                                                setEditName(item.name);
                                                setEditPhone(item.phone || '');
                                                setEditAddress(item.address || '');
                                            }} disabled={!allowEdit}><Edit2 className="w-4 h-4 mr-1" /> Edit</Button>
                                        </DisabledWithTooltip>
                                        <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete customers.">
                                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }} disabled={!allowDelete}><Trash2 className="w-4 h-4 mr-1" /> Delete</Button>
                                        </DisabledWithTooltip>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}

// ============================ Contractor masters ============================

const SIDE_OPTIONS = [
    { value: 'SINGLE', label: 'Single (S/S)' },
    { value: 'BOTH', label: 'Both (B/S)' },
];
const CONTRACTOR_PROCESS_OPTIONS = [
    { value: 'cutter', label: 'Cutter' },
    { value: 'holo', label: 'Holo' },
    { value: 'coning', label: 'Coning' },
];

function SideBadge({ side }) {
    if (side === 'SINGLE') return <Badge variant="secondary">S/S</Badge>;
    if (side === 'BOTH') return <Badge variant="secondary">B/S</Badge>;
    return <Badge className="bg-amber-100 text-amber-800 border-amber-300">Unknown</Badge>;
}

function ErrorNote({ error }) {
    if (!error) return null;
    return <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">{error}</div>;
}

function nameMap(list) {
    const m = new Map();
    (list || []).forEach((x) => m.set(x.id, x.name));
    return m;
}

// --- Items master with required Side ---------------------------------------
function ItemsMasterCrud({ data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [newName, setNewName] = useState('');
    const [newSide, setNewSide] = useState('');
    const [search, setSearch] = useState('');
    const [onlyUnknown, setOnlyUnknown] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editSide, setEditSide] = useState('');
    const [error, setError] = useState('');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const unknownCount = (data || []).filter((i) => !i.side || i.side === 'UNKNOWN').length;
    const filtered = (data || []).filter((i) => {
        if (onlyUnknown && i.side && i.side !== 'UNKNOWN') return false;
        return (i.name || '').toLowerCase().includes(search.toLowerCase());
    });

    const handleCreate = async () => {
        if (!allowCreate || !newName.trim() || !newSide) return;
        setError('');
        try {
            await onCreate(newName.trim(), newSide);
            setNewName('');
            setNewSide('');
        } catch (err) { setError(err.message || 'Failed to create item'); }
    };
    const startEdit = (item) => { setEditingId(item.id); setEditName(item.name); setEditSide(item.side && item.side !== 'UNKNOWN' ? item.side : ''); setError(''); };
    const handleUpdate = async (id) => {
        if (!allowEdit || !editName.trim() || !editSide) return;
        setError('');
        try { await onUpdate(id, editName.trim(), editSide); setEditingId(null); }
        catch (err) { setError(err.message || 'Failed to update item'); }
    };

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                    Items
                    {unknownCount > 0 && (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-300">{unknownCount} need Side</Badge>
                    )}
                </CardTitle>
                <div className="flex items-center gap-2">
                    <Button size="sm" variant={onlyUnknown ? 'default' : 'outline'} onClick={() => setOnlyUnknown((v) => !v)}>
                        Review Unknown
                    </Button>
                    <div className="relative w-full sm:w-48">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <ErrorNote error={error} />
                <div className="flex flex-col sm:flex-row gap-2">
                    <Input placeholder="New Item name" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={!allowCreate} />
                    <Select value={newSide} onChange={(e) => setNewSide(e.target.value)} disabled={!allowCreate} className="sm:w-44">
                        <option value="">Side…</option>
                        {SIDE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !newSide || !allowCreate} className="w-full sm:w-auto">
                        <Plus className="w-4 h-4 mr-2" /> Add
                    </Button>
                </div>

                <div className="rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Side</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={4} emptyMessage="No records found." />
                            ) : filtered.map((item) => (
                                <TableRow key={item.id} className={(!item.side || item.side === 'UNKNOWN') ? 'bg-amber-50/60' : ''}>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8" disabled={!allowEdit} />
                                        ) : item.name}
                                    </TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <Select value={editSide} onChange={(e) => setEditSide(e.target.value)} className="h-8" disabled={!allowEdit}>
                                                <option value="">Side…</option>
                                                {SIDE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                            </Select>
                                        ) : <SideBadge side={item.side} />}
                                    </TableCell>
                                    <TableCell><UserBadge user={item.createdByUser} timestamp={item.createdAt} /></TableCell>
                                    <TableCell>
                                        {editingId === item.id ? (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => handleUpdate(item.id)}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </div>
                                        ) : (
                                            <div className="flex justify-end gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(item)}><Edit2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id); }}><Trash2 className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

// --- Contractors master ----------------------------------------------------
function ContractorsMasterCrud({ data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const empty = { name: '', phone: '', paymentDetails: '', notes: '', isActive: true };
    const [form, setForm] = useState(empty);
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [error, setError] = useState('');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const filtered = (data || []).filter((c) => (c.name || '').toLowerCase().includes(search.toLowerCase()));
    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const reset = () => { setForm(empty); setEditingId(null); };

    const submit = async () => {
        if (!form.name.trim()) return;
        setError('');
        const payload = { name: form.name.trim(), phone: form.phone.trim() || null, paymentDetails: form.paymentDetails.trim() || null, notes: form.notes.trim() || null, isActive: !!form.isActive };
        try {
            if (editingId) await onUpdate(editingId, payload); else await onCreate(payload);
            reset();
        } catch (err) { setError(err.message || 'Failed to save contractor'); }
    };
    const startEdit = (c) => { setEditingId(c.id); setForm({ name: c.name || '', phone: c.phone || '', paymentDetails: c.paymentDetails || '', notes: c.notes || '', isActive: c.isActive !== false }); setError(''); };

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle>Contractors</CardTitle>
                <div className="relative w-full sm:w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <ErrorNote error={error} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-md border p-3 bg-muted/30">
                    <div><Label className="text-xs">Name *</Label><Input value={form.name} onChange={(e) => set('name', e.target.value)} disabled={!allowCreate && !editingId} /></div>
                    <div><Label className="text-xs">Phone</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} disabled={!allowCreate && !editingId} /></div>
                    <div><Label className="text-xs">Payment details</Label><Input value={form.paymentDetails} onChange={(e) => set('paymentDetails', e.target.value)} placeholder="Bank / UPI / account" disabled={!allowCreate && !editingId} /></div>
                    <div><Label className="text-xs">Notes</Label><Input value={form.notes} onChange={(e) => set('notes', e.target.value)} disabled={!allowCreate && !editingId} /></div>
                    <label className="flex items-center gap-2 text-sm mt-1">
                        <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} disabled={!allowCreate && !editingId} /> Active
                    </label>
                    <div className="flex items-end gap-2 justify-end">
                        {editingId && <Button variant="ghost" onClick={reset}>Cancel</Button>}
                        <Button onClick={submit} disabled={loading || !form.name.trim() || (editingId ? !allowEdit : !allowCreate)}>
                            {editingId ? <><Save className="w-4 h-4 mr-2" />Save</> : <><Plus className="w-4 h-4 mr-2" />Add</>}
                        </Button>
                    </div>
                </div>

                <div className="rounded-md border max-h-[55vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Phone</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableStateRow colSpan={4} emptyMessage="No contractors yet." />
                            ) : filtered.map((c) => (
                                <TableRow key={c.id}>
                                    <TableCell className="font-medium">{c.name}</TableCell>
                                    <TableCell>{c.phone || '—'}</TableCell>
                                    <TableCell>{c.isActive !== false ? <Badge variant="secondary">Active</Badge> : <Badge className="bg-muted text-muted-foreground">Inactive</Badge>}</TableCell>
                                    <TableCell>
                                        <div className="flex justify-end gap-1">
                                            <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(c)}><Edit2 className="w-4 h-4" /></Button>
                                            </DisabledWithTooltip>
                                            <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete contractor?')) onDelete(c.id).catch((err) => setError(err.message)); }}><Trash2 className="w-4 h-4" /></Button>
                                            </DisabledWithTooltip>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

// --- Process assignments master --------------------------------------------
function ContractorAssignmentsMasterCrud({ data, contractors, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const empty = { contractorId: '', process: '' };
    const [form, setForm] = useState(empty);
    const [editingId, setEditingId] = useState(null);
    const [error, setError] = useState('');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;
    const contractorName = nameMap(contractors);

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const reset = () => { setForm(empty); setEditingId(null); };
    const submit = async () => {
        if (!form.contractorId || !form.process) return;
        setError('');
        const payload = { contractorId: form.contractorId, process: form.process };
        try {
            if (editingId) await onUpdate(editingId, payload); else await onCreate(payload);
            reset();
        } catch (err) { setError(err.message || 'Failed to save assignment'); }
    };
    const startEdit = (a) => { setEditingId(a.id); setForm({ contractorId: a.contractorId, process: a.process }); setError(''); };

    return (
        <Card>
            <CardHeader><CardTitle>Process Assignments</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <ErrorNote error={error} />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-md border p-3 bg-muted/30 items-end">
                    <div><Label className="text-xs">Contractor *</Label>
                        <Select value={form.contractorId} onChange={(e) => set('contractorId', e.target.value)}>
                            <option value="">Select…</option>
                            {(contractors || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                    </div>
                    <div><Label className="text-xs">Process *</Label>
                        <Select value={form.process} onChange={(e) => set('process', e.target.value)}>
                            <option value="">Select…</option>
                            {CONTRACTOR_PROCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                    </div>
                    <div className="flex gap-2 justify-end">
                        {editingId && <Button variant="ghost" onClick={reset}>Cancel</Button>}
                        <Button onClick={submit} disabled={loading || !form.contractorId || !form.process || (editingId ? !allowEdit : !allowCreate)}>
                            {editingId ? <><Save className="w-4 h-4 mr-2" />Save</> : <><Plus className="w-4 h-4 mr-2" />Add</>}
                        </Button>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground">Each process has one current contractor. Edit the row when responsibility changes; daily reports always use the current owner.</p>

                <div className="rounded-md border max-h-[55vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Contractor</TableHead>
                                <TableHead>Process</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(data || []).length === 0 ? (
                                <TableStateRow colSpan={3} emptyMessage="No assignments yet." />
                            ) : (data || []).map((a) => (
                                <TableRow key={a.id}>
                                    <TableCell className="font-medium">{contractorName.get(a.contractorId) || '—'}</TableCell>
                                    <TableCell className="capitalize">{a.process}</TableCell>
                                    <TableCell>
                                        <div className="flex justify-end gap-1">
                                            <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(a)}><Edit2 className="w-4 h-4" /></Button>
                                            </DisabledWithTooltip>
                                            <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete assignment?')) onDelete(a.id).catch((err) => setError(err.message)); }}><Trash2 className="w-4 h-4" /></Button>
                                            </DisabledWithTooltip>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

// --- Contractor rates master -----------------------------------------------
function MultiSelect({ options = [], selectedIds = [], onChange, disabled = false, disabledWhenEmpty = true, maxSelections = null, placeholder = 'Select…', noun = 'items', searchPlaceholder = 'Search...', ariaLabel = 'Options' }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef(null);

    const optionId = (option) => String(option.id ?? option.value ?? '');
    const optionLabel = (option) => String(option.name ?? option.label ?? optionId(option));

    useEffect(() => {
        if (!open) return undefined;
        const handlePointerDown = (event) => {
            if (!containerRef.current?.contains(event.target)) {
                setOpen(false);
                setSearch('');
            }
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setOpen(false);
                setSearch('');
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    const selectedSet = new Set(selectedIds.map(String));
    const query = search.trim().toLowerCase();
    const visibleOptions = options.filter((option) => !query || optionLabel(option).toLowerCase().includes(query));
    const selectedNames = selectedIds
        .map((id) => options.find((option) => optionId(option) === String(id)))
        .filter(Boolean)
        .map(optionLabel);
    const label = selectedIds.length === 0
        ? placeholder
        : selectedIds.length === 1
            ? (selectedNames[0] || `1 ${noun} selected`)
            : `${selectedIds.length} ${noun} selected`;

    const toggle = (id) => {
        if (disabled) return;
        if (selectedSet.has(id)) {
            onChange(selectedIds.filter((selectedId) => String(selectedId) !== id));
        } else if (maxSelections === 1) {
            onChange([id]);
        } else {
            onChange([...selectedIds, id]);
        }
    };

    const close = () => {
        setOpen(false);
        setSearch('');
    };

    return (
        <div ref={containerRef} className="relative">
            <Button
                type="button"
                variant="outline"
                className="w-full justify-between font-normal"
                onClick={() => setOpen((value) => !value)}
                disabled={disabled || (disabledWhenEmpty && options.length === 0)}
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <span className="truncate text-left">{label}</span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
            </Button>
            {open && (
                <div className="absolute left-0 right-0 z-50 mt-1 rounded-md border border-input bg-background p-2 shadow-lg">
                    <Input
                        autoFocus
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={searchPlaceholder}
                        aria-label={`Search ${ariaLabel.toLowerCase()}`}
                        className="mb-2 h-9"
                    />
                    <div className="max-h-48 overflow-auto" role="listbox" aria-label={ariaLabel}>
                        {visibleOptions.length === 0 ? (
                            <div className="px-2 py-2 text-xs text-muted-foreground">No matching options.</div>
                        ) : visibleOptions.map((option) => {
                            const id = optionId(option);
                            const checked = selectedSet.has(id);
                            const atLimit = maxSelections !== null && selectedIds.length >= maxSelections && !checked;
                            return (
                                <label key={id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm hover:bg-accent">
                                    <Checkbox
                                        checked={checked}
                                        disabled={disabled || atLimit}
                                        onCheckedChange={() => toggle(id)}
                                        aria-label={optionLabel(option)}
                                    />
                                    <span className="truncate">{optionLabel(option)}</span>
                                </label>
                            );
                        })}
                    </div>
                    <div className="mt-2 flex justify-between gap-2 border-t pt-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])} disabled={disabled || selectedIds.length === 0}>Clear</Button>
                        <Button type="button" size="sm" onClick={close}>Done</Button>
                    </div>
                </div>
            )}
        </div>
    );
}

function ContractorRatesMasterCrud({ data, contractors, items, yarns, cuts, twists, coneTypes, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const empty = { contractorId: '', process: '', itemId: '', yarnIds: [], cutId: '', sides: [], twistId: '', coneTypeIds: [], ratePerKg: '' };
    const [form, setForm] = useState(empty);
    const [editingId, setEditingId] = useState(null);
    const [error, setError] = useState('');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const contractorName = nameMap(contractors);
    const itemName = nameMap(items);
    const yarnName = nameMap(yarns);
    const cutName = nameMap(cuts);
    const twistName = nameMap(twists);
    const coneTypeName = nameMap(coneTypes);

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const reset = () => { setForm(empty); setEditingId(null); };

    const submit = async () => {
        setError('');
        const rate = Number(form.ratePerKg);
        if (!form.contractorId || !form.process || !(rate > 0)) return;
        const payload = {
            contractorId: form.contractorId,
            process: form.process,
            ratePerKg: rate,
            itemId: form.process === 'cutter' ? (form.itemId || null) : null,
            cutId: form.cutId || null,
            twistId: form.process !== 'cutter' ? (form.twistId || null) : null,
        };
        if (form.process !== 'cutter') {
            if (editingId) payload.yarnId = form.yarnIds[0] || null;
            else payload.yarnIds = form.yarnIds;
        }
        if (form.process === 'coning') {
            if (editingId) {
                payload.side = form.sides[0] || null;
                payload.coneTypeId = form.coneTypeIds[0] || null;
            } else {
                payload.sides = form.sides;
                payload.coneTypeIds = form.coneTypeIds;
            }
        }
        try {
            if (editingId) await onUpdate(editingId, payload); else await onCreate(payload);
            reset();
        } catch (err) { setError(err.message || 'Failed to save rate'); }
    };
    const startEdit = (r) => {
        setEditingId(r.id);
        setForm({
            contractorId: r.contractorId, process: r.process,
            itemId: r.itemId || '', yarnIds: r.yarnId ? [r.yarnId] : [], cutId: r.cutId || '', sides: r.side ? [r.side] : [],
            twistId: r.twistId || '', coneTypeIds: r.coneTypeId ? [r.coneTypeId] : [],
            ratePerKg: r.ratePerKg != null ? String(r.ratePerKg) : '',
        });
        setError('');
    };

    const describeKeys = (r) => {
        const parts = [];
        if (r.process === 'cutter') {
            parts.push(r.itemId ? `Item:${itemName.get(r.itemId) || '?'}` : 'Any item');
            parts.push(r.cutId ? `Cut:${cutName.get(r.cutId) || '?'}` : 'Any cut');
        }
        else { parts.push(yarnName.get(r.yarnId) || 'Yarn?'); if (r.cutId) parts.push(`Cut:${cutName.get(r.cutId) || '?'}`); }
        if (r.process === 'coning') parts.push(r.side === 'SINGLE' ? 'S/S' : r.side === 'BOTH' ? 'B/S' : 'Side?');
        if (r.twistId) parts.push(`Twist:${twistName.get(r.twistId) || '?'}`);
        if (r.coneTypeId) parts.push(`Cone:${coneTypeName.get(r.coneTypeId) || '?'}`);
        return parts.join(' · ');
    };

    const rows = data || [];
    const process = form.process;
    const rateValue = Number(form.ratePerKg);
    const formReady = !!form.contractorId && !!process && rateValue > 0 && (
        process === 'cutter' ? true
            : process === 'holo' ? form.yarnIds.length > 0
                : process === 'coning' ? (form.yarnIds.length > 0 && form.sides.length > 0)
                    : false
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>Contractor Rates (₹/KG)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <ErrorNote error={error} />
                <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div><Label className="text-xs">Contractor *</Label>
                            <Select value={form.contractorId} onChange={(e) => set('contractorId', e.target.value)}>
                                <option value="">Select…</option>
                                {(contractors || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </Select>
                        </div>
                        <div><Label className="text-xs">Process *</Label>
                            <Select value={form.process} onChange={(e) => set('process', e.target.value)}>
                                <option value="">Select…</option>
                                {CONTRACTOR_PROCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                        </div>
                        <div><Label className="text-xs">Rate ₹/KG *</Label><Input type="number" step="0.0001" min="0" value={form.ratePerKg} onChange={(e) => set('ratePerKg', e.target.value)} /></div>
                    </div>

                    {process && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {process === 'cutter' && (
                                <div><Label className="text-xs">Item (optional override)</Label>
                                    <Select value={form.itemId} onChange={(e) => set('itemId', e.target.value)}>
                                        <option value="">Any item</option>
                                        {(items || []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                                    </Select>
                                </div>
                            )}
                            {process !== 'cutter' && (
                                <div><Label className="text-xs">Yarn *</Label>
                                    <MultiSelect
                                        options={yarns || []}
                                        selectedIds={form.yarnIds}
                                        onChange={(ids) => set('yarnIds', ids)}
                                        disabled={loading}
                                        maxSelections={editingId ? 1 : null}
                                        noun="yarns"
                                        searchPlaceholder="Search yarns..."
                                        ariaLabel="Yarns"
                                    />
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                        {editingId ? 'Editing updates this one rate row.' : 'Select multiple yarns to apply the same rate to each one.'}
                                    </p>
                                </div>
                            )}
                            <div><Label className="text-xs">Cut (optional override)</Label>
                                <Select value={form.cutId} onChange={(e) => set('cutId', e.target.value)}>
                                    <option value="">{process === 'cutter' ? 'Any cut' : 'Any'}</option>
                                    {(cuts || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </Select>
                                {process === 'cutter' && <p className="mt-1 text-[11px] text-muted-foreground">Leave either field empty to apply this rate to all matching items or cuts.</p>}
                            </div>
                            {process === 'coning' && (
                                <div><Label className="text-xs">Side *</Label>
                                    <MultiSelect
                                        options={SIDE_OPTIONS}
                                        selectedIds={form.sides}
                                        onChange={(ids) => set('sides', ids)}
                                        disabled={loading}
                                        maxSelections={editingId ? 1 : null}
                                        noun="sides"
                                        ariaLabel="Sides"
                                    />
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                        {editingId ? 'Editing updates this one rate row.' : 'Select multiple sides to apply the same rate to each one.'}
                                    </p>
                                </div>
                            )}
                            {process !== 'cutter' && (
                                <div><Label className="text-xs">Twist (optional override)</Label>
                                    <Select value={form.twistId} onChange={(e) => set('twistId', e.target.value)}>
                                        <option value="">Any</option>
                                        {(twists || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                    </Select>
                                </div>
                            )}
                            {process === 'coning' && (
                                <div><Label className="text-xs">Cone Type (optional override)</Label>
                                    <MultiSelect
                                        options={coneTypes || []}
                                        selectedIds={form.coneTypeIds}
                                        onChange={(ids) => set('coneTypeIds', ids)}
                                        disabled={loading}
                                        disabledWhenEmpty={false}
                                        maxSelections={editingId ? 1 : null}
                                        placeholder="Any"
                                        noun="cone types"
                                        searchPlaceholder="Search cone types..."
                                        ariaLabel="Cone types"
                                    />
                                    <p className="mt-1 text-[11px] text-muted-foreground">Leave empty for Any.</p>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
                        {editingId && <Button variant="ghost" onClick={reset}>Cancel</Button>}
                        <Button onClick={submit} disabled={loading || !formReady || (editingId ? !allowEdit : !allowCreate)}>
                            {editingId ? <><Save className="w-4 h-4 mr-2" />Save</> : <><Plus className="w-4 h-4 mr-2" />Add</>}
                        </Button>
                    </div>
                </div>

                <div className="rounded-md border max-h-[50vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Contractor</TableHead>
                                <TableHead>Process</TableHead>
                                <TableHead>Quality keys</TableHead>
                                <TableHead className="text-right">₹/KG</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.length === 0 ? (
                                <TableStateRow colSpan={5} emptyMessage="No rates configured." />
                            ) : rows.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell className="font-medium">{contractorName.get(r.contractorId) || '—'}</TableCell>
                                    <TableCell className="capitalize">{r.process}</TableCell>
                                    <TableCell className="text-sm">{describeKeys(r)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{Number(r.ratePerKg).toFixed(2)}</TableCell>
                                    <TableCell>
                                        <div className="flex justify-end gap-1">
                                            <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(r)}><Edit2 className="w-4 h-4" /></Button>
                                            </DisabledWithTooltip>
                                            <DisabledWithTooltip disabled={!allowDelete} tooltip="You do not have permission to delete master records.">
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete rate?')) onDelete(r.id).catch((err) => setError(err.message)); }}><Trash2 className="w-4 h-4" /></Button>
                                            </DisabledWithTooltip>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}

// --- Combined stock master -------------------------------------------------
// Rows are seeded by migration (one per stock view); this master only toggles,
// relabels and reorders them, so there is no create/delete here.
const COMBINED_STOCK_DISPLAY_MODE_OPTIONS = [
    { value: 'summary', label: 'Summary + expandable lots', hint: 'One totals row per process; expand a row to see its lots.' },
    { value: 'full', label: 'Full tables per process', hint: 'Each enabled process renders its full stock table.' },
];

function CombinedStockMasterCrud({ data, config, onUpdateView, onReorderViews, onUpdateConfig, loading, canEdit }) {
    const [editingId, setEditingId] = useState(null);
    const [editLabel, setEditLabel] = useState('');
    const [error, setError] = useState('');
    const [modeError, setModeError] = useState('');
    const [saving, setSaving] = useState(false);
    const [savingMode, setSavingMode] = useState(false);
    const allowEdit = !!canEdit;

    const rows = [...(data || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const displayMode = config?.displayMode === 'full' ? 'full' : 'summary';
    const busy = loading || saving;

    const startEdit = (row) => { setEditingId(row.id); setEditLabel(row.label || ''); setError(''); };

    const saveLabel = async (row) => {
        const label = editLabel.trim();
        if (!allowEdit || !label) return;
        setError('');
        setSaving(true);
        try {
            await onUpdateView(row.id, { label });
            setEditingId(null);
        } catch (err) { setError(err.message || 'Failed to update process view'); }
        finally { setSaving(false); }
    };

    const toggleEnabled = async (row, checked) => {
        if (!allowEdit) return;
        setError('');
        setSaving(true);
        try { await onUpdateView(row.id, { isEnabled: !!checked }); }
        catch (err) { setError(err.message || 'Failed to update process view'); }
        finally { setSaving(false); }
    };

    // Reorder posts the full id list in its new order; the API rejects partial lists.
    const move = async (index, direction) => {
        const target = index + direction;
        if (!allowEdit || target < 0 || target >= rows.length) return;
        const orderedIds = rows.map((r) => r.id);
        [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
        setError('');
        setSaving(true);
        try { await onReorderViews(orderedIds); }
        catch (err) { setError(err.message || 'Failed to reorder process views'); }
        finally { setSaving(false); }
    };

    const changeMode = async (mode) => {
        if (!allowEdit || mode === displayMode) return;
        setModeError('');
        setSavingMode(true);
        try { await onUpdateConfig({ displayMode: mode }); }
        catch (err) { setModeError(err.message || 'Failed to update display mode'); }
        finally { setSavingMode(false); }
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Process Views</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Choose which stock views appear in Combined Stock and in what order. The rows are fixed — each one maps to an existing stock view.
                    </p>
                </CardHeader>
                <CardContent className="space-y-4">
                    <ErrorNote error={error} />

                    <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Label</TableHead>
                                    <TableHead>Process Key</TableHead>
                                    <TableHead>Enabled</TableHead>
                                    <TableHead className="w-[110px]">Order</TableHead>
                                    <TableHead>Updated By</TableHead>
                                    <TableHead className="w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.length === 0 ? (
                                    <TableStateRow colSpan={6} isLoading={loading} emptyMessage="No process views configured." />
                                ) : rows.map((row, index) => (
                                    <TableRow key={row.id}>
                                        <TableCell className="font-medium">
                                            {editingId === row.id ? (
                                                <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="h-8" disabled={!allowEdit} />
                                            ) : row.label}
                                        </TableCell>
                                        <TableCell><Badge variant="secondary">{row.processKey}</Badge></TableCell>
                                        <TableCell>
                                            <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                <Checkbox
                                                    checked={row.isEnabled !== false}
                                                    onCheckedChange={(checked) => toggleEnabled(row, checked)}
                                                    disabled={busy}
                                                    aria-label={`Enable ${row.label}`}
                                                />
                                            </DisabledWithTooltip>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-1">
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label={`Move ${row.label} up`}><ArrowUp className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(index, 1)} disabled={busy || index === rows.length - 1} aria-label={`Move ${row.label} down`}><ArrowDown className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <UserBadge user={row.updatedByUser} timestamp={row.updatedAt} />
                                        </TableCell>
                                        <TableCell>
                                            {editingId === row.id ? (
                                                <div className="flex justify-end gap-1">
                                                    <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                        <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => saveLabel(row)} disabled={busy || !editLabel.trim()}><Save className="w-4 h-4" /></Button>
                                                    </DisabledWithTooltip>
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                                </div>
                                            ) : (
                                                <div className="flex justify-end gap-1">
                                                    <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(row)}><Edit2 className="w-4 h-4" /></Button>
                                                    </DisabledWithTooltip>
                                                </div>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="block sm:hidden space-y-2">
                        {rows.length === 0 ? (
                            <div className="text-center py-4 text-muted-foreground border rounded-lg bg-card">No process views configured</div>
                        ) : rows.map((row, index) => (
                            <div key={row.id} className="border rounded-lg bg-card p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        {editingId === row.id ? (
                                            <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="h-8" disabled={!allowEdit} />
                                        ) : (
                                            <span className="font-medium">{row.label}</span>
                                        )}
                                    </div>
                                    <Badge variant="secondary">{row.processKey}</Badge>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                    <label className="flex items-center gap-2 text-sm">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Checkbox
                                                checked={row.isEnabled !== false}
                                                onCheckedChange={(checked) => toggleEnabled(row, checked)}
                                                disabled={busy}
                                                aria-label={`Enabled ${row.label}`}
                                            />
                                        </DisabledWithTooltip>
                                        Enabled
                                    </label>
                                    <div className="flex gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label={`Move ${row.label} up`}><ArrowUp className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(index, 1)} disabled={busy || index === rows.length - 1} aria-label={`Move ${row.label} down`}><ArrowDown className="w-4 h-4" /></Button>
                                        </DisabledWithTooltip>
                                        {editingId === row.id ? (
                                            <>
                                                <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600" onClick={() => saveLabel(row)} disabled={busy || !editLabel.trim()}><Save className="w-4 h-4" /></Button>
                                                </DisabledWithTooltip>
                                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setEditingId(null)}><X className="w-4 h-4" /></Button>
                                            </>
                                        ) : (
                                            <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(row)}><Edit2 className="w-4 h-4" /></Button>
                                            </DisabledWithTooltip>
                                        )}
                                    </div>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    Updated by <UserBadge user={row.updatedByUser} timestamp={row.updatedAt} />
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Display Mode</CardTitle>
                    <p className="text-sm text-muted-foreground">
                        Controls how Combined Stock renders each enabled process view.
                    </p>
                </CardHeader>
                <CardContent className="space-y-3">
                    <ErrorNote error={modeError} />
                    {COMBINED_STOCK_DISPLAY_MODE_OPTIONS.map((option) => (
                        <div key={option.value} className="flex items-start gap-2 rounded-md border p-3 bg-muted/30">
                            <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                <input
                                    type="radio"
                                    id={`combined-stock-mode-${option.value}`}
                                    name="combinedStockDisplayMode"
                                    className="w-4 h-4 mt-0.5"
                                    checked={displayMode === option.value}
                                    disabled={loading || savingMode}
                                    onChange={() => changeMode(option.value)}
                                />
                            </DisabledWithTooltip>
                            <label htmlFor={`combined-stock-mode-${option.value}`} className="text-sm font-medium cursor-pointer">
                                {option.label}
                                <span className="block text-xs font-normal text-muted-foreground">{option.hint}</span>
                            </label>
                        </div>
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}
