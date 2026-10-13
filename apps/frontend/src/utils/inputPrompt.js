// In-app replacement for window.prompt(). The GLINTEX desktop app (Electron) does not
// implement prompt(); calling it throws "prompt() is not supported". Use askForInput()
// instead: it resolves with the entered string, or null when the person cancels.
const listeners = new Set();
let pending = null;

export const subscribeInputPrompt = (listener) => {
  listeners.add(listener);
  listener(pending);
  return () => listeners.delete(listener);
};

const publish = () => { for (const listener of listeners) listener(pending); };

export const askForInput = (options = {}) => new Promise((resolve, reject) => {
  if (listeners.size === 0) {
    reject(new Error('Input dialog is not available on this screen'));
    return;
  }
  // A new question replaces an unanswered one, which counts as cancelled.
  if (pending) pending.resolve(null);
  pending = {
    title: options.title || 'GLINTEX',
    label: options.label || '',
    defaultValue: options.defaultValue ?? '',
    type: options.type || 'text',
    min: options.min,
    max: options.max,
    confirmLabel: options.confirmLabel || 'OK',
    validate: typeof options.validate === 'function' ? options.validate : null,
    resolve: (value) => {
      if (!pending) return;
      pending = null;
      publish();
      resolve(value);
    },
  };
  publish();
});

// Whole positive number, as the sticker quantity questions need; null when cancelled.
export const askForQuantity = async ({ title = 'How many stickers?', label = 'Quantity of stickers to print', defaultValue = '1', max = 100 } = {}) => {
  const value = await askForInput({
    title, label, defaultValue, type: 'number', min: 1, max, confirmLabel: 'Print',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return 'Enter a whole number, 1 or more';
      if (n > max) return `At most ${max} at a time`;
      return null;
    },
  });
  return value === null ? null : Number(value);
};
