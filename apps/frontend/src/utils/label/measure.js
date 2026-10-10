// Browser text measurer backed by a canvas, using the same font faces the page renders with.
import { PT_TO_MM } from './layout.js';

const PX_PER_PT = 96 / 72;
const MM_PER_PX = 25.4 / 96;

export const createCanvasMeasurer = () => {
  if (typeof document === 'undefined') throw new Error('Canvas measurement requires a browser');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to acquire canvas context for text measurement');
  const cache = new Map();
  return {
    measure: (text, font) => {
      const key = `${font.family}|${font.sizePt}|${font.bold ? 1 : 0}|${font.italic ? 1 : 0}|${font.letterSpacingPt || 0}|${text}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      context.font = `${font.italic ? 'italic ' : ''}${font.bold ? '700' : '400'} ${font.sizePt * PX_PER_PT}px ${font.family}`;
      let widthMm = context.measureText(String(text)).width * MM_PER_PX;
      if (font.letterSpacingPt) widthMm += Math.max(0, String(text).length - 1) * font.letterSpacingPt * PT_TO_MM;
      if (cache.size > 5000) cache.clear();
      cache.set(key, widthMm);
      return widthMm;
    },
    clear: () => cache.clear(),
  };
};
