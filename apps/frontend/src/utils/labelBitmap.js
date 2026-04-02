import bwipjs from 'bwip-js';
import {
  DEFAULT_DIMENSIONS,
  DOTS_PER_MM,
  FONT_FAMILY_OPTIONS,
  getBarcodeQuietZoneMm,
  getFontFamilyCss,
  getFontScale,
  getTsplPreambleLines,
  getWrappedTextLines,
  migrateContent,
  normalizeCopies,
  prepareTemplateFields,
} from './labelPrint';

const ASCII_ENCODER = new TextEncoder();
const DEFAULT_PREVIEW_PIXELS_PER_MM = 6;
const DEFAULT_TEXT_COLOR = '#0f172a';
const BITMAP_THRESHOLD = 128;

export const BITMAP_DARK_BIT = 0;
export const BITMAP_LIGHT_BIT = 1;

let measurementCanvas = null;
const barcodeCanvasCache = new Map();

const encodeAscii = (value) => ASCII_ENCODER.encode(value);

const concatUint8Arrays = (chunks = []) => {
  const totalLength = chunks.reduce((sum, chunk) => sum + (chunk?.length || 0), 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;

  chunks.forEach((chunk) => {
    if (!(chunk instanceof Uint8Array) || chunk.length === 0) return;
    out.set(chunk, offset);
    offset += chunk.length;
  });

  return out;
};

const createCanvas = (width, height) => {
  if (typeof document === 'undefined') {
    throw new Error('Bitmap rendering requires a browser environment');
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

const getMeasurementContext = () => {
  if (!measurementCanvas) {
    measurementCanvas = createCanvas(1, 1);
  }
  const context = measurementCanvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to acquire canvas context for text measurement');
  }
  return context;
};

const getPixelsPerMm = (options = {}) => {
  const numeric = Number(options.pixelsPerMm);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  if (options.preserveColor) return DEFAULT_PREVIEW_PIXELS_PER_MM;
  return DOTS_PER_MM;
};

const mmToRenderPixels = (mm, pixelsPerMm) => Math.max(1, Math.round(Number(mm || 0) * pixelsPerMm));
const pxToMm = (px, pixelsPerMm) => Number(px || 0) / pixelsPerMm;

const buildTextFont = (style = {}, fontSizePx) =>
  `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : '500 '}${fontSizePx}px ${getFontFamilyCss(style.fontFamily)}`;

const drawWithRotation = (ctx, x, y, angle, draw) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((((angle % 360) + 360) % 360) * Math.PI / 180);
  draw(ctx);
  ctx.restore();
};

const buildBarcodeCacheKey = (value, style = {}, pixelsPerMm) =>
  JSON.stringify({
    value,
    moduleMm: Number(style.moduleMm ?? 0.3).toFixed(3),
    heightMm: Number(style.heightMm ?? 12).toFixed(3),
    humanReadable: style.humanReadable !== false,
    profile: style.profile === 'robust' ? 'robust' : 'balanced',
    quietZoneMm: getBarcodeQuietZoneMm(style),
    pixelsPerMm: Number(pixelsPerMm).toFixed(3),
  });

const applyPrinterPreview = (ctx, width, height) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const gray = ((0.299 * data[index]) + (0.587 * data[index + 1]) + (0.114 * data[index + 2])) * alpha + 255 * (1 - alpha);
    const channel = gray < BITMAP_THRESHOLD ? 0 : 255;
    data[index] = channel;
    data[index + 1] = channel;
    data[index + 2] = channel;
    data[index + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
};

export const waitForLabelFonts = async (template = {}) => {
  if (typeof document === 'undefined' || !document.fonts?.ready) return;

  const content = migrateContent(template.content || template);
  const families = new Set(
    (content.texts || [])
      .map((block) => block?.style?.fontFamily)
      .filter((fontFamily) => FONT_FAMILY_OPTIONS.some((option) => option.value === fontFamily)),
  );

  await document.fonts.ready;
  await Promise.all(
    Array.from(families).map((fontFamily) => document.fonts.load(`16px ${getFontFamilyCss(fontFamily)}`)),
  );
};

const renderBarcodeToCanvas = (value, style = {}, options = {}) => {
  const pixelsPerMm = getPixelsPerMm(options);
  const barcodeValue = value || 'SAMPLE';
  const cacheKey = buildBarcodeCacheKey(barcodeValue, style, pixelsPerMm);
  if (barcodeCanvasCache.has(cacheKey)) {
    return barcodeCanvasCache.get(cacheKey);
  }

  const modulePixels = Math.max(1, mmToRenderPixels(style.moduleMm ?? 0.3, pixelsPerMm));
  const heightPixels = Math.max(16, mmToRenderPixels(style.heightMm ?? 12, pixelsPerMm));
  const heightMmForBwip = Number(((heightPixels * 25.4) / (72 * modulePixels)).toFixed(2));
  const quietZoneMm = getBarcodeQuietZoneMm(style);
  const innerCanvas = createCanvas(1, 1);

  bwipjs.toCanvas(innerCanvas, {
    bcid: 'code128',
    text: barcodeValue,
    scale: modulePixels,
    height: heightMmForBwip,
    includetext: style.humanReadable !== false,
    textxalign: 'center',
    backgroundcolor: 'FFFFFF',
  });

  const paddingLeft = mmToRenderPixels(quietZoneMm.left, pixelsPerMm);
  const paddingRight = mmToRenderPixels(quietZoneMm.right, pixelsPerMm);
  const paddingTop = mmToRenderPixels(quietZoneMm.top, pixelsPerMm);
  const paddingBottom = mmToRenderPixels(quietZoneMm.bottom, pixelsPerMm);
  const canvas = createCanvas(
    innerCanvas.width + paddingLeft + paddingRight,
    innerCanvas.height + paddingTop + paddingBottom,
  );
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('Unable to acquire canvas context for barcode rendering');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(innerCanvas, paddingLeft, paddingTop);

  barcodeCanvasCache.set(cacheKey, canvas);
  return canvas;
};

export const getBitmapPolaritySanity = () => {
  const setPackedBit = (packed, bitIndex, bitValue) =>
    bitValue === BITMAP_LIGHT_BIT
      ? packed | (1 << (7 - bitIndex))
      : packed & ~(1 << (7 - bitIndex));

  let whiteByte = 0;
  let blackByte = 0;
  let reversedByte = 0;

  for (let bit = 0; bit < 8; bit += 1) {
    whiteByte = setPackedBit(whiteByte, bit, BITMAP_LIGHT_BIT);
    blackByte = setPackedBit(blackByte, bit, BITMAP_DARK_BIT);
    reversedByte = setPackedBit(reversedByte, bit, bit < 4 ? BITMAP_DARK_BIT : BITMAP_LIGHT_BIT);
  }

  const toHex = (value) => value.toString(16).toUpperCase().padStart(2, '0');
  return {
    whiteByte: toHex(whiteByte),
    blackByte: toHex(blackByte),
    reversedByte: toHex(reversedByte),
  };
};

export const measureRenderedBlock = (field = {}, dimensions, options = {}) => {
  const dims = { ...DEFAULT_DIMENSIONS, ...(dimensions || {}) };
  const pixelsPerMm = getPixelsPerMm(options);
  const type = field.type || 'text';
  const angle = ((Number(field.angle) || 0) % 360 + 360) % 360;

  if (type === 'line') {
    const lengthMm = Math.max(0.1, Number(field.style?.lengthMm ?? 20));
    const thicknessMm = Math.max(0.1, Number(field.style?.thicknessMm ?? 0.6));
    const horizontal = angle === 0 || angle === 180;
    const widthMm = horizontal ? lengthMm : thicknessMm;
    const heightMm = horizontal ? thicknessMm : lengthMm;
    return {
      type,
      widthMm,
      heightMm,
      widthPx: mmToRenderPixels(widthMm, pixelsPerMm),
      heightPx: mmToRenderPixels(heightMm, pixelsPerMm),
      pixelsPerMm,
    };
  }

  if (type === 'barcode') {
    const barcodeCanvas = renderBarcodeToCanvas(field._computedValue ?? field.value ?? '', field.style, options);
    const quietZoneMm = getBarcodeQuietZoneMm(field.style || {});
    return {
      type,
      barcodeCanvas,
      quietZoneMm,
      widthPx: barcodeCanvas.width,
      heightPx: barcodeCanvas.height,
      widthMm: pxToMm(barcodeCanvas.width, pixelsPerMm),
      heightMm: pxToMm(barcodeCanvas.height, pixelsPerMm),
      pixelsPerMm,
    };
  }

  const style = field.style || {};
  const fieldScale = getFontScale(style.size || dims.fontSize);
  const charHeightMm = 3 * fieldScale;
  const lineHeightMm = charHeightMm * 1.05;
  const paddingMm = style.background?.enabled ? Number(style.background?.paddingMm ?? 0.8) : 0;
  const underlineExtraMm = style.underline ? charHeightMm * 0.3 : 0;
  const fontSizePx = mmToRenderPixels(charHeightMm, pixelsPerMm);
  const lineHeightPx = mmToRenderPixels(lineHeightMm, pixelsPerMm);
  const paddingPx = paddingMm > 0 ? mmToRenderPixels(paddingMm, pixelsPerMm) : 0;
  const underlineExtraPx = underlineExtraMm > 0 ? mmToRenderPixels(underlineExtraMm, pixelsPerMm) : 0;
  const value = String(field._computedValue ?? field.value ?? '');
  const lines = getWrappedTextLines(field, dims, value, options);
  const context = getMeasurementContext();
  const font = buildTextFont(style, fontSizePx);
  context.font = font;
  context.textBaseline = 'top';

  const lineWidthsPx = lines.map((lineValue) => {
    if (!lineValue) return Math.max(1, Math.ceil(context.measureText(' ').width));
    return Math.max(1, Math.ceil(context.measureText(lineValue).width));
  });
  const backgroundSafetyPx = style.background?.enabled ? 2 : 0;
  const widthPx = Math.max(1, Math.max(...lineWidthsPx, 1) + paddingPx * 2 + backgroundSafetyPx);
  const heightPx = Math.max(
    1,
    fontSizePx + lineHeightPx * Math.max(0, lines.length - 1) + paddingPx * 2 + underlineExtraPx + backgroundSafetyPx,
  );

  return {
    type,
    font,
    fontSizePx,
    lineHeightPx,
    paddingPx,
    underlineExtraPx,
    underlineOffsetPx: Math.max(2, Math.round(fontSizePx * 0.17)),
    lineWidthsPx,
    lines,
    widthPx,
    heightPx,
    widthMm: pxToMm(widthPx, pixelsPerMm),
    heightMm: pxToMm(heightPx, pixelsPerMm),
    pixelsPerMm,
  };
};

export const renderLabelToCanvas = (template = {}, data = {}, options = {}) => {
  const dimensions = { ...DEFAULT_DIMENSIONS, ...(template.dimensions || {}) };
  const content = migrateContent(template.content || template);
  const pixelsPerMm = getPixelsPerMm(options);
  const { dims, fields } = prepareTemplateFields(dimensions, content, data, options);
  const renderFields = fields.map((field) => ({
    ...field,
    renderMetrics: measureRenderedBlock(field, dims, { ...options, pixelsPerMm }),
  }));
  const widthPx = Math.max(1, Math.round(dims.width * pixelsPerMm));
  const heightPx = Math.max(1, Math.round(dims.height * pixelsPerMm));
  const canvas = createCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d', { alpha: false });

  if (!ctx) {
    throw new Error('Unable to acquire canvas context for label rendering');
  }

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);

  renderFields.forEach((field) => {
    if (field?.style?.visible === false) return;

    const x = Math.round((dims.offsetX + (field.pos?.x || 0)) * pixelsPerMm);
    const y = Math.round((dims.offsetY + (field.pos?.y || 0)) * pixelsPerMm);
    const angle = ((Number(field.angle) || 0) % 360 + 360) % 360;
    const metrics = field.renderMetrics;

    if (field.type === 'line') {
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.fillRect(x, y, metrics.widthPx, metrics.heightPx);
      ctx.restore();
      return;
    }

    const finalValue = String(field._computedValue ?? '');
    if (!finalValue) return;

    if (field.type === 'barcode') {
      drawWithRotation(ctx, x, y, angle, (rotatedCtx) => {
        rotatedCtx.drawImage(metrics.barcodeCanvas, 0, 0);
      });
      return;
    }

    const style = field.style || {};
    const preserveColor = options.preserveColor === true;
    const backgroundColor = preserveColor ? style.background?.color || '#000000' : '#000000';
    const textColor = preserveColor
      ? style.background?.enabled
        ? style.background?.textColor || '#ffffff'
        : DEFAULT_TEXT_COLOR
      : style.background?.enabled
        ? '#ffffff'
        : '#000000';
    const opacity = Math.max(0, Math.min(1, Number(style.opacity ?? 1)));

    drawWithRotation(ctx, x, y, angle, (rotatedCtx) => {
      rotatedCtx.globalAlpha = opacity;
      rotatedCtx.font = metrics.font;
      rotatedCtx.textBaseline = 'top';
      rotatedCtx.textAlign = 'left';

      metrics.lines.forEach((lineValue, index) => {
        const lineY = metrics.lineHeightPx * index;
        const lineWidthPx = metrics.lineWidthsPx[index] || 1;

        if (style.background?.enabled) {
          rotatedCtx.fillStyle = backgroundColor;
          rotatedCtx.fillRect(
            -metrics.paddingPx,
            lineY - metrics.paddingPx,
            lineWidthPx + metrics.paddingPx * 2 + 2,
            metrics.fontSizePx + metrics.paddingPx * 2 + (style.underline ? 2 : 0) + 2,
          );
        }

        rotatedCtx.fillStyle = textColor;
        rotatedCtx.fillText(lineValue, 0, lineY);

        if (style.underline) {
          rotatedCtx.fillRect(0, lineY + metrics.fontSizePx + metrics.underlineOffsetPx, lineWidthPx, 2);
        }
      });
    });
  });

  if (options.printerMode === true) {
    applyPrinterPreview(ctx, widthPx, heightPx);
  }

  return {
    canvas,
    dims,
    fields: renderFields,
    pixelsPerMm,
    widthPx,
    heightPx,
    widthDots: widthPx,
    heightDots: heightPx,
  };
};

