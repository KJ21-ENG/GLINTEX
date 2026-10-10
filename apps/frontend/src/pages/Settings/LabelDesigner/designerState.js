// Designer state: one template, a selection, and an undo history of whole-template
// snapshots. Interactions that move things continuously (drag, resize) stage a
// transaction so the history records one step per gesture.
import { normalizeTemplate, cloneTemplate, createElement, ELEMENT_DEFAULTS } from '../../../utils/label/model';

export const HISTORY_LIMIT = 100;

export const initialDesignerState = () => ({
  stageKey: null,
  template: normalizeTemplate({}),
  savedJson: '',
  origin: 'empty', // 'saved' | 'default' | 'empty'
  selectedIds: [],
  past: [],
  future: [],
  transaction: null,
  loading: false,
  error: null,
});

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const pushPast = (state, snapshot) => ({
  past: [...state.past, snapshot].slice(-HISTORY_LIMIT),
  future: [],
});

const withTemplate = (state, updater, { history = true } = {}) => {
  const next = normalizeTemplate(updater(cloneTemplate(state.template)));
  if (same(next, state.template)) return state;
  const base = { ...state, template: next };
  if (!history || state.transaction) return base;
  return { ...base, ...pushPast(state, state.template) };
};

const keepSelection = (state, elements) => state.selectedIds.filter((id) => elements.some((el) => el.id === id));

// A saved design is dirty when it differs from the server copy; an untouched factory
// default is not dirty (nothing to lose), it becomes dirty once edited.
export const isDirty = (state) => {
  if (state.origin === 'saved') return JSON.stringify(state.template) !== state.savedJson;
  if (state.origin === 'default' || state.origin === 'legacy') return state.past.length > 0 || state.transaction !== null;
  return false;
};

export function designerReducer(state, action) {
  switch (action.type) {
    case 'loading':
      return { ...state, loading: true, error: null };
    case 'load': {
      const template = normalizeTemplate(action.template);
      return {
        ...state,
        stageKey: action.stageKey,
        template,
        savedJson: action.origin === 'saved' ? JSON.stringify(template) : '',
        origin: action.origin,
        selectedIds: [],
        past: [],
        future: [],
        transaction: null,
        loading: false,
        error: null,
      };
    }
    case 'loadFailed':
      return { ...state, loading: false, error: action.error };
    case 'select':
      return { ...state, selectedIds: [...new Set(action.ids)] };
    case 'toggleSelect':
      return { ...state, selectedIds: state.selectedIds.includes(action.id) ? state.selectedIds.filter((id) => id !== action.id) : [...state.selectedIds, action.id] };
    case 'updateMedia':
      return withTemplate(state, (t) => ({ ...t, media: { ...t.media, ...action.patch } }));
    case 'setCopies':
      return withTemplate(state, (t) => ({ ...t, copies: action.copies }));
    case 'updateElements': {
      const ids = new Set(action.ids);
      return withTemplate(state, (t) => ({ ...t, elements: t.elements.map((el) => (ids.has(el.id) ? { ...el, ...(typeof action.patch === 'function' ? action.patch(el) : action.patch) } : el)) }), { history: action.history !== false });
    }
    case 'replaceTemplate':
      return withTemplate(state, () => action.template, { history: action.history !== false });
    case 'addElement': {
      const element = createElement(action.elementType, { ...ELEMENT_DEFAULTS[action.elementType], ...(action.overrides || {}) });
      const next = withTemplate(state, (t) => ({ ...t, elements: [...t.elements, element] }));
      return { ...next, selectedIds: [element.id] };
    }
    case 'removeElements': {
      const ids = new Set(action.ids);
      const next = withTemplate(state, (t) => ({ ...t, elements: t.elements.filter((el) => !ids.has(el.id) || el.locked) }));
      return { ...next, selectedIds: keepSelection(next, next.template.elements) };
    }
    case 'duplicateElements': {
      const ids = new Set(action.ids);
      const clones = [];
      const next = withTemplate(state, (t) => {
        const copies = t.elements.filter((el) => ids.has(el.id)).map((el) => {
          const copy = createElement(el.type, { ...el, id: undefined, x: el.x + 2, y: el.y + 2, locked: false });
          clones.push(copy.id);
          return copy;
        });
        return { ...t, elements: [...t.elements, ...copies] };
      });
      return { ...next, selectedIds: clones };
    }
    case 'reorder': {
      return withTemplate(state, (t) => {
        const index = t.elements.findIndex((el) => el.id === action.id);
        if (index < 0) return t;
        const elements = [...t.elements];
        const [el] = elements.splice(index, 1);
        const target = action.direction === 'front' ? elements.length : action.direction === 'back' ? 0 : action.direction === 'up' ? Math.min(elements.length, index + 1) : Math.max(0, index - 1);
        elements.splice(target, 0, el);
        return { ...t, elements };
      });
    }
    case 'beginTransaction':
      return state.transaction ? state : { ...state, transaction: cloneTemplate(state.template) };
    case 'commitTransaction': {
      if (!state.transaction) return state;
      const before = state.transaction;
      const next = { ...state, transaction: null };
      if (same(before, state.template)) return next;
      return { ...next, ...pushPast(state, before) };
    }
    case 'cancelTransaction':
      return state.transaction ? { ...state, template: state.transaction, transaction: null } : state;
    case 'undo': {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return { ...state, template: previous, past: state.past.slice(0, -1), future: [state.template, ...state.future].slice(0, HISTORY_LIMIT), selectedIds: keepSelection(state, previous.elements), transaction: null };
    }
    case 'redo': {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { ...state, template: next, past: [...state.past, state.template].slice(-HISTORY_LIMIT), future: rest, selectedIds: keepSelection(state, next.elements), transaction: null };
    }
    case 'markSaved':
      return { ...state, savedJson: JSON.stringify(action.template ? normalizeTemplate(action.template) : state.template), origin: 'saved' };
    default:
      return state;
  }
}
