import React, { useState } from 'react';
import { Scale, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../ui';
import { catchWeight, isWebSerialSupported } from '../../utils/weightScale';

/**
 * Small icon button to capture weight from connected scale
 * 
 * @param {function} onWeightCaptured - Callback with weight in kg (number)
 * @param {boolean} disabled - Optional disable state
 * @param {string} className - Additional CSS classes
 */
export function CatchWeightButton({ onWeightCaptured, disabled = false, className = '' }) {
    const [status, setStatus] = useState('idle'); // idle | loading | error
    const [errorMessage, setErrorMessage] = useState('');

    const isSupported = isWebSerialSupported();

    async function handleClick() {
        if (disabled || status === 'loading') return;

        if (!isSupported) {
            // Fallback: prompt for manual entry
            const manualWeight = window.prompt('Weight scale not supported. Enter weight manually (kg):');
            if (manualWeight) {
                const parsed = parseFloat(manualWeight);
                if (!isNaN(parsed) && parsed > 0) {
                    onWeightCaptured(parsed);
                } else {
                    alert('Invalid weight entered');
                }
            }
            return;
        }

        setStatus('loading');
        setErrorMessage('');

        try {
            const weight = await catchWeight();
            setStatus('idle');
            onWeightCaptured(weight);
        } catch (err) {
            setStatus('error');
            setErrorMessage(err.message);

            // Offer manual entry on error
            const manualWeight = window.prompt(`${err.message}\n\nEnter weight manually (kg):`);
            if (manualWeight) {
                const parsed = parseFloat(manualWeight);
                if (!isNaN(parsed) && parsed > 0) {
                    onWeightCaptured(parsed);
                }
            }

            // Reset to idle after showing error briefly
            setTimeout(() => setStatus('idle'), 2000);
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
    );
}