export const canvasToMonoBitmap = (canvas) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to acquire canvas context for monochrome conversion');
  }

  const { width, height } = canvas;
  const widthBytes = Math.ceil(width / 8);
  const bitmap = new Uint8Array(widthBytes * height);
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const setPackedBit = (packed, bitIndex, bitValue) =>
    bitValue === BITMAP_LIGHT_BIT
      ? packed | (1 << (7 - bitIndex))
      : packed & ~(1 << (7 - bitIndex));

  for (let y = 0; y < height; y += 1) {
    for (let byteIndex = 0; byteIndex < widthBytes; byteIndex += 1) {
      let packed = 0;

      for (let bit = 0; bit < 8; bit += 1) {
        const x = byteIndex * 8 + bit;
        let bitValue = BITMAP_LIGHT_BIT;

        if (x < width) {
          const pixelIndex = (y * width + x) * 4;
          const r = imageData[pixelIndex];
          const g = imageData[pixelIndex + 1];
          const b = imageData[pixelIndex + 2];
          const a = imageData[pixelIndex + 3] / 255;
          const gray = ((0.299 * r) + (0.587 * g) + (0.114 * b)) * a + 255 * (1 - a);
          bitValue = gray < BITMAP_THRESHOLD ? BITMAP_DARK_BIT : BITMAP_LIGHT_BIT;
        }

        packed = setPackedBit(packed, bit, bitValue);
      }

      bitmap[y * widthBytes + byteIndex] = packed;
    }
  }

  return bitmap;
};

