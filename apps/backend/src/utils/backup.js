/**
 * Database Backup Utility
 * 
 * Provides automated and manual backup functionality for PostgreSQL database.
 * - Automatic daily backups at 3 AM IST
 * - Retains last 3 days of backups
 * - Supports manual backup creation
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Backup directory (relative to backend root)
const BACKUP_DIR = path.resolve(__dirname, '../../backups');

// Retention period in days
const RETENTION_DAYS = 3;

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Parse DATABASE_URL to extract connection components
 * Format: postgresql://user:password@host:port/database
 */
function parseDatabaseUrl() {
    const url = process.env.DATABASE_URL;
    if (!url) {
        throw new Error('DATABASE_URL environment variable is not set');
    }

    const match = url.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    if (!match) {
        throw new Error('Invalid DATABASE_URL format');
    }

    return {
        user: match[1],
        password: match[2],
        host: match[3],
        port: match[4],
        database: match[5],
    };
}

/**
 * Generate backup filename with timestamp
 * @param {'auto' | 'manual'} type - Type of backup
 */
function generateBackupFilename(type = 'auto') {
    const now = new Date();
    const timestamp = now.toISOString()
        .replace(/[-:]/g, '')
        .replace('T', '_')
        .slice(0, 15);
    return `${timestamp}_${type}.dump`;
}

/**
 * Create a database backup using pg_dump
 * @param {'auto' | 'manual'} type - Type of backup
 * @returns {Promise<{success: boolean, filename?: string, path?: string, size?: number, error?: string}>}
 */
export async function createBackup(type = 'auto') {
    const filename = generateBackupFilename(type);
    const filepath = path.join(BACKUP_DIR, filename);

    try {
        const db = parseDatabaseUrl();

        return new Promise((resolve, reject) => {
            // Use pg_dump with custom format for compression
            const pgDump = spawn('pg_dump', [
                '-h', db.host,
                '-p', db.port,
                '-U', db.user,
                '-d', db.database,
                '-F', 'c',  // Custom format (compressed)
                '-f', filepath,
            ], {
                env: {
                    ...process.env,
                    PGPASSWORD: db.password,
                },
            });

            let stderr = '';

            pgDump.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pgDump.on('close', (code) => {
                if (code === 0) {
                    const stats = fs.statSync(filepath);
                    console.log(`[Backup] Created ${type} backup: ${filename} (${formatBytes(stats.size)})`);

                    // Run cleanup after successful backup
                    cleanupOldBackups().catch(err => {
                        console.error('[Backup] Cleanup failed:', err.message);
                    });

                    resolve({
                        success: true,
                        filename,
                        path: filepath,
                        size: stats.size,
                        sizeFormatted: formatBytes(stats.size),
                        type,
                        createdAt: new Date().toISOString(),
                    });
                } else {
                    // Clean up failed backup file if it exists
                    if (fs.existsSync(filepath)) {
                        fs.unlinkSync(filepath);
                    }
                    reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
                }
            });

            pgDump.on('error', (err) => {
                reject(new Error(`Failed to execute pg_dump: ${err.message}`));
            });
        });
    } catch (err) {
        console.error('[Backup] Error:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Delete backups older than retention period
 */
export async function cleanupOldBackups() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    const files = fs.readdirSync(BACKUP_DIR);
    let deletedCount = 0;

    for (const file of files) {
        // Only process .dump files
        if (!file.endsWith('.dump')) continue;

        const filepath = path.join(BACKUP_DIR, file);
        const stats = fs.statSync(filepath);

        if (stats.mtime < cutoffDate) {
            fs.unlinkSync(filepath);
            console.log(`[Backup] Deleted old backup: ${file}`);
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        console.log(`[Backup] Cleaned up ${deletedCount} old backup(s)`);
    }

    return { deletedCount };
}

/**
 * List all available backups
 * @returns {Array<{filename: string, size: number, sizeFormatted: string, createdAt: string, type: string}>}
 */
export function listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) {
        return [];
    }

    const files = fs.readdirSync(BACKUP_DIR);
    const backups = [];

    for (const file of files) {
        if (!file.endsWith('.dump')) continue;

        const filepath = path.join(BACKUP_DIR, file);
        const stats = fs.statSync(filepath);

        // Extract type from filename (e.g., "20251221_030000_auto.dump" -> "auto")
        const typeMatch = file.match(/_(\w+)\.dump$/);
        const type = typeMatch ? typeMatch[1] : 'unknown';

        backups.push({
            filename: file,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            createdAt: stats.mtime.toISOString(),
            type,
        });
    }

    // Sort by creation date, newest first
    backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return backups;
}

/**
 * Get full path for a backup file
 * @param {string} filename - Backup filename
 * @returns {string | null} - Full path or null if not found
 */
export function getBackupPath(filename) {
    // Sanitize filename to prevent path traversal
    const sanitized = path.basename(filename);
    const filepath = path.join(BACKUP_DIR, sanitized);

    if (fs.existsSync(filepath) && sanitized.endsWith('.dump')) {
        return filepath;
    }

    return null;
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Initialize the backup scheduler
 * Schedules daily backup at 3:00 AM IST (21:30 UTC previous day)
 */
export function initBackupScheduler() {
    // 3:00 AM IST = 21:30 UTC (IST is UTC+5:30)
    // Cron format: minute hour day month day-of-week
    const cronSchedule = '0 3 * * *';

    cron.schedule(cronSchedule, async () => {
        console.log('[Backup] Starting scheduled backup...');
        try {
            const result = await createBackup('auto');
            if (result.success) {
                console.log(`[Backup] Scheduled backup completed: ${result.filename}`);
            } else {
                console.error('[Backup] Scheduled backup failed:', result.error);
            }
        } catch (err) {
            console.error('[Backup] Scheduled backup error:', err.message);
        }
    }, {
        scheduled: true,
        timezone: 'Asia/Kolkata',
    });

    console.log('[Backup] Scheduler initialized - Daily backups at 3:00 AM IST');
}
