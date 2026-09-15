import React, { useMemo, useState } from 'react';
import { Button, Input, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Select, Badge } from '../ui';
import { TableStateRow } from '../data-table';
import { Plus, Edit2, Save, X, Search, Trash2 } from 'lucide-react';

const UNCATEGORIZED_VALUE = '';

function sortByName(rows = []) {
    return [...rows].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
}

function buildCategoryOptions(categories, extraCategoryId) {
    const options = [
        { value: UNCATEGORIZED_VALUE, label: 'Uncategorized' },
        ...sortByName(categories).map((category) => ({ value: category.id, label: category.name })),
    ];
    if (extraCategoryId && !options.some((option) => option.value === extraCategoryId)) {
        options.push({ value: extraCategoryId, label: 'Archived category' });
    }
    return options;
}

/**
 * Masters > Other Wastage.
 *
 * Two interfaces share this tab:
 *   1. Items  - the existing other-wastage item list, now with a category per row.
 *   2. Categories - the category master the export rolls up to.
 *
 * The Holo daily export prints one row per category (sum of its items) instead of
 * one row per item, so every item should carry a category to appear under.
 */
export function OtherWastageMaster({
    items = [],
    categories = [],
    onCreateItem,
    onUpdateItem,
    onDeleteItem,
    onCreateCategory,
    onUpdateCategory,
    onDeleteCategory,
    loading = false,
    canCreate = false,
    canEdit = false,
    canDelete = false,
}) {
    const [view, setView] = useState('items');
    const [search, setSearch] = useState('');
    const [message, setMessage] = useState(null);
    const [busy, setBusy] = useState(false);

    const [newItemName, setNewItemName] = useState('');
    const [newItemCategoryId, setNewItemCategoryId] = useState(UNCATEGORIZED_VALUE);
    const [editingItemId, setEditingItemId] = useState(null);
    const [editItemName, setEditItemName] = useState('');
    const [editItemCategoryId, setEditItemCategoryId] = useState(UNCATEGORIZED_VALUE);

    const [newCategoryName, setNewCategoryName] = useState('');
    const [editingCategoryId, setEditingCategoryId] = useState(null);
    const [editCategoryName, setEditCategoryName] = useState('');

    const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
    const itemCountByCategoryId = useMemo(() => {
        const counts = new Map();
        items.forEach((item) => {
            if (!item.categoryId) return;
            counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1);
        });
        return counts;
    }, [items]);

    const filteredItems = useMemo(() => {
        const term = search.trim().toLowerCase();
        const rows = sortByName(items);
        if (!term) return rows;
        return rows.filter((item) => {
            const categoryName = categoryById.get(item.categoryId)?.name || 'uncategorized';
            return item.name.toLowerCase().includes(term) || categoryName.toLowerCase().includes(term);
        });
    }, [items, search, categoryById]);

    const runAction = async (action, successMessage) => {
        setBusy(true);
        setMessage(null);
        try {
            await action();
            if (successMessage) setMessage({ type: 'success', message: successMessage });
            return true;
        } catch (err) {
            setMessage({ type: 'error', message: err?.message || 'Action failed.' });
            return false;
        } finally {
            setBusy(false);
        }
    };

    const handleCreateItem = async () => {
        if (!canCreate || !newItemName.trim() || busy) return;
        const created = await runAction(
            () => onCreateItem(newItemName.trim(), newItemCategoryId),
            `Item ${newItemName.trim()} added.`,
        );
        if (created) {
            setNewItemName('');
            setNewItemCategoryId(UNCATEGORIZED_VALUE);
        }
    };

    const handleUpdateItem = async (item) => {
        if (!canEdit || !editItemName.trim() || busy) return;
        const saved = await runAction(
            () => onUpdateItem(item.id, editItemName.trim(), editItemCategoryId),
            `${editItemName.trim()} updated.`,
        );
        if (saved) {
            setEditingItemId(null);
            setEditItemName('');
            setEditItemCategoryId(UNCATEGORIZED_VALUE);
        }
    };

    const handleDeleteItem = async (item) => {
        if (!canDelete || busy) return;
        if (!confirm(`Delete ${item.name}? Past wastage totals for this item stay in the reports.`)) return;
        await runAction(() => onDeleteItem(item.id), `${item.name} deleted.`);
    };

    const handleCreateCategory = async () => {
        if (!canCreate || !newCategoryName.trim() || busy) return;
        const created = await runAction(
            () => onCreateCategory(newCategoryName.trim()),
            `Category ${newCategoryName.trim()} added.`,
        );
        if (created) setNewCategoryName('');
    };

    const handleUpdateCategory = async (category) => {
        if (!canEdit || !editCategoryName.trim() || busy) return;
        const saved = await runAction(
            () => onUpdateCategory(category.id, editCategoryName.trim()),
            `${editCategoryName.trim()} updated.`,
        );
        if (saved) {
            setEditingCategoryId(null);
            setEditCategoryName('');
        }
    };

    const handleDeleteCategory = async (category) => {
        if (!canDelete || busy) return;
        const linkedItems = itemCountByCategoryId.get(category.id) || 0;
        const warning = linkedItems > 0
            ? `Delete category ${category.name}? ${linkedItems} item(s) keep this category and stay grouped under it in reports until you reassign them.`
            : `Delete category ${category.name}?`;
        if (!confirm(warning)) return;
        await runAction(() => onDeleteCategory(category.id), `${category.name} deleted.`);
    };

    const viewToggle = (
        <div className="flex flex-wrap p-1 bg-muted rounded-lg">
            {[{ id: 'items', label: 'Items' }, { id: 'categories', label: 'Categories' }].map((option) => (
                <button
                    key={option.id}
                    type="button"
                    onClick={() => setView(option.id)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${view === option.id ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );

    return (
        <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle>Other Wastage</CardTitle>
                {viewToggle}
            </CardHeader>
            <CardContent className="space-y-4">
                {message && (
                    <div
                        role={message.type === 'error' ? 'alert' : 'status'}
                        className={`rounded-md border px-3 py-2 text-sm ${message.type === 'error'
                            ? 'border-destructive/40 bg-destructive/10 text-destructive'
                            : 'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400'}`}
                    >
                        {message.message}
                    </div>
                )}

                {view === 'items' ? (
                    <>
                        <p className="text-sm text-muted-foreground">
                            The Holo daily export prints one row per category. Every item here should have a category to be counted.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                                placeholder="New other wastage item name"
                                value={newItemName}
                                onChange={(e) => setNewItemName(e.target.value)}
                                disabled={!canCreate || busy}
                            />
                            <div className="sm:w-56">
                                <Select
                                    value={newItemCategoryId}
                                    onChange={(e) => setNewItemCategoryId(e.target.value)}
                                    options={buildCategoryOptions(categories)}
                                    placeholder="Uncategorized"
                                    disabled={!canCreate || busy}
                                />
                            </div>
                            <Button
                                onClick={handleCreateItem}
                                disabled={loading || busy || !newItemName.trim() || !canCreate}
                                className="w-full sm:w-auto"
                            >
                                <Plus className="w-4 h-4 mr-2" /> Add
                            </Button>
                        </div>
                        <div className="relative w-full sm:w-56">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search items..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-8 h-9"
                            />
                        </div>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Item</TableHead>
                                        <TableHead>Category</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredItems.length === 0 ? (
                                        <TableStateRow colSpan={3} isLoading={loading} emptyMessage="No other wastage items yet." />
                                    ) : filteredItems.map((item) => {
                                        const isEditing = editingItemId === item.id;
                                        const category = categoryById.get(item.categoryId);
                                        return (
                                            <TableRow key={item.id}>
                                                <TableCell>
                                                    {isEditing ? (
                                                        <Input value={editItemName} onChange={(e) => setEditItemName(e.target.value)} className="h-8" disabled={!canEdit || busy} />
                                                    ) : item.name}
                                                </TableCell>
                                                <TableCell>
                                                    {isEditing ? (
                                                        <Select
                                                            value={editItemCategoryId}
                                                            onChange={(e) => setEditItemCategoryId(e.target.value)}
                                                            options={buildCategoryOptions(categories, item.categoryId)}
                                                            placeholder="Uncategorized"
                                                            disabled={!canEdit || busy}
                                                        />
                                                    ) : (category?.name
                                                        ? <Badge variant="secondary">{category.name}</Badge>
                                                        : (item.categoryId
                                                            ? <Badge variant="outline">Archived category</Badge>
                                                            : <span className="text-muted-foreground">Uncategorized</span>))}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        {isEditing ? (
                                                            <>
                                                                <Button size="sm" onClick={() => handleUpdateItem(item)} disabled={busy || !canEdit}>
                                                                    <Save className="w-4 h-4" />
                                                                </Button>
                                                                <Button size="sm" variant="ghost" onClick={() => { setEditingItemId(null); setEditItemName(''); }} disabled={busy}>
                                                                    <X className="w-4 h-4" />
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Button size="sm" variant="ghost" onClick={() => { setEditingItemId(item.id); setEditItemName(item.name); setEditItemCategoryId(item.categoryId || UNCATEGORIZED_VALUE); }} disabled={!canEdit || busy}>
                                                                    <Edit2 className="w-4 h-4" />
                                                                </Button>
                                                                <Button size="sm" variant="ghost" onClick={() => handleDeleteItem(item)} disabled={!canDelete || busy}>
                                                                    <Trash2 className="w-4 h-4 text-destructive" />
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-sm text-muted-foreground">
                            Categories group other wastage in the Holo daily export, for example the machine or process the wastage came from. Archiving a category keeps the items linked to it.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                                placeholder="New category name"
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                disabled={!canCreate || busy}
                            />
                            <Button
                                onClick={handleCreateCategory}
                                disabled={loading || busy || !newCategoryName.trim() || !canCreate}
                                className="w-full sm:w-auto"
                            >
                                <Plus className="w-4 h-4 mr-2" /> Add
                            </Button>
                        </div>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Category</TableHead>
                                        <TableHead className="text-right">Items</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {categories.length === 0 ? (
                                        <TableStateRow colSpan={3} isLoading={loading} emptyMessage="No categories yet." />
                                    ) : sortByName(categories).map((category) => (
                                        <TableRow key={category.id}>
                                            <TableCell>
                                                {editingCategoryId === category.id ? (
                                                    <Input value={editCategoryName} onChange={(e) => setEditCategoryName(e.target.value)} className="h-8" disabled={!canEdit || busy} />
                                                ) : category.name}
                                            </TableCell>
                                            <TableCell className="text-right">{itemCountByCategoryId.get(category.id) || 0}</TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    {editingCategoryId === category.id ? (
                                                        <>
                                                            <Button size="sm" onClick={() => handleUpdateCategory(category)} disabled={busy || !canEdit}>
                                                                <Save className="w-4 h-4" />
                                                            </Button>
                                                            <Button size="sm" variant="ghost" onClick={() => { setEditingCategoryId(null); setEditCategoryName(''); }} disabled={busy}>
                                                                <X className="w-4 h-4" />
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Button size="sm" variant="ghost" onClick={() => { setEditingCategoryId(category.id); setEditCategoryName(category.name); }} disabled={!canEdit || busy}>
                                                                <Edit2 className="w-4 h-4" />
                                                            </Button>
                                                            <Button size="sm" variant="ghost" onClick={() => handleDeleteCategory(category)} disabled={!canDelete || busy}>
                                                                <Trash2 className="w-4 h-4 text-destructive" />
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

export default OtherWastageMaster;
