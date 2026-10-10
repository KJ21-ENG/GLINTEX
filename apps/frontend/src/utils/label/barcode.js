// Symbol encoding. bwip-js produces the module pattern; we draw the modules ourselves so
// every bar is an exact multiple of the printer dot and lands on a whole-dot boundary.
import bwipjs from 'bwip-js';

const cache = new Map();

export const encodeCode128 = (value) => {
  const key = `c128:${value}`;
  if (cache.has(key)) return cache.get(key);
  let result;
  try {
    const [symbol] = bwipjs.raw({ bcid: 'code128', text: String(value) });
    // sbs = alternating bar/space module widths, starting with a bar.
    const sbs = Array.from(symbol.sbs, Number);
    const totalModules = sbs.reduce((sum, n) => sum + n, 0);
    result = { ok: true, sbs, totalModules };
  } catch (error) {
    result = { ok: false, error: error.message || 'Unencodable barcode value', sbs: [], totalModules: 0 };
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, result);
  return result;
};

export const encodeQr = (value, ecLevel = 'M') => {
  const key = `qr:${ecLevel}:${value}`;
  if (cache.has(key)) return cache.get(key);
  let result;
  try {
    const [symbol] = bwipjs.raw({ bcid: 'qrcode', text: String(value), eclevel: ecLevel });
    result = { ok: true, size: symbol.pixx, pixels: symbol.pixs };
  } catch (error) {
    result = { ok: false, error: error.message || 'Unencodable QR value', size: 0, pixels: [] };
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, result);
  return result;
};

// Horizontal black runs per row, for compact SVG output.
export const qrRuns = (size, pixels) => {
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const runs = [];
    let x = 0;
    while (x < size) {
      if (pixels[y * size + x]) {
        const start = x;
        while (x < size && pixels[y * size + x]) x += 1;
        runs.push({ x: start, w: x - start });
      } else {
        x += 1;
      }
    }
    rows.push(runs);
  }
  return rows;
};
