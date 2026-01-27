import React, { useState } from 'react';
import { useInventory } from '../context/InventoryContext';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Select, Badge, Label } from '../components/ui';
import { Plus, Trash2, Edit2, Save, X, Search } from 'lucide-react';
import { formatKg } from '../utils';
import { usePermission } from '../hooks/usePermission';
import { DisabledWithTooltip } from '../components/common/DisabledWithTooltip';
import AccessDenied from '../components/common/AccessDenied';
import { UserBadge } from '../components/common/UserBadge';

// Process type options for dropdowns
const PROCESS_OPTIONS = [
    { value: 'all', label: 'All Processes' },
    { value: 'cutter', label: 'Cutter' },
    { value: 'holo', label: 'Holo' },
    { value: 'coning', label: 'Coning' },
];



export function Masters() {
    const {
        db,
        createItem, updateItem, deleteItem,
        createYarn, updateYarn, deleteYarn,
        createCut, updateCut, deleteCut,
        createTwist, updateTwist, deleteTwist,
        createFirm, updateFirm, deleteFirm,
        createCustomer, updateCustomer, deleteCustomer,
        createSupplier, updateSupplier, deleteSupplier,
        createMachine, updateMachine, deleteMachine,
        createOperator, updateOperator, deleteOperator,
        createBobbin, updateBobbin, deleteBobbin,
        createRollType, updateRollType, deleteRollType,
        createConeType, updateConeType, deleteConeType,
        createWrapper, updateWrapper, deleteWrapper,
        createBox, updateBox, deleteBox,
        refreshing
    } = useInventory();
    const { canRead, canWrite, canEdit, canDelete } = usePermission('masters');
    const canCreate = canWrite;

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
            case 'items': return <SimpleMasterCrud title="Items" data={db.items} onCreate={createItem} onUpdate={updateItem} onDelete={deleteItem} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'yarns': return <SimpleMasterCrud title="Yarns" data={db.yarns} onCreate={createYarn} onUpdate={updateYarn} onDelete={deleteYarn} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'cuts': return <SimpleMasterCrud title="Cuts" data={db.cuts} onCreate={createCut} onUpdate={updateCut} onDelete={deleteCut} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'twists': return <SimpleMasterCrud title="Twists" data={db.twists} onCreate={createTwist} onUpdate={updateTwist} onDelete={deleteTwist} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'firms': return <FirmsMasterCrud data={db.firms} onCreate={createFirm} onUpdate={updateFirm} onDelete={deleteFirm} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'customers': return <CustomersMasterCrud data={db.customers} onCreate={createCustomer} onUpdate={updateCustomer} onDelete={deleteCustomer} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'suppliers': return <SimpleMasterCrud title="Suppliers" data={db.suppliers} onCreate={createSupplier} onUpdate={updateSupplier} onDelete={deleteSupplier} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'machines': return <MachinesMasterCrud data={db.machines || []} onCreate={createMachine} onUpdate={updateMachine} onDelete={deleteMachine} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'workers': return <WorkersMaster data={db.workers || []} onCreate={createOperator} onUpdate={updateOperator} onDelete={deleteOperator} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'bobbins': return <WeightMasterCrud title="Bobbins" data={db.bobbins} onCreate={createBobbin} onUpdate={updateBobbin} onDelete={deleteBobbin} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'rollTypes': return <WeightMasterCrud title="Roll Types" data={db.rollTypes} onCreate={createRollType} onUpdate={updateRollType} onDelete={deleteRollType} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'coneTypes': return <WeightMasterCrud title="Cone Types" data={db.cone_types} onCreate={createConeType} onUpdate={updateConeType} onDelete={deleteConeType} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'wrappers': return <SimpleMasterCrud title="Wrappers" data={db.wrappers} onCreate={createWrapper} onUpdate={updateWrapper} onDelete={deleteWrapper} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
            case 'boxes': return <BoxesMasterCrud data={db.boxes || []} onCreate={createBox} onUpdate={updateBox} onDelete={deleteBox} loading={refreshing} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} />;
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
                        <TabButton id="rollTypes" label="Roll Types" />

                        <SectionDivider label="Coning" />
                        <TabButton id="coneTypes" label="Cone Types" />
                        <TabButton id="wrappers" label="Wrappers" />

                        <SectionDivider label="Shared" />
                        <TabButton id="machines" label="Machines" />
                        <TabButton id="workers" label="Workers" />
                        <TabButton id="boxes" label="Boxes" />
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

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{title}</CardTitle>
                <div className="relative w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input placeholder={`New ${title} name`} value={newName} onChange={e => setNewName(e.target.value)} disabled={!allowCreate} />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate}><Plus className="w-4 h-4 mr-2" /> Add</Button>
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
                                <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
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
                                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete?')) onDelete(item.id) }}><Trash2 className="w-4 h-4" /></Button>
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
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{title}</CardTitle>
                <div className="relative w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} className="flex-1" disabled={!allowCreate} />
                    <Input placeholder="Weight (kg)" type="number" step="0.001" value={newWeight} onChange={e => setNewWeight(e.target.value)} className="w-32" disabled={!allowCreate} />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate}><Plus className="w-4 h-4 mr-2" /> Add</Button>
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
                                <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
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

