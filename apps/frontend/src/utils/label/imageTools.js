// Browser-only helpers that turn whatever logo a person has into an image a label can
// carry: resized to at most LIMITS.imagePixelsMax on the long side, re-encoded to stay
// under LIMITS.imageBytesMax, and optionally reduced to pure black and white, which is
// what a thermal printer can actually print.
import { LIMITS } from './model.js';

const ACCEPTED = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'];
const fits = (dataUrl) => dataUrl.length <= LIMITS.imageBytesMax * 1.37;

const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Could not read the image'));
  reader.readAsDataURL(blob);
});

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('This image could not be opened'));
  img.src = src;
});

const draw = (img, maxPx) => {
  const w0 = img.naturalWidth || img.width || maxPx;
  const h0 = img.naturalHeight || img.height || maxPx;
  const scale = Math.min(1, maxPx / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w0 * scale));
  canvas.height = Math.max(1, Math.round(h0 * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const hasTransparency = (canvas) => {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 16) if (data[i] < 250) return true;
  return false;
};

// Re-encode until it fits: PNG keeps transparency and sharp edges; a photo without
// transparency falls back to JPEG; both shrink step by step if still too large.
const encodeToFit = (img) => {
  for (let px = LIMITS.imagePixelsMax; px >= 120; px = Math.round(px * 0.8)) {
    const canvas = draw(img, px);
    const png = canvas.toDataURL('image/png');
    if (fits(png)) return png;
    if (!hasTransparency(canvas)) {
      for (const quality of [0.92, 0.85, 0.75]) {
        const jpeg = canvas.toDataURL('image/jpeg', quality);
        if (fits(jpeg)) return jpeg;
      }
    }
  }
  throw new Error('This image is too detailed to fit on a label; use a simpler logo');
};

export const prepareLabelImage = async (input) => {
  let dataUrl;
  if (typeof input === 'string') {
    if (!/^data:image\//.test(input)) throw new Error('Not an image');
    dataUrl = input;
  } else {
    if (!input) throw new Error('No file selected');
    if (!ACCEPTED.includes(input.type)) throw new Error('Use a PNG, JPEG, SVG, WebP or GIF image');
    if (input.size > LIMITS.imageSourceBytesMax) throw new Error(`Image must be under ${Math.round(LIMITS.imageSourceBytesMax / 1024 / 1024)} MB`);
    dataUrl = await readAsDataUrl(input);
  }
  // A small vector logo stays vector; everything else becomes a right-sized bitmap.
  if (/^data:image\/svg\+xml;base64,/.test(dataUrl) && fits(dataUrl)) return dataUrl;
  if (/^data:image\/(png|jpeg);base64,/.test(dataUrl) && fits(dataUrl)) {
    const img = await loadImage(dataUrl);
    if (Math.max(img.naturalWidth, img.naturalHeight) <= LIMITS.imagePixelsMax) return dataUrl;
    return encodeToFit(img);
  }
  return encodeToFit(await loadImage(dataUrl));
};

// Pure black on transparent: dark pixels print, everything else is left blank.
export const toBlackAndWhite = async (dataUrl, threshold = 0.6) => {
  const img = await loadImage(dataUrl);
  const canvas = draw(img, LIMITS.imagePixelsMax);
  const ctx = canvas.getContext('2d');
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    const alpha = d[i + 3] / 255;
    const luminance = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    const ink = alpha > 0.5 && luminance < threshold;
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = ink ? 255 : 0;
  }
  ctx.putImageData(pixels, 0, 0);
  const png = canvas.toDataURL('image/png');
  if (fits(png)) return png;
  return encodeToFit(await loadImage(png));
};
