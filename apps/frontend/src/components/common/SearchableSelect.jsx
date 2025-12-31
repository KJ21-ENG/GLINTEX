/**
 * SearchableSelect - Advanced searchable dropdown component
 * 
 * Features:
 * - Fuzzy search with scoring (exact > starts with > contains)
 * - Keyboard navigation (arrows, enter, escape, tab)
 * - Match highlighting in options
 * - Clear button option
 * - Recent items tracking
 * - Portal-based dropdown for proper z-index
 * - Full ARIA accessibility
 * - Inline search input (transforms trigger into search when open)
 * - Backward compatible with existing Select API
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useBrand } from '../../context';
import { X, ChevronDown, Check, Search, Loader2 } from 'lucide-react';
import { fuzzyScore } from '../../utils';
import { HighlightMatch } from './HighlightMatch';


// Recent items storage (session-based)
const recentItemsCache = new Map();
const MAX_RECENT = 3;

function getRecentItems(cacheKey) {
    return recentItemsCache.get(cacheKey) || [];
}

function addRecentItem(cacheKey, value) {
    const recent = getRecentItems(cacheKey).filter(v => v !== value);
    recent.unshift(value);
    recentItemsCache.set(cacheKey, recent.slice(0, MAX_RECENT));
}

export const SearchableSelect = ({
    className = '',
    children,
    options = null,
    value,
    onChange,
    labelKey = 'label',
    valueKey = 'value',
    searchable = true,
    clearable = false,
    disabled = false,
    loading = false,
    placeholder = 'Select...',
    emptyMessage = 'No options found',
    cacheKey = null,
    renderOption = null,
    minSearchLength = 0,
    showSearchThreshold = 1,
    groupBy = null,
    ...rest
}) => {
    const { cls } = useBrand();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlight, setHighlight] = useState(-1);
    const wrapperRef = useRef(null);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 0, minWidth: 0 });

    // Build options from props or children
    const builtOptions = useMemo(() => {
        if (Array.isArray(options) && options.length) {
            return options.map((o, idx) => ({
                key: o.key ?? String(o[valueKey] ?? idx),
                label: String(o[labelKey] ?? o.name ?? o[valueKey] ?? ''),
                value: o[valueKey] ?? o.id ?? o.value,
                group: groupBy ? o[groupBy] : null,
                original: o
            }));
        }
        const arr = [];
        React.Children.forEach(children, (ch) => {
            if (!ch || !ch.props) return;
            const props = ch.props || {};
            const val = props.value;
            const lab = typeof props.children === 'string'
                ? props.children
                : (Array.isArray(props.children) ? props.children.join('') : String(props.children || ''));
            const nodeKey = ch.key != null ? String(ch.key) : null;
            arr.push({ key: nodeKey ?? String(val ?? lab), label: lab, value: val, group: null, original: null });
        });
        return arr;
    }, [options, children, labelKey, valueKey, groupBy]);

    // Determine if search should be shown
    const showSearch = searchable && builtOptions.length >= showSearchThreshold;

    // Get recent items for this dropdown
    const effectiveCacheKey = cacheKey || (wrapperRef.current?.id) || 'default';
    const recentValues = getRecentItems(effectiveCacheKey);

    // Filter and sort options
    const visibleOptions = useMemo(() => {
        let filtered = builtOptions;

        // Apply search filter
        if (showSearch && query && query.length >= minSearchLength) {
            const q = query.trim();
            filtered = builtOptions
                .map(o => ({ ...o, score: fuzzyScore(o.label, q) }))
                .filter(o => o.score > 0)
                .sort((a, b) => b.score - a.score);
        } else {
            // Show recent items first when no query
            filtered = [...builtOptions].sort((a, b) => {
                const aRecent = recentValues.indexOf(a.value);
                const bRecent = recentValues.indexOf(b.value);
                if (aRecent !== -1 && bRecent !== -1) return aRecent - bRecent;
                if (aRecent !== -1) return -1;
                if (bRecent !== -1) return 1;
                return 0;
            });
        }

        return filtered;
    }, [builtOptions, query, showSearch, minSearchLength, recentValues]);

    // Group options if groupBy is set
    const groupedOptions = useMemo(() => {
        if (!groupBy) return null;
        const groups = new Map();
        visibleOptions.forEach(o => {
            const g = o.group || 'Other';
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(o);
        });
        return groups;
    }, [visibleOptions, groupBy]);

    // Find selected label
    const selectedLabel = useMemo(() => {
        const found = builtOptions.find(o => o.value === value || String(o.value) === String(value));
        return found ? found.label : '';
    }, [builtOptions, value]);

    // Calculate max content width for dropdown
    const maxLabelWidth = useMemo(() => {
        const maxLen = builtOptions.reduce((max, o) => Math.max(max, o.label.length), 0);
        // Approximate: 8px per character + padding
        return Math.min(400, Math.max(180, maxLen * 8 + 60));
    }, [builtOptions]);

    // Update dropdown position
    const updatePosition = useCallback(() => {
        if (!wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const dropdownHeight = Math.min(320, (visibleOptions.length + 1) * 40 + 20);

        let top = rect.bottom + window.scrollY + 4;
        let transform = 'none';

        if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
            // Flip to top: Position at top edge of trigger, then shift up by 100% height + 4px gap
            top = rect.top + window.scrollY - 4;
            transform = 'translateY(-100%)';
        }

        // Calculate width: min of trigger width, but can expand to fit content
        const contentWidth = maxLabelWidth;
        let left = rect.left + window.scrollX;
        let width = Math.max(rect.width, contentWidth);

        // Ensure dropdown doesn't go off-screen to the right
        if (left + width > viewportWidth - 16) {
            left = Math.max(16, viewportWidth - width - 16);
        }

        setDropdownPosition({
            top,
            left,
            width,
            minWidth: rect.width,
            transform
        });
    }, [visibleOptions.length, maxLabelWidth]);

    // Close on outside click
    useEffect(() => {
        function onDocClick(e) {
            if (wrapperRef.current?.contains(e.target)) return;
            if (e.target.closest('.searchable-select-portal')) return;
            setOpen(false);
            setQuery('');
            setHighlight(-1);
        }
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    // Update position on scroll/resize
    useEffect(() => {
        if (!open) return;
        updatePosition();
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [open, updatePosition]);


    // Keyboard navigation
    useEffect(() => {
        if (!open) return;
        function onKey(e) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setHighlight(h => Math.min(h + 1, visibleOptions.length - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setHighlight(h => Math.max(h - 1, 0));
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (highlight >= 0 && highlight < visibleOptions.length) {
                        selectValue(visibleOptions[highlight].value);
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    setOpen(false);
                    setQuery('');
                    setHighlight(-1);
                    wrapperRef.current?.focus();
                    break;
            }
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, highlight, visibleOptions]);

    // Scroll highlighted item into view
    useEffect(() => {
        if (!open || highlight < 0 || !listRef.current) return;
        const items = listRef.current.querySelectorAll('[data-option]');
        if (items[highlight]) {
            items[highlight].scrollIntoView({ block: 'nearest' });
        }
    }, [highlight, open]);

    // Focus input when dropdown opens
    useEffect(() => {
        if (open && showSearch && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    }, [open, showSearch]);

    // Select value handler
    function selectValue(val) {
        addRecentItem(effectiveCacheKey, val);
        if (typeof onChange === 'function') {
            onChange({ target: { value: val } });
        }
        setOpen(false);
        setQuery('');
        setHighlight(-1);
    }

    // Clear handler
    function handleClear(e) {
        e.stopPropagation();
        if (typeof onChange === 'function') {
            onChange({ target: { value: '' } });
        }
        setQuery('');
    }

    // Open handler
    function handleOpen() {
        if (disabled) return;
        if (!open) {
            setOpen(true);
            setHighlight(0);
            updatePosition();
        } else {
            setOpen(false);
            setQuery('');
            setHighlight(-1);
        }
    }

    // Handle focus - open dropdown on Tab focus
    function handleFocus() {
        if (disabled || open) return;
        setOpen(true);
        setHighlight(0);
        updatePosition();
    }

    // Fallback to native select when search disabled and few options
    if (!searchable && builtOptions.length < showSearchThreshold) {
        return (
            <div className={`relative ${className}`}>
                <select
                    className="w-full h-10 px-3 py-2 pr-8 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary appearance-none cursor-pointer bg-card text-foreground border-border"
                    value={value}
                    onChange={onChange}
                    disabled={disabled}
                    {...rest}
                >
                    {children}
                </select>
                <ChevronDown className="absolute right-3 top-3 h-4 w-4 opacity-50 pointer-events-none" />
            </div>
        );
    }

    // Render option item
    const renderOptionItem = (opt, idx) => {
        const isSelected = String(opt.value) === String(value);
        const isHighlighted = idx === highlight;
        const isRecent = recentValues.includes(opt.value) && !query;

        if (renderOption) {
            return renderOption(opt.original || opt, { isSelected, isHighlighted, matchedQuery: query });
        }

        return (
            <li
                key={opt.key}
                data-option
                role="option"
                aria-selected={isSelected}
                className={`
                    relative cursor-pointer px-3 py-2.5 text-sm transition-colors
                    ${isHighlighted ? 'bg-primary/15 text-primary' : 'hover:bg-muted'}
                    ${isSelected ? 'font-medium' : ''}
                `}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                    // Prevent input blur so click can fire
                    e.preventDefault();
                }}
                onClick={() => selectValue(opt.value)}
            >
                <div className="flex items-center justify-between gap-2">
                    <span className="truncate flex-1">
                        {query ? <HighlightMatch text={opt.label} query={query} /> : opt.label}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                        {isRecent && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                Recent
                            </span>
                        )}
                        {isSelected && <Check className="h-4 w-4 text-primary" />}
                    </div>
                </div>
            </li>
        );
    };

    // Dropdown content
    const dropdownContent = open && (
        <div
            className="searchable-select-portal absolute z-[9999] rounded-lg border shadow-xl overflow-hidden bg-card border-border"
            style={{
                top: dropdownPosition.top,
                left: dropdownPosition.left,
                width: dropdownPosition.width,
                minWidth: dropdownPosition.minWidth,
                transform: dropdownPosition.transform
            }}
        >
            {/* Options List */}
            <ul
                ref={listRef}
                role="listbox"
                className="max-h-64 overflow-auto py-1"
            >
                {loading ? (
                    <li className="flex items-center justify-center py-6 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        Loading...
                    </li>
                ) : visibleOptions.length === 0 ? (
                    <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                        {emptyMessage}
                    </li>
                ) : groupedOptions ? (
                    // Grouped rendering
                    Array.from(groupedOptions.entries()).map(([group, opts]) => (
                        <React.Fragment key={group}>
                            <li className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide bg-muted/50">
                                {group}
                            </li>
                            {opts.map((opt, i) => {
                                const globalIdx = visibleOptions.indexOf(opt);
                                return renderOptionItem(opt, globalIdx);
                            })}
                        </React.Fragment>
                    ))
                ) : (
                    // Flat rendering
                    visibleOptions.map((opt, idx) => renderOptionItem(opt, idx))
                )}
            </ul>
        </div>
    );

    return (
        <div className={`relative ${className}`} ref={wrapperRef}>
            {/* When open and searchable, show inline search input */}
            {open && showSearch ? (
                <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => { setQuery(e.target.value); setHighlight(0); }}
                        placeholder="Type to search..."
                        className="w-full h-10 pl-9 pr-8 py-2 text-sm rounded-lg border focus:outline-none ring-2 ring-primary border-primary bg-card text-foreground"
                        aria-label="Search options"
                        onBlur={(e) => {
                            // Don't close if clicking within the dropdown portal
                            if (e.relatedTarget?.closest('.searchable-select-portal')) return;
                            // Also don't close if clicking the trigger itself (which might happen during toggle)
                            if (wrapperRef.current?.contains(e.relatedTarget)) return;

                            setOpen(false);
                            setQuery('');
                            setHighlight(-1);
                        }}
                    />
                    <ChevronDown
                        className="absolute right-3 top-3 h-4 w-4 text-muted-foreground cursor-pointer rotate-180"
                        onClick={() => { setOpen(false); setQuery(''); }}
                    />
                </div>
            ) : (
                /* Trigger Button */
                <div
                    role="combobox"
                    aria-expanded={open}
                    aria-haspopup="listbox"
                    aria-controls="searchable-select-listbox"
                    tabIndex={disabled ? -1 : 0}
                    className={`
                        w-full h-10 px-3 py-2 rounded-lg border cursor-pointer
                        flex items-center justify-between gap-2
                        transition-colors
                        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/50'}
                        ${open ? 'ring-2 ring-primary border-primary' : ''}
                        bg-card text-foreground border-border
                    `}
                    onClick={handleOpen}
                    onFocus={handleFocus}
                    onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                            e.preventDefault();
                            handleOpen();
                        }
                    }}
                >
                    <span className={`flex-1 truncate text-sm ${selectedLabel ? '' : 'text-muted-foreground'}`}>
                        {selectedLabel || placeholder}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                        {clearable && value && !disabled && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="p-0.5 rounded hover:bg-muted transition-colors"
                                aria-label="Clear selection"
                            >
                                <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                        )}
                        {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
                        )}
                    </div>
                </div>
            )}

            {/* Portal Dropdown */}
            {typeof document !== 'undefined' && createPortal(dropdownContent, document.body)}
        </div>
    );
};

export default SearchableSelect;
