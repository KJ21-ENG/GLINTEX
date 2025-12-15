/**
 * Select component - Re-exports SearchableSelect as default
 * This provides backward compatibility for existing imports
 */
import { SearchableSelect } from '../common/SearchableSelect';

// Re-export SearchableSelect as Select for backward compatibility
export const Select = SearchableSelect;

export default Select;
