import React, { useState } from 'react';
import { Scale, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../ui';
import * as api from '../../api/client';
import { getScaleManager, isWebSerialSupported } from '../../utils/weightScale';
import { WeightCaptureDialog } from './WeightCaptureDialog';

/**
 * Small icon button to capture weight from connected scale
 * 
 * @param {function} onWeightCaptured - Callback with weight in kg (number)
 * @param {boolean} disabled - Optional disable state
 * @param {string} className - Additional CSS classes
 */
export function CatchWeightButton({ onWeightCaptured, disabled = false, className = '', context = null }) {
    const [status, setStatus] = useState('idle'); // idle | loading | error
    const [errorMessage, setErrorMessage] = useState('');
    const [dialogOpen, setDialogOpen] = useState(false);

    const isSupported = isWebSerialSupported();
    const effectiveContext = {
        page: typeof window !== 'undefined' ? window.location.pathname : null,
        ...(context && typeof context === 'object' ? context : {}),
    };

    async function handleClick() {
        if (disabled || status === 'loading') return;

        if (!isSupported) {
            setDialogOpen(true);
            return;
        }

        setStatus('loading');
        setErrorMessage('');

        try {
            // Fast path: if already authorized + connected, try a quick stable capture.
            const manager = getScaleManager();
            const result = await manager.captureStableWeight({ timeoutMs: 2500, allowUserPrompt: false });
            const meta = {
                source: 'scale',
                weightKg: result.weightKg,
                portInfo: result.portInfo || null,
                baudRate: result.baudRate || null,
                parser: result.meta?.parser || null,
                raw: result.meta?.raw || null,
                stableFlag: Boolean(result.meta?.stable),
            };
            try {
                await api.logWeightCapture({ ...meta, context: effectiveContext });
            } catch (e) {
                // Don't block the operator on audit log failures for scale captures.
                console.warn('Failed to log weight capture', e);
            }

            setStatus('idle');
            onWeightCaptured?.(result.weightKg, meta);
        } catch (err) {
            setStatus('error');
            setErrorMessage(err.message);
            setDialogOpen(true);
        }
    }

    const getIcon = () => {
        switch (status) {
            case 'loading':
                return <Loader2 className="h-4 w-4 animate-spin" />;
            case 'error':
                return <AlertCircle className="h-4 w-4 text-destructive" />;
            default:
                return <Scale className="h-4 w-4" />;
        }
    };

    const getTitle = () => {
        if (!isSupported) return 'Weight scale not supported in this browser';
        if (status === 'loading') return 'Reading weight...';
        if (status === 'error') return errorMessage;
        return 'Capture weight from scale';
    };

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="icon"
                className={`flex-shrink-0 ${className}`}
                onClick={handleClick}
                disabled={disabled || status === 'loading'}
                title={getTitle()}
            >
                {getIcon()}
            </Button>

            <WeightCaptureDialog
                open={dialogOpen}
                onOpenChange={(open) => {
                    setDialogOpen(open);
                    if (!open) setStatus('idle');
                }}
                onWeightCaptured={(weightKg, meta) => {
                    onWeightCaptured?.(weightKg, meta);
                    setStatus('idle');
                }}
                context={effectiveContext}
            />
        </>
    );
}
