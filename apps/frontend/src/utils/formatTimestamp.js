/**
 * Format a date to DD/MM/YY HH:mm AM/PM format
 * @param {Date | string | number} date - Date to format
 * @returns {string} Formatted date string or empty string if invalid
 */
export function formatTimestampAMPM(date) {
    if (!date) return '';

    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);

    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';

    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    const hoursStr = String(hours).padStart(2, '0');

    return `${day}/${month}/${year} ${hoursStr}:${minutes} ${ampm}`;
}

/**
 * Format a date to DD/MM/YYYY format
 * @param {Date | string | number} date - Date to format
 * @returns {string} Formatted date string or empty string if invalid
 */
export function formatDateDDMMYY(date) {
    if (!date) return '';

    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);

    return `${day}/${month}/${year}`;
}
