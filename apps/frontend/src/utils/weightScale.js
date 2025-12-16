/**
 * Weight Scale Utility - Web Serial API integration
 * 
 * Communicates with weight scales via serial port.
 * Based on protocol: 2400 baud, data format [XXXXX] = weight/100 kg
 */

// Storage key for remembering the port
const SCALE_PORT_KEY = 'weightScalePort';

/**
 * Check if Web Serial API is supported
 */
export function isWebSerialSupported() {
    return 'serial' in navigator;
}

/**
 * Request user to select a serial port (first-time setup)
 * Must be called from a user gesture (click handler)
 */
export async function requestScalePort() {
    if (!isWebSerialSupported()) {
        throw new Error('Web Serial API not supported in this browser');
    }

    try {
        const port = await navigator.serial.requestPort();
        return port;
    } catch (err) {
        if (err.name === 'NotFoundError') {
            throw new Error('No port selected');
        }
        throw err;
    }
}

/**
 * Get a previously authorized port automatically
 * Returns the first available port or null if none
 */
export async function getActiveScalePort() {
    if (!isWebSerialSupported()) {
        return null;
    }

    const ports = await navigator.serial.getPorts();
    return ports.length > 0 ? ports[0] : null;
}

/**
 * Open connection to the scale
 * Serial config based on reference: 2400 baud, 8N1
 */
export async function openScale(port) {
    if (!port.readable) {
        await port.open({
            baudRate: 2400,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            flowControl: 'none'
        });
    }
    return port;
}

/**
 * Close the scale connection
 */
export async function closeScale(port) {
    if (port?.readable) {
        try {
            await port.close();
        } catch (e) {
            console.warn('Error closing port:', e);
        }
    }
}

/**
 * Parse weight data from buffer
 * Format: [XXXXX] where XXXXX is a 5-digit integer
 * Weight = value / 100 (kg)
 */
function parseWeightFromBuffer(buffer) {
    // Look for pattern [XXXXX]
    const pattern = /\[(\d{5})\]/g;
    let match;
    let lastWeight = null;

    while ((match = pattern.exec(buffer)) !== null) {
        const rawValue = parseInt(match[1], 10);
        if (!isNaN(rawValue)) {
            lastWeight = rawValue / 100;
        }
    }

    return lastWeight;
}

/**
 * Read weight from the scale with timeout
 * Returns weight in kg or null if no valid reading
 */
export async function readWeight(port, timeoutMs = 2000) {
    if (!port.readable) {
        throw new Error('Port not open');
    }

    let buffer = '';
    const reader = port.readable.getReader();
    const decoder = new TextDecoder();

    try {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const { value, done } = await Promise.race([
                reader.read(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Read timeout')), timeoutMs)
                )
            ]);

            if (done) break;

            if (value) {
                buffer += decoder.decode(value, { stream: true });

                // Try to parse weight from accumulated buffer
                const weight = parseWeightFromBuffer(buffer);
                if (weight !== null) {
                    return weight;
                }

                // Keep buffer manageable (last 100 chars)
                if (buffer.length > 100) {
                    buffer = buffer.slice(-50);
                }
            }
        }

        // Final attempt to parse
        const weight = parseWeightFromBuffer(buffer);
        if (weight !== null) {
            return weight;
        }

        throw new Error('No valid weight reading received');
    } finally {
        reader.releaseLock();
    }
}

/**
 * Main function: Catch weight from scale
 * Auto-detects port, reads weight, returns value in kg
 * 
 * @param {boolean} forcePrompt - If true, always prompt user to select port
 * @returns {Promise<number>} Weight in kg (3 decimal places)
 */
export async function catchWeight(forcePrompt = false) {
    if (!isWebSerialSupported()) {
        throw new Error('Weight scale not supported in this browser. Please use Chrome or Edge.');
    }

    let port = null;
    let shouldClose = false;

    try {
        // Try to get existing authorized port
        if (!forcePrompt) {
            port = await getActiveScalePort();
        }

        // If no port, request one from user
        if (!port) {
            port = await requestScalePort();
        }

        // Open the port if not already open
        if (!port.readable) {
            await openScale(port);
            shouldClose = true;
        }

        // Read weight
        const weight = await readWeight(port);

        // Round to 3 decimal places
        return Math.round(weight * 1000) / 1000;

    } catch (err) {
        // Re-throw with user-friendly message
        if (err.message.includes('not supported')) {
            throw err;
        }
        if (err.message === 'No port selected') {
            throw new Error('Please select the weight scale');
        }
        if (err.message.includes('timeout') || err.message.includes('No valid weight')) {
            throw new Error('Could not read weight. Ensure scale is connected and has a stable reading.');
        }
        throw new Error(`Scale error: ${err.message}`);
    } finally {
        // Optionally close the port (keep open for repeated reads)
        // if (shouldClose && port) {
        //   await closeScale(port);
        // }
    }
}
