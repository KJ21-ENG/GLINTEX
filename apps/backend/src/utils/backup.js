/**
 * Database Backup Utility
 * 
 * Provides automated and manual backup functionality for PostgreSQL database.
 * - Automatic daily backups at configured time (default 3 AM IST)
 * - Retains last 3 days of backups
 * - Supports manual backup creation
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import prisma from '../lib/prisma.js';
import { uploadBackupToDrive } from './googleDrive.js';
import { sendNotification } from './notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Backup directory (relative to backend root)
const BACKUP_DIR = path.resolve(__dirname, '../../backups');

// Retention period in days
const RETENTION_DAYS = 3;

const DEFAULT_BACKUP_TIME = '03:00';
const BACKUP_TIMEZONE = 'Asia/Kolkata';
let backupTask = null;
let currentBackupTime = DEFAULT_BACKUP_TIME;

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

            pgDump.on('close', async (code) => {
                if (code === 0) {
                    const stats = fs.statSync(filepath);
                    console.log(`[Backup] Created ${type} backup: ${filename} (${formatBytes(stats.size)})`);

                    // Run cleanup after successful backup
                    cleanupOldBackups().catch(err => {
                        console.error('[Backup] Cleanup failed:', err.message);
                    });

                    let driveUpload = null;
                    try {
                        driveUpload = await uploadBackupToDrive({ filepath, filename });
                        if (driveUpload?.success) {
                            console.log(`[Backup] Uploaded to Google Drive: ${filename}`);
                        } else if (driveUpload?.skipped) {
                            console.log(`[Backup] Google Drive upload skipped (${driveUpload.reason})`);
                        } else if (driveUpload?.error) {
                            console.warn('[Backup] Google Drive upload failed:', driveUpload.error);
                        }
                    } catch (err) {
                        console.error('[Backup] Google Drive upload failed:', err.message);
                        driveUpload = { success: false, error: err.message };
                    }

                    resolve({
                        success: true,
                        filename,
                        path: filepath,
                        size: stats.size,
                        sizeFormatted: formatBytes(stats.size),
                        type,
                        createdAt: new Date().toISOString(),
                        driveUpload,
                    });
                } else {
                    // Clean up failed backup file if it exists
                    if (fs.existsSync(filepath)) {
                        fs.unlinkSync(filepath);
                    }
                    const error = new Error(`pg_dump exited with code ${code}: ${stderr}`);
                    error.filename = filename;
                    reject(error);
                }
            });

            pgDump.on('error', (err) => {
                const error = new Error(`Failed to execute pg_dump: ${err.message}`);
                error.filename = filename;
                reject(error);
            });
        });
    } catch (err) {
        console.error('[Backup] Error:', err.message);
        return { success: false, error: err.message, filename };
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

export function normalizeBackupTime(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildCronSchedule(time) {
    const [hour, minute] = time.split(':').map(Number);
    return `${minute} ${hour} * * *`;
}

async function loadBackupTimeFromDb() {
    try {
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });
        const normalized = normalizeBackupTime(settings?.backupTime);
        return normalized || DEFAULT_BACKUP_TIME;
    } catch (err) {
        console.warn('[Backup] Failed to load backup time from settings, using default:', err.message || err);
        return DEFAULT_BACKUP_TIME;
    }
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
 * Schedules daily backup at configured time (IST)
 */
export async function initBackupScheduler() {
    const backupTime = await loadBackupTimeFromDb();
    applyBackupSchedule(backupTime, { reason: 'initialized' });
}

export async function updateBackupScheduleTime(time) {
    const normalized = normalizeBackupTime(time);
    if (!normalized) {
        throw new Error('backupTime must be in HH:mm format (00:00-23:59)');
    }

    if (backupTask && currentBackupTime === normalized) {
        return { updated: false, time: normalized };
    }

    applyBackupSchedule(normalized, { reason: 'updated' });
    return { updated: true, time: normalized };
}

function applyBackupSchedule(backupTime, { reason }) {
    const cronSchedule = buildCronSchedule(backupTime);

    if (backupTask) {
        backupTask.stop();
    }

    backupTask = cron.schedule(cronSchedule, async () => {
        const scheduledAt = new Date();
        console.log('[Backup] Starting scheduled backup...');
        try {
            const result = await createBackup('auto');
            if (result.success) {
                console.log(`[Backup] Scheduled backup completed: ${result.filename}`);
            } else {
                console.error('[Backup] Scheduled backup failed:', result.error);
                await notifyBackupFailure({
                    type: 'auto',
                    error: result.error,
                    filename: result.filename,
                    time: scheduledAt,
                });
            }
        } catch (err) {
            console.error('[Backup] Scheduled backup error:', err.message);
            await notifyBackupFailure({
                type: 'auto',
                error: err.message,
                filename: err.filename,
                time: scheduledAt,
            });
        }
    }, {
        scheduled: true,
        timezone: BACKUP_TIMEZONE,
    });

    currentBackupTime = backupTime;
    console.log(`[Backup] Scheduler ${reason} - Daily backups at ${backupTime} IST`);
}

async function notifyBackupFailure({ type, error, filename, time }) {
    const payload = {
        type,
        error: String(error || 'unknown'),
        filename: filename || 'n/a',
        time: (time instanceof Date ? time : new Date()).toISOString(),
        host: os.hostname(),
    };
    const fallbackTemplate = 'Backup failed on {{host}} at {{time}} (type: {{type}}). Error: {{error}}. Filename: {{filename}}';
    await sendNotification('backup_failed', payload, { fallbackTemplate });
}
