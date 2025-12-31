import { fuzzyScore } from './search';

/**
 * Calculates a consolidated search score for an item based on multiple terms and fields.
 * 
 * Logic:
 * 1. Split query into terms by comma.
 * 2. For each term, find the highest match score across all provided fields.
 * 3. Use AND logic: if any term has 0 match score across all fields, the total score is 0.
 * 4. Otherwise, return the average/sum of the best scores per term.
 * 
 * @param {Object} item The item to score.
 * @param {string} query The raw search query (comma separated).
 * @param {string[]} fields The field names to check in the item.
 * @returns {number} The final score (0 means no match).
 */
export function calculateMultiTermScore(item, query, fields) {
    if (!query) return 1;

    const terms = query.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    if (terms.length === 0) return 1;

    let totalScore = 0;

    for (const term of terms) {
        let maxTermScore = 0;
        for (const field of fields) {
            const value = item[field];
            if (value === undefined || value === null) continue;

            const score = fuzzyScore(String(value), term);
            if (score > maxTermScore) maxTermScore = score;
        }

        // For multi-term search, we require a higher precision (substring match or better)
        // Score >= 40 means "Contains query anywhere"
        // This prevents extremely loose fuzzy matches from passing the "AND" filter.
        const threshold = terms.length > 1 ? 40 : 20;

        if (maxTermScore < threshold) return 0;

        totalScore += maxTermScore;
    }

    return totalScore / terms.length;
}
