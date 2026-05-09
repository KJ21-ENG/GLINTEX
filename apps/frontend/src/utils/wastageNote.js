/**
 * Extract the user-supplied portion of a cutter wastage note.
 *
 * The cutter bulk endpoint stores `wastageNote` as either:
 *   - "Wastage marked: 7.794 kg"                        (no operator note)
 *   - "Wastage marked: 7.794 kg — machine fault"        (operator note appended)
 *
 * We want UI affordances (the (i) tooltip next to the wastage badge) to appear
 * ONLY when there is real operator-written context. Auto-only notes return null.
 *
 * @param {string|null|undefined} rawNote
 * @returns {string|null} the trimmed user portion, or null if absent.
 */
export function extractUserWastageNote(rawNote) {
  if (!rawNote) return null;
  const trimmed = String(rawNote).trim();
  if (!trimmed) return null;
  // Em-dash separator is what the bulk endpoint inserts between the auto prefix
  // and the operator note. Tolerate ASCII " - " too as a safety net.
  const match = trimmed.match(/^Wastage marked:\s*[\d.]+\s*kg\s*[—-]\s*(.+)$/i);
  if (!match) return null;
  const userPart = match[1].trim();
  return userPart || null;
}
