import React from 'react';
import { formatTimestampAMPM } from '../../utils/formatTimestamp';

/**
 * UserBadge - Displays a username with timestamp tooltip on hover
 * 
 * @param {Object} props
 * @param {Object} props.user - User object with { username, displayName }
 * @param {string | Date} props.timestamp - Created/updated timestamp
 * @param {string} props.className - Additional CSS classes
 */
export function UserBadge({ user, timestamp, className = '' }) {
    // Handle missing user data
    if (!user) {
        return (
            <span
                className={`text-muted-foreground ${className}`}
                title={timestamp ? formatTimestampAMPM(timestamp) : ''}
            >
                —
            </span>
        );
    }

    // Display name or username
    const displayText = user.displayName || user.username || '—';
    const tooltipText = timestamp ? formatTimestampAMPM(timestamp) : '';

    return (
        <span
            className={`cursor-default ${className}`}
            title={tooltipText}
        >
            {displayText}
        </span>
    );
}

/**
 * UserBadgeCell - Table cell wrapper for UserBadge
 * Commonly used format for table columns
 * 
 * @param {Object} props
 * @param {Object} props.user - User object with { username, displayName }
 * @param {string | Date} props.timestamp - Created/updated timestamp
 * @param {string} props.className - Additional CSS classes for the cell
 */
export function UserBadgeCell({ user, timestamp, className = '' }) {
    return (
        <td className={`py-2 px-2 text-sm ${className}`}>
            <UserBadge user={user} timestamp={timestamp} />
        </td>
    );
}

export default UserBadge;
