/**
 * Disk Space Utility
 * 
 * Provides disk usage information for monitoring storage.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Get disk usage statistics
 * @returns {Promise<{total: number, used: number, free: number, usedPercent: number}>}
 */
export async function getDiskUsage() {
    try {
        // Use df command to get disk usage (works on Linux and macOS)
        const { stdout } = await execAsync("df -k / | tail -1 | awk '{print $2, $3, $4}'");
        const parts = stdout.trim().split(/\s+/);

        if (parts.length >= 3) {
            const total = parseInt(parts[0], 10) * 1024; // Convert from KB to bytes
            const used = parseInt(parts[1], 10) * 1024;
            const free = parseInt(parts[2], 10) * 1024;
            const usedPercent = Math.round((used / total) * 100);

            return {
                total,
                used,
                free,
                usedPercent,
                totalFormatted: formatBytes(total),
                usedFormatted: formatBytes(used),
                freeFormatted: formatBytes(free),
                alert: usedPercent >= 80,
                critical: usedPercent >= 90,
            };
        }
    } catch (err) {
        console.error('[DiskSpace] Failed to get disk usage:', err.message);
    }

    // Fallback: return unknown
    return {
        total: 0,
        used: 0,
        free: 0,
        usedPercent: 0,
        totalFormatted: 'Unknown',
        usedFormatted: 'Unknown',
        freeFormatted: 'Unknown',
        alert: false,
        critical: false,
    };
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
