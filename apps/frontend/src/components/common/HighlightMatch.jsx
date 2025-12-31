import React from 'react';

/**
 * HighlightMatch - Highlights matches for multiple terms (comma-separated or array).
 */
export function HighlightMatch({ text, query }) {
    if (!query || !text) return <span>{text}</span>;

    const textStr = String(text);
    const terms = typeof query === 'string'
        ? query.split(',').map(t => t.trim()).filter(Boolean)
        : (Array.isArray(query) ? query : [query]);

    if (terms.length === 0) return <span>{textStr}</span>;

    // To highlight all terms, we'll use a regex that matches any of them
    // Escape terms for regex
    const escapedTerms = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');

    const parts = textStr.split(regex);

    return (
        <span>
            {parts.map((part, i) => {
                const isMatch = terms.some(t => t.toLowerCase() === part.toLowerCase());
                if (isMatch) {
                    return (
                        <mark key={i} className="bg-yellow-200/80 dark:bg-yellow-500/40 text-inherit px-0.5 rounded-sm">
                            {part}
                        </mark>
                    );
                }
                return part;
            })}
        </span>
    );
}

export default HighlightMatch;
