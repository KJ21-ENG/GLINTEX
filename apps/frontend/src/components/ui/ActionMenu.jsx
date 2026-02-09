import React, { useState, useRef, useEffect } from 'react';
import { MoreVertical } from 'lucide-react';
import { Button } from './Button';
import { DisabledWithTooltip } from '../common/DisabledWithTooltip';

/**
 * ActionMenu - A kebab (⋮) dropdown menu for row actions
 * 
 * @param {Object} props
 * @param {Array} props.actions - Array of action objects: { label, icon, onClick, variant, disabled, disabledReason }
 *   - label: Display text
 *   - icon: Optional React node (icon component)
 *   - onClick: Click handler
 *   - variant: 'default' | 'destructive' - styling variant
 *   - disabled: boolean - disable the action
 */
export function ActionMenu({ actions = [] }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);

    // Close menu when clicking outside
    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    // Close on escape
    useEffect(() => {
        if (!open) return;
        const handleEscape = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [open]);

    const handleAction = (action) => {
        setOpen(false);
        if (action.onClick) action.onClick();
    };

    return (
        <div className="relative" ref={menuRef}>
            <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setOpen(!open)}
            >
                <MoreVertical className="w-4 h-4" />
            </Button>

            {open && (
                <div className="absolute right-0 z-50 mt-1 min-w-[140px] rounded-md border bg-popover shadow-md animate-in fade-in-0 zoom-in-95">
                    <div className="py-1">
                        {actions.map((action, idx) => (
                            <DisabledWithTooltip
                                key={idx}
                                disabled={!!action.disabled}
                                tooltip={action.disabledReason || 'Action not available.'}
                                className="w-full"
                            >
                                <button
                                    onClick={() => handleAction(action)}
                                    className={`
                                        w-full flex items-center gap-2 px-3 py-2 text-sm text-left
                                        hover:bg-muted transition-colors
                                        disabled:opacity-50 disabled:cursor-not-allowed
                                        ${action.variant === 'destructive' ? 'text-destructive hover:bg-destructive/10' : ''}
                                    `}
                                >
                                    {action.icon && <span className="w-4 h-4">{action.icon}</span>}
                                    {action.label}
                                </button>
                            </DisabledWithTooltip>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