export const buildBitmapTspl = (dimensions, bitmap, widthBytes, heightDots, options = {}) => {
  const { dims, lines } = getTsplPreambleLines(dimensions);
  const copies = normalizeCopies(options.copies || 1);
  const chunks = [encodeAscii(`${lines.join('\r\n')}\r\n`)];

  for (let col = 0; col < dims.columns; col += 1) {
    const xDots = Math.round((dims.marginLeft + (dims.width + dims.horizontalGap) * col) * DOTS_PER_MM);
    const yDots = Math.round(dims.marginTop * DOTS_PER_MM);
    chunks.push(encodeAscii(`BITMAP ${xDots},${yDots},${widthBytes},${heightDots},0,`));
    chunks.push(bitmap);
    chunks.push(encodeAscii('\r\n'));
  }

  chunks.push(encodeAscii(`PRINT ${copies}\r\n`));
  return concatUint8Arrays(chunks);
};

export const buildBitmapTsplFromTemplate = async (template = {}, data = {}, options = {}) => {
  await waitForLabelFonts(template);
  const dimensions = { ...DEFAULT_DIMENSIONS, ...(template.dimensions || {}) };
  const content = migrateContent(template.content || template);
  const { canvas, widthDots, heightDots } = renderLabelToCanvas(
    { dimensions, content },
    data,
    { ...options, pixelsPerMm: DOTS_PER_MM, preserveColor: false, printerMode: false },
  );
  const bitmap = canvasToMonoBitmap(canvas);
  const copies = normalizeCopies(options.copies || content.copies || 1);
  return buildBitmapTspl(dimensions, bitmap, Math.ceil(widthDots / 8), heightDots, { ...options, copies });
};
