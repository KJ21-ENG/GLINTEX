import prisma from '../lib/prisma.js';

/**
 * User Resolver Utility
 * Resolves createdByUserId and updatedByUserId to user objects with basic info.
 * Uses TTL-based caching to balance performance with data freshness.
 */

// Cache user lookups to avoid repeated DB queries
// TTL-based to prevent stale data and unbounded memory growth
const userCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cacheTimestamp = Date.now();

/**
 * Check and clear cache if TTL has expired
 */
function checkCacheTTL() {
    if (Date.now() - cacheTimestamp > CACHE_TTL_MS) {
        userCache.clear();
        cacheTimestamp = Date.now();
    }
}

/**
 * Fetch user by ID with caching
 * @param {string} userId - User ID
 * @returns {Promise<{id: string, username: string, displayName: string | null} | null>}
 */
async function fetchUser(userId) {
    if (!userId) return null;

    // Check and clear cache if TTL expired
    checkCacheTTL();

    if (userCache.has(userId)) {
        return userCache.get(userId);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            username: true,
            displayName: true,
        },
    });

    const result = user ? {
        id: user.id,
        username: user.username,
        displayName: user.displayName || null,
    } : null;

    userCache.set(userId, result);
    return result;
}

/**
 * Batch fetch users by IDs
 * @param {string[]} userIds - Array of user IDs
 * @returns {Promise<Map<string, {id, username, displayName}>>}
 */
async function batchFetchUsers(userIds) {
    // Check and clear cache if TTL expired
    checkCacheTTL();

    const uniqueIds = Array.from(new Set((userIds || []).filter(Boolean)));
    const missing = uniqueIds.filter(id => !userCache.has(id));

    if (missing.length > 0) {
        const users = await prisma.user.findMany({
            where: { id: { in: missing } },
            select: {
                id: true,
                username: true,
                displayName: true,
            },
        });

        // Cache found users
        users.forEach(user => {
            userCache.set(user.id, {
                id: user.id,
                username: user.username,
                displayName: user.displayName || null,
            });
        });

        // Cache null for missing users
        missing.forEach(id => {
            if (!userCache.has(id)) {
                userCache.set(id, null);
            }
        });
    }

    const result = new Map();
    uniqueIds.forEach(id => {
        result.set(id, userCache.get(id) || null);
    });
    return result;
}

/**
 * Resolve user fields on a single record
 * Adds createdByUser and updatedByUser objects to the record
 * @param {Object} record - Record with createdByUserId and/or updatedByUserId
 * @returns {Promise<Object>} - Record with resolved user objects
 */
export async function resolveRecordUserFields(record) {
    if (!record) return record;

    const result = { ...record };

    if (record.createdByUserId) {
        result.createdByUser = await fetchUser(record.createdByUserId);
    } else {
        result.createdByUser = null;
    }

    if (record.updatedByUserId) {
        result.updatedByUser = await fetchUser(record.updatedByUserId);
    } else {
        result.updatedByUser = null;
    }

    return result;
}

/**
 * Resolve user fields on multiple records (batch operation)
 * Efficiently fetches all users in one query, then applies them
 * @param {Object[]} records - Array of records with createdByUserId and/or updatedByUserId
 * @returns {Promise<Object[]>} - Records with resolved user objects
 */
export async function resolveUserFields(records) {
    if (!records || !Array.isArray(records) || records.length === 0) {
        return records;
    }

    // Collect all user IDs
    const userIds = [];
    records.forEach(record => {
        if (record.createdByUserId) userIds.push(record.createdByUserId);
        if (record.updatedByUserId) userIds.push(record.updatedByUserId);
    });

    // Batch fetch all users
    const userMap = await batchFetchUsers(userIds);

    // Apply user objects to records
    return records.map(record => ({
        ...record,
        createdByUser: record.createdByUserId ? (userMap.get(record.createdByUserId) || null) : null,
        updatedByUser: record.updatedByUserId ? (userMap.get(record.updatedByUserId) || null) : null,
    }));
}

/**
 * Clear the user cache
 * Call this at the start of a new request if using shared cache
 */
export function clearUserCache() {
    userCache.clear();
}

/**
 * Helper to format user for API response
 * @param {Object} user - User object from cache/DB
 * @returns {Object | null}
 */
export function formatUserForResponse(user) {
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName || null,
    };
}

export default {
    resolveUserFields,
    resolveRecordUserFields,
    clearUserCache,
    formatUserForResponse,
};
