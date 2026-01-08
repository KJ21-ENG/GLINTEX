import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, RefreshCw } from 'lucide-react';
import { Button } from '../ui';
import { cn } from '../../lib/utils';

/**
 * BarcodeScanner component using html5-qrcode library
 * Provides camera-based barcode scanning for mobile devices
 */
export function BarcodeScanner({ onScan, className, disabled = false }) {
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState(null);
    const [lastScanned, setLastScanned] = useState(null);
    const lastScannedRef = useRef(null); // Ref for debounce check (avoids stale closure)
    const onScanRef = useRef(onScan);
    const scannerRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => {
        onScanRef.current = onScan;
    }, [onScan]);

    const startScanner = async () => {
        if (!containerRef.current || disabled) return;

        try {
            setError(null);

            // Create scanner instance
            const scanner = new Html5Qrcode('barcode-scanner-container');
            scannerRef.current = scanner;

            // Get available cameras
            const devices = await Html5Qrcode.getCameras();
            if (!devices || devices.length === 0) {
                throw new Error('No camera found on this device');
            }

            // Prefer back camera on mobile
            const backCamera = devices.find(d =>
                d.label.toLowerCase().includes('back') ||
                d.label.toLowerCase().includes('rear') ||
                d.label.toLowerCase().includes('environment')
            );
            const cameraId = backCamera ? backCamera.id : devices[0].id;

            // Start scanning
            await scanner.start(
                cameraId,
                {
                    fps: 10,
                    qrbox: { width: 250, height: 150 },
                    aspectRatio: 1.0,
                },
                (decodedText) => {
                    // Debounce: don't scan same barcode within 2 seconds
                    // Use ref to avoid stale closure issue
                    if (lastScannedRef.current === decodedText) return;

                    lastScannedRef.current = decodedText;
                    setLastScanned(decodedText); // Also update state for UI display
                    onScanRef.current?.(decodedText);

                    // Reset after 2 seconds to allow re-scanning
                    setTimeout(() => {
                        lastScannedRef.current = null;
                        setLastScanned(null);
                    }, 2000);
                },
                (errorMessage) => {
                    // QR code parse error - ignore these as they happen continuously
                }
            );

            setIsScanning(true);
        } catch (err) {
            console.error('Failed to start scanner:', err);
            setError(err.message || 'Failed to access camera');
            setIsScanning(false);
        }
    };

    const stopScanner = async () => {
        if (scannerRef.current) {
            try {
                await scannerRef.current.stop();
                await scannerRef.current.clear();
            } catch (err) {
                console.error('Error stopping scanner:', err);
            }
            scannerRef.current = null;
        }
        setIsScanning(false);
    };

    // Auto-start scanner on mount
    useEffect(() => {
        if (!disabled) {
            startScanner();
        }

        return () => {
            stopScanner();
        };
    }, [disabled]);

    const handleRetry = () => {
        stopScanner().then(() => startScanner());
    };

    return (
        <div className={cn("relative w-full h-full bg-black rounded-lg overflow-hidden", className)}>
            {/* Scanner container */}
            <div
                id="barcode-scanner-container"
                ref={containerRef}
                className="w-full h-full"
            />

            {/* Scanning overlay with frame */}
            {isScanning && (
                <div className="absolute inset-0 pointer-events-none">
                    {/* Scanning frame */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-40 border-2 border-primary rounded-lg">
                        {/* Corner accents */}
                        <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                        <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                        <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-lg" />

                        {/* Scanning line animation */}
                        <div className="absolute top-0 left-2 right-2 h-0.5 bg-primary/80 animate-pulse"
                            style={{ animation: 'scanLine 2s ease-in-out infinite' }} />
                    </div>

                    {/* Instructions */}
                    <div className="absolute bottom-4 left-0 right-0 text-center">
                        <p className="text-white/90 text-sm bg-black/50 inline-block px-4 py-2 rounded-full">
                            Point camera at barcode
                        </p>
                    </div>
                </div>
            )}

            {/* Error state */}
            {error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-white p-4">
                    <CameraOff className="w-12 h-12 mb-4 text-destructive" />
                    <p className="text-center mb-4">{error}</p>
                    <Button onClick={handleRetry} variant="outline" className="text-white border-white">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Retry
                    </Button>
                </div>
            )}

            {/* Not scanning state */}
            {!isScanning && !error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted">
                    <Camera className="w-12 h-12 mb-4 text-muted-foreground" />
                    <Button onClick={startScanner}>
                        <Camera className="w-4 h-4 mr-2" />
                        Start Scanner
                    </Button>
                </div>
            )}

            {/* Last scanned indicator */}
            {lastScanned && (
                <div className="absolute top-4 left-0 right-0 text-center">
                    <span className="bg-green-500 text-white px-4 py-2 rounded-full text-sm font-medium animate-pulse">
                        ✓ Scanned: {lastScanned}
                    </span>
                </div>
            )}

            {/* Inline styles for scan animation */}
            <style>{`
                @keyframes scanLine {
                    0%, 100% { transform: translateY(0); opacity: 1; }
                    50% { transform: translateY(140px); opacity: 0.5; }
                }
            `}</style>
        </div>
    );
}

export default BarcodeScanner;
