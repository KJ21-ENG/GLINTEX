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

    // Split by | for OR groups
    const orGroups = query.split('|').map(g => g.trim()).filter(Boolean);
    if (orGroups.length === 0) return 1;

    let maxOrScore = 0;
    let anyGroupMatched = false;

    for (const orGroup of orGroups) {
        // Inside each OR group, split by , for AND terms
        const andTerms = orGroup.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        if (andTerms.length === 0) continue;

        let groupScore = 0;
        let groupMatch = true;

        for (const term of andTerms) {
            let maxTermScore = 0;
            for (const field of fields) {
                const value = item[field];
                if (value === undefined || value === null) continue;

                const score = fuzzyScore(String(value), term);
                if (score > maxTermScore) maxTermScore = score;
            }

            // For multi-term search, we require a higher precision (substring match or better)
            // Score >= 40 means "Contains query anywhere"
            const threshold = andTerms.length > 1 ? 40 : 20;

            if (maxTermScore < threshold) {
                groupMatch = false;
                break;
            }

            groupScore += maxTermScore;
        }

        if (groupMatch) {
            anyGroupMatched = true;
            const finalGroupScore = groupScore / andTerms.length;
            if (finalGroupScore > maxOrScore) maxOrScore = finalGroupScore;
        }
    }

    return anyGroupMatched ? maxOrScore : 0;
}

