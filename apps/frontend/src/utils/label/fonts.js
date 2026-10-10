// Bundled label fonts: loaded for the app (Fontsource CSS) and embedded into print
// documents as data URIs so the hidden print window needs nothing from the network.
import interRegular from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import monoRegular from '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff2?url';
import monoBold from '@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff2?url';
import plexRegular from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url';
import plexBold from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2?url';
import { FONT_FAMILIES, fontFamilyCss } from './model.js';

const FONT_FILES = [
  { family: 'Inter', weight: 400, url: interRegular },
  { family: 'Inter', weight: 700, url: interBold },
  { family: 'Roboto Mono', weight: 400, url: monoRegular },
  { family: 'Roboto Mono', weight: 700, url: monoBold },
  { family: 'IBM Plex Sans', weight: 400, url: plexRegular },
  { family: 'IBM Plex Sans', weight: 700, url: plexBold },
];

let embedded = null;

const toDataUrl = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Label font unavailable: ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:font/woff2;base64,${btoa(binary)}`;
};

export const loadEmbeddedFonts = async () => {
  if (!embedded) {
    embedded = Promise.all(FONT_FILES.map(async (f) => ({ family: f.family, weight: f.weight, style: 'normal', dataUrl: await toDataUrl(f.url) })))
      .catch((error) => { embedded = null; throw error; });
  }
  return embedded;
};

// Make sure the browser has the faces loaded before measuring text with them.
export const ensureFontsReady = async (template) => {
  if (typeof document === 'undefined' || !document.fonts) return;
  const families = new Set();
  for (const el of template?.elements || []) {
    if (el.type === 'text') families.add(el.fontFamily);
    if (el.type === 'barcode') families.add('inter');
  }
  await document.fonts.ready;
  await Promise.all([...families].flatMap((value) => {
    const def = FONT_FAMILIES.find((f) => f.value === value);
    if (!def?.bundled) return [];
    return [400, 700].map((weight) => document.fonts.load(`${weight} 16px ${fontFamilyCss(value)}`).catch(() => null));
  }));
};