// New component for Machines with processType support
function MachinesMasterCrud({ data, onCreate, onUpdate, onDelete, loading, canCreate, canEdit, canDelete }) {
    const [newName, setNewName] = useState('');
    const [newProcessType, setNewProcessType] = useState('all');
    const [search, setSearch] = useState('');
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [editProcessType, setEditProcessType] = useState('all');
    const allowCreate = !!canCreate;
    const allowEdit = !!canEdit;
    const allowDelete = !!canDelete;

    const filtered = (data || []).filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

    const handleCreate = async () => {
        if (!allowCreate) return;
        if (!newName.trim()) return;
        await onCreate(newName, newProcessType);
        setNewName('');
        setNewProcessType('all');
    }

    const handleUpdate = async (id) => {
        if (!allowEdit) return;
        if (!editName.trim()) return;
        await onUpdate(id, editName, editProcessType);
        setEditingId(null);
    }



    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Machines</CardTitle>
                <div className="relative w-48">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex gap-2">
                    <Input placeholder="Machine Name" value={newName} onChange={e => setNewName(e.target.value)} className="flex-1" disabled={!allowCreate} />
                    <Select
                        value={newProcessType}
                        onChange={e => setNewProcessType(e.target.value)}
                        className="w-40"
                        options={PROCESS_OPTIONS}
                        searchable={false}
                        disabled={!allowCreate}
                    />
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate}><Plus className="w-4 h-4 mr-2" /> Add</Button>
                </div>

                <div className="hidden sm:block rounded-md border max-h-[60vh] overflow-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Process</TableHead>
                                <TableHead>Added By</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.length === 0 ? (
                                <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
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
                                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditProcessType(item.processType || 'all') }}><Edit2 className="w-4 h-4" /></Button>
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
                                    <Select value={editProcessType} onChange={e => setEditProcessType(e.target.value)} options={PROCESS_OPTIONS} searchable={false} disabled={!allowEdit} />
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
                                        <span className="text-xs text-muted-foreground ml-2">({PROCESS_OPTIONS.find(o => o.value === item.processType)?.label || 'All'})</span>
                                    </div>
                                    <div className="flex gap-1">
                                        <DisabledWithTooltip disabled={!allowEdit} tooltip="You do not have permission to edit master records.">
                                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(item.id); setEditName(item.name); setEditProcessType(item.processType || 'all') }}><Edit2 className="w-4 h-4" /></Button>
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
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Workers</CardTitle>
                <div className="relative w-48">
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
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate}><Plus className="w-4 h-4 mr-2" /> Add</Button>
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
                                <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
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
                                    <div className="grid grid-cols-2 gap-2">
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
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Boxes</CardTitle>
                <div className="relative w-48">
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
                    <Button onClick={handleCreate} disabled={loading || !newName.trim() || !allowCreate}><Plus className="w-4 h-4 mr-2" /> Add</Button>
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
                                <TableRow><TableCell colSpan={5} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
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
                                    <div className="grid grid-cols-2 gap-2">
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
                                <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
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
                                <TableRow><TableCell colSpan={3} className="text-center py-4 text-muted-foreground">No records found</TableCell></TableRow>
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
