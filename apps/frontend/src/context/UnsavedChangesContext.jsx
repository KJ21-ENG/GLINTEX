import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';

/**
 * Registry of "this form has unsaved user input" flags.
 *
 * Data-entry forms register a named boolean via useUnsavedGuard; the dashboard
 * layout reads isAnyDirty() synchronously when the user tries to navigate away
 * or switch process, and shows a confirmation dialog instead of silently
 * discarding the form. The registry lives in a ref so flag updates never
 * re-render the app; readers always call isAnyDirty() at decision time.
 */

const UnsavedChangesContext = createContext(null);

export function UnsavedChangesProvider({ children }) {
    const registryRef = useRef(new Map());

    const value = useMemo(() => {
        const setDirty = (key, dirty) => { registryRef.current.set(key, Boolean(dirty)); };
        const clearDirty = (key) => { registryRef.current.delete(key); };
        const isAnyDirty = () => {
            for (const dirty of registryRef.current.values()) {
                if (dirty) return true;
            }
            return false;
        };
        return { setDirty, clearDirty, isAnyDirty };
    }, []);

    // Native prompt on tab close / refresh while any form holds unsaved input.
    useEffect(() => {
        const onBeforeUnload = (e) => {
            if (!value.isAnyDirty()) return;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [value]);

    return (
        <UnsavedChangesContext.Provider value={value}>
            {children}
        </UnsavedChangesContext.Provider>
    );
}

export function useUnsavedChanges() {
    const ctx = useContext(UnsavedChangesContext);
    if (!ctx) throw new Error('useUnsavedChanges must be used within UnsavedChangesProvider');
    return ctx;
}

/**
 * Register a form's dirty flag. Pass a plain boolean derived from form state;
 * it auto-clears when the component unmounts (e.g. after a successful save
 * resets the state, or the page is left via the confirmed dialog).
 */
export function useUnsavedGuard(key, isDirty) {
    const { setDirty, clearDirty } = useUnsavedChanges();

    useEffect(() => {
        setDirty(key, isDirty);
    }, [key, isDirty, setDirty]);

    useEffect(() => () => clearDirty(key), [key, clearDirty]);
}
