/**
 * Fuzzy scoring algorithm for smart search.
 * Scores matches based on precision:
 * - 100: Exact match
 * - 80: Starts with query
 * - 60: Contains query as a whole word
 * - 40: Contains query anywhere
 * - 20: Fuzzy match (characters appear in order)
 * - 0: No match
 */
export function fuzzyScore(text, query) {
    if (!query) return 1;
    const textLower = String(text || '').toLowerCase();
    const queryLower = String(query || '').toLowerCase();

    // Exact match
    if (textLower === queryLower) return 100;

    // Starts with query
    if (textLower.startsWith(queryLower)) return 80;

    // Contains query as whole word
    const wordRegex = new RegExp(`\\b${queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (wordRegex.test(textLower)) return 60;

    // Contains query anywhere
    if (textLower.includes(queryLower)) return 40;

    // Fuzzy match - all query chars appear in order
    let queryIdx = 0;
    for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
        if (textLower[i] === queryLower[queryIdx]) queryIdx++;
    }
    if (queryIdx === queryLower.length) return 20;

    return 0;
}
