import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, CameraOff, RefreshCw } from 'lucide-react';
import { Button } from '../ui';
import { cn } from '../../lib/utils';

/**
 * BarcodeScanner component using html5-qrcode library
 * Provides camera-based barcode scanning for mobile devices
 * 
 * Features:
 * - Restricted to Code 128/Code 39 formats (GLINTEX barcodes)
 * - Pattern validation for known barcode formats
 * - Multi-read confirmation for accuracy
 * - Haptic feedback on successful scan
 * - Native BarcodeDetector API when available
 */

// ============ FIX #1: Restrict to GLINTEX barcode formats ============
const SUPPORTED_FORMATS = [
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
];

// ============ FIX #2: Known GLINTEX barcode patterns ============
const VALID_BARCODE_PATTERNS = [
    // NOTE: Lot numbers can be numeric (e.g. 001), opening-stock (OP-1064), or cutter-purchase (CP-001).
    // Keep patterns strict to GLINTEX formats while allowing these lot prefixes.
    /^INB-(?:\d{3,6}|OP-\d{1,6}|CP-\d{1,6})-\d{3}$/,          // Inbound
    /^ICU-(?:\d{3,6}|OP-\d{1,6}|CP-\d{1,6})-\d{3}$/,          // Cutter Issue
    /^RCU-(?:\d{3,6}|OP-\d{1,6}|CP-\d{1,6})-\d{3}-C\d{3}$/,   // Cutter Receive
    /^IHO-\d{1,4}$/,                   // Holo Issue (1-4 digits)
    /^RHO-\d{1,4}-C\d{3}$/,            // Holo Receive
    /^RHO-OP-\d{1,4}-C\d{3}$/,         // Legacy Holo Opening Stock
    /^ICO-\d{1,4}$/,                   // Coning Issue
    /^RCO-\d{1,4}-C\d{3}$/,            // Coning Receive
    /^RCO-OP-\d{1,4}-C\d{3}$/,         // Legacy Coning Opening Stock
];

function isValidBarcodeFormat(barcode) {
    if (!barcode) return false;
    return VALID_BARCODE_PATTERNS.some(pattern => pattern.test(barcode));
}

// ============ FIX #8: Haptic feedback ============
function triggerScanFeedback() {
    if (navigator.vibrate) {
        navigator.vibrate(100);
    }
}

export function BarcodeScanner({ onScan, onInvalidScan, className, disabled = false }) {
    const [isScanning, setIsScanning] = useState(false);
    const [error, setError] = useState(null);
    const [lastScanned, setLastScanned] = useState(null);
    const [invalidBarcode, setInvalidBarcode] = useState(null); // P2 Fix: Visual feedback for rejected barcodes
    const lastScannedRef = useRef(null); // Ref for debounce check (avoids stale closure)
    const onScanRef = useRef(onScan);
    const onInvalidScanRef = useRef(onInvalidScan);
    const scannerRef = useRef(null);
    const containerRef = useRef(null);

    // ============ FIX #3: Multi-read confirmation ============
    const confirmationRef = useRef({ barcode: null, count: 0 });

    useEffect(() => {
        onScanRef.current = onScan;
        onInvalidScanRef.current = onInvalidScan;
    }, [onScan, onInvalidScan]);

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

            // Start scanning with enhanced configuration
            await scanner.start(
                cameraId,
                {
                    // ============ FIX #4: Lower FPS for better accuracy ============
                    fps: 5,
                    // ============ FIX #5: Responsive QRBox sizing ============
                    qrbox: (viewfinderWidth, viewfinderHeight) => {
                        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                        return {
                            width: Math.floor(minEdge * 0.8),
                            height: Math.floor(minEdge * 0.5),
                        };
                    },
                    aspectRatio: 1.0,
                    // ============ FIX #1: Format restriction ============
                    formatsToSupport: SUPPORTED_FORMATS,
                    // ============ FIX #6: Native BarcodeDetector API ============
                    experimentalFeatures: {
                        useBarCodeDetectorIfSupported: true,
                    },
                },
                (decodedText) => {
                    const normalized = decodedText.trim().toUpperCase();

                    // ============ FIX #2: Pattern validation ============
                    if (!isValidBarcodeFormat(normalized)) {
                        console.warn('Invalid barcode format rejected:', normalized);
                        confirmationRef.current = { barcode: null, count: 0 };

                        // P2 Fix: Show visual feedback for rejected barcode
                        setInvalidBarcode(normalized);
                        setTimeout(() => setInvalidBarcode(null), 1500);

                        onInvalidScanRef.current?.(normalized);
                        return;
                    }

                    // ============ FIX #3: Multi-read confirmation ============
                    // Require same barcode to be decoded 2 consecutive times
                    if (confirmationRef.current.barcode === normalized) {
                        confirmationRef.current.count++;
                    } else {
                        confirmationRef.current = { barcode: normalized, count: 1 };
                    }

                    if (confirmationRef.current.count < 2) {
                        return; // Wait for confirmation read
                    }

                    // Reset confirmation after successful double-read
                    confirmationRef.current = { barcode: null, count: 0 };

                    // Debounce: don't scan same barcode within 2 seconds
                    if (lastScannedRef.current === normalized) return;

                    lastScannedRef.current = normalized;
                    setLastScanned(normalized);

                    // ============ FIX #8: Haptic feedback ============
                    triggerScanFeedback();

                    onScanRef.current?.(normalized);

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
        } else {
            stopScanner();
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

            {/* P2 Fix: Invalid barcode indicator */}
            {invalidBarcode && (
                <div className="absolute top-4 left-0 right-0 text-center">
                    <span className="bg-red-500 text-white px-4 py-2 rounded-full text-sm font-medium">
                        ✕ Invalid format
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
