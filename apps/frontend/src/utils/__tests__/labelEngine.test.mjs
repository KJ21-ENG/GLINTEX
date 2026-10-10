// Label engine, version 2: model, migration, layout, HTML and artifact geometry.
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { normalizeTemplate, createElement, canvasSize, usedRollWidthMm, elementBox, rotatedBox } from '../label/model.js';
import { migrateV1Template, toV2Template } from '../label/migrate.js';
import { layoutLabel, createEstimateMeasurer, wrapParagraph, quantizeToDots } from '../label/layout.js';
import { renderLabelMarkup, renderPage, rotationTransform, assemblePrintDocument, mm } from '../label/html.js';
import { buildPrintableArtifact, artifactToDocument } from '../label/artifact.js';
import { substitutePlaceholders, listPlaceholders } from '../label/placeholders.js';
import { DEFAULT_STAGE_TEMPLATES, CALIBRATION_TEMPLATE } from '../label/defaults.js';
import { LABEL_STAGE_KEYS, STAGE_VARIABLES } from '../label/stages.js';
import { buildSampleData } from '../label/sampleData.js';
import { fontFamilyCss } from '../label/model.js';

const measurer = createEstimateMeasurer();

test('placeholders keep both syntaxes, aliases, dates and weights', () => {
  const data = { itemName: 'POLY', barcode: 'RCO-1-2', date: '2026-10-10', netWeight: 1.5 };
  assert.equal(substitutePlaceholders('{{itemName}} @barcodeNumber @date @netWeight @missing', data), 'POLY RCO-1-2 10/10/2026 1.500 @missing');
  assert.deepEqual(listPlaceholders('A @x {{ y }} @z.w'), ['x', 'y', 'z.w']);
});

test('normalizeTemplate clamps media and fills element defaults', () => {
  const t = normalizeTemplate({ version: 2, media: { widthMm: 50, heightMm: 25, rollWidthMm: 10, columns: 99 }, elements: [{ type: 'text', text: 'x' }, { type: 'barcode' }, { type: 'nope' }] });
  assert.equal(t.media.rollWidthMm, 50, 'roll cannot be narrower than the label');
  assert.equal(t.media.columns, 8);
  assert.equal(t.elements[0].fontSizePt, 10);
  assert.equal(t.elements[1].symbology, 'code128');
  assert.equal(t.elements[2].type, 'text', 'unknown types fall back to text');
  assert.deepEqual(canvasSize({ widthMm: 75, heightMm: 125, orientation: 'landscape' }), { widthMm: 125, heightMm: 75 });
  assert.equal(usedRollWidthMm({ marginLeftMm: 1, widthMm: 50, columns: 2, columnGapMm: 2 }), 103);
  assert.deepEqual(rotatedBox({ x: 1, y: 2, w: 10, h: 4 }, 90), { x: 1, y: 2, w: 4, h: 10 });
});

test('v1 landscape templates map to reading coordinates exactly', () => {
  const v1 = {
    dimensions: { width: 75, height: 125, orientation: 'landscape', pageWidth: 75, columns: 1 },
    content: { copies: 2, texts: [
      { id: 'title', type: 'text', angle: 270, pos: { x: 0, y: 123 }, value: 'RECEIVE', style: { size: 21, bold: true, background: { enabled: true, paddingMm: 0.8 } } },
      { id: 'row', type: 'text', angle: 270, pos: { x: 10, y: 122 }, value: 'DATE : @date', style: { size: 17 } },
      { id: 'bc', type: 'barcode', angle: 270, pos: { x: 61, y: 100 }, value: '{{barcode}}', style: { heightMm: 8, moduleMm: 0.42, humanReadable: true } },
      { id: 'vl', type: 'line', angle: 90, pos: { x: 7, y: 0 }, style: { lengthMm: 125, thicknessMm: 0.1 } },
    ] },
  };
  const t = migrateV1Template(v1);
  assert.equal(t.version, 2);
  assert.equal(t.copies, 2);
  assert.equal(t.media.orientation, 'landscape');
  const title = t.elements.find((e) => e.id === 'title');
  assert.equal(title.rotation, 0);
  assert.equal(Math.round(title.x * 10) / 10, 2 - 0.8, 'reading x = 125 - 123 minus padding');
  assert.equal(title.y, 0 - 0.8);
  assert.equal(title.invert, true);
  assert.equal(title.fontSizePt, 18, '21 pseudo-points become 18 pt');
  const row = t.elements.find((e) => e.id === 'row');
  assert.equal(row.x, 3);
  assert.equal(row.y, 10);
  const bc = t.elements.find((e) => e.id === 'bc');
  assert.equal(bc.type, 'barcode');
  assert.equal(bc.x, 25);
  assert.equal(bc.y, 61);
  const vl = t.elements.find((e) => e.id === 'vl');
  assert.equal(vl.direction, 'horizontal');
  assert.equal(vl.y, 7);
  assert.equal(vl.x, 0);
  assert.equal(vl.lengthMm, 125);
});

test('v1 portrait small sticker keeps positions and toV2Template is idempotent', () => {
  const v1 = { dimensions: { width: 50, height: 25, columns: 2, pageWidth: 105, horizontalGap: 2, offsetX: 1, offsetY: -1 }, content: { copies: 1, texts: [
    { id: 'item', type: 'text', angle: 0, pos: { x: 3, y: 3 }, value: '@itemName', style: { size: 10, bold: true, wrapAtCenter: true } },
    { id: 'bc', type: 'barcode', angle: 0, pos: { x: 5, y: 14 }, value: '{{barcode}}', style: { heightMm: 7, moduleMm: 0.25 } },
  ] } };
  const t = toV2Template(v1);
  assert.equal(t.media.columns, 2);
  assert.equal(t.media.offsetXMm, 1);
  assert.equal(t.media.offsetYMm, -1);
  assert.deepEqual([t.elements[0].x, t.elements[0].y], [3, 3]);
  assert.deepEqual([t.elements[1].x, t.elements[1].y], [5, 14]);
  assert.deepEqual(toV2Template(t), t);
  const stored = { id: 'row', stageKey: 'x', dimensions: { version: 2, ...t.media }, content: t };
  assert.deepEqual(toV2Template(stored), t, 'stored version 2 rows unwrap from content');
});

test('wrapParagraph breaks on words and splits overlong words', () => {
  const measure = (s) => s.length;
  assert.deepEqual(wrapParagraph('aaa bbb ccc', 7, measure), ['aaa bbb', 'ccc']);
  assert.deepEqual(wrapParagraph('abcdefghij', 4, measure), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(wrapParagraph('', 4, measure), ['']);
});

test('text layout wraps, shrinks to fit and aligns inside its box', () => {
  const el = createElement('text', { id: 't', x: 0, y: 0, w: 30, h: 8, text: 'POLYESTER METALLIC SILVER EXTRA LONG', fontSizePt: 12, bold: true, overflow: 'wrap-shrink', minFontSizePt: 5, paddingMm: 0 });
  const out = layoutLabel({ version: 2, media: { widthMm: 50, heightMm: 25, orientation: 'portrait' }, elements: [el] }, {}, measurer);
  const t = out.elements[0];
  assert.ok(t.layout.fontSizePt < 12, 'font shrank');
  assert.ok(t.layout.lines.length >= 2);
  assert.equal(t.layout.overflowing, false);
  for (const line of t.layout.lines) assert.ok(line.x >= 0 && line.w <= 30.05);
  const clipped = layoutLabel({ version: 2, media: { widthMm: 50, heightMm: 25, orientation: 'portrait' }, elements: [{ ...el, overflow: 'clip', align: 'right', valign: 'bottom', w: 20, h: 4 }] }, {}, measurer).elements[0];
  assert.equal(clipped.layout.clip, true);
  assert.equal(clipped.layout.overflowing, true);
});

test('barcode modules are whole printer dots and barcode width follows the value', () => {
  assert.equal(Math.round(quantizeToDots(0.3, 203) * 1000) / 1000, 0.25);
  assert.equal(Math.round(quantizeToDots(0.375, 203) * 1000) / 1000, 0.375);
  const tpl = { version: 2, media: { widthMm: 75, heightMm: 125, orientation: 'landscape' }, elements: [createElement('barcode', { id: 'b', x: 2, y: 2, moduleMm: 0.375, quietZoneMm: 2 })] };
  const short = layoutLabel(tpl, { barcode: 'RCO-1-1' }, measurer).elements[0];
  const long = layoutLabel(tpl, { barcode: 'RCO-240123-003-C012' }, measurer).elements[0];
  assert.ok(long.box.w > short.box.w);
  assert.equal(short.layout.bars[0].x, 2, 'first bar starts after the quiet zone');
  const dot = 25.4 / 203;
  for (const bar of short.layout.bars) assert.ok(Math.abs(bar.w / dot - Math.round(bar.w / dot)) < 1e-6);
  assert.equal(short.layout.error, null);
  const missing = layoutLabel(tpl, {}, measurer).elements[0];
  assert.equal(missing.layout.bars.length, 0);
  assert.match(missing.layout.error, /No barcode value/);
});

test('html rotation keeps the visual top-left and escapes text', () => {
  assert.equal(rotationTransform(90, 10, 4), 'rotate(90deg) translate(0,-4mm)');
  assert.equal(rotationTransform(270, 10, 4), 'rotate(270deg) translate(-10mm,0)');
  assert.equal(mm(1.23456), '1.235mm');
  const tpl = { version: 2, media: { widthMm: 50, heightMm: 25, orientation: 'portrait' }, elements: [createElement('text', { id: 't', text: '<b>&"x"', w: 40, h: 6 })] };
  const markup = renderLabelMarkup(layoutLabel(tpl, {}, measurer), fontFamilyCss);
  assert.ok(markup.includes('&lt;b&gt;&amp;&quot;x&quot;'));
  assert.ok(!markup.includes('<b>'));
});

test('artifact repeats a transaction across columns, copies pages, and sequences when asked', () => {
  const base = { version: 2, media: { widthMm: 50, heightMm: 25, orientation: 'portrait', rollWidthMm: 105, columns: 2, columnGapMm: 2, marginLeftMm: 1.5 }, elements: [createElement('text', { id: 't', text: '@n', w: 40, h: 6 })] };
  const repeat = buildPrintableArtifact(base, [{ n: 'one' }, { n: 'two' }], { copies: 2, dpi: 203, stageKey: 'cutter_issue_small' });
  assert.equal(repeat.version, 2);
  assert.equal(repeat.pages.length, 4);
  assert.equal(repeat.widthMm, 105);
  assert.equal(repeat.heightMm, 25);
  assert.equal((repeat.pages[0].html.match(/>one</g) || []).length, 2, 'same label in both columns');
  assert.equal(repeat.templateSnapshot.stageKey, 'cutter_issue_small');
  const sequence = buildPrintableArtifact({ ...base, media: { ...base.media, columnMode: 'sequence' } }, [{ n: 'one' }, { n: 'two' }, { n: 'three' }], { dpi: 203 });
  assert.equal(sequence.pages.length, 2);
  assert.ok(sequence.pages[0].html.includes('>one<') && sequence.pages[0].html.includes('>two<'));
  assert.ok(sequence.pages[1].html.includes('>three<'));
  assert.throws(() => buildPrintableArtifact({ ...base, media: { ...base.media, rollWidthMm: 60 } }, [{}]), /exceed the roll width/);
  assert.throws(() => buildPrintableArtifact(base, Array.from({ length: 101 }, () => ({}))), /at most 100/);
  assert.throws(() => buildPrintableArtifact(base, [{}], { dpi: 150 }), /Unsupported printer DPI/);
  const doc = artifactToDocument(repeat);
  assert.ok(doc.startsWith('<!doctype html>'));
  assert.ok(doc.includes('@page{size:105mm 25mm;margin:0}'));
  assert.ok(doc.includes("Content-Security-Policy"));
});

test('landscape pages rotate the reading canvas onto the portrait page', () => {
  const page = renderPage({ widthMm: 75, heightMm: 125, orientation: 'landscape', rollWidthMm: 75, columns: 1, columnGapMm: 2, marginLeftMm: 0, marginTopMm: 0, offsetXMm: 0, offsetYMm: 0 }, ['<i>x</i>']);
  assert.ok(page.includes('width:75mm;height:125mm'), 'page is portrait');
  assert.ok(page.includes('width:125mm;height:75mm;transform:rotate(-90deg) translate(-125mm,0)'), 'canvas is landscape and rotated');
});

test('every default stage renders without warnings for typical and long sample data', () => {
  for (const stage of Object.values(LABEL_STAGE_KEYS)) {
    assert.ok(DEFAULT_STAGE_TEMPLATES[stage], `default for ${stage}`);
    for (const variant of ['typical', 'long', 'blank']) {
      const artifact = buildPrintableArtifact(DEFAULT_STAGE_TEMPLATES[stage], [buildSampleData(stage, variant)], { stageKey: stage, dpi: 203 });
      // Blank data has no barcode value; a five-digit series on a 50 mm sticker is wider
      // than two dots per module allow, which the designer reports as a warning.
      const unexpected = artifact.warnings.filter((w) => !(variant === 'blank' && /No (barcode|QR) value/.test(w)) && !(variant === 'long' && stage.endsWith('_small') && /barcode is wider/.test(w)));
      assert.deepEqual(unexpected, [], `${stage} ${variant}: ${artifact.warnings.join(', ')}`);
      assert.ok(artifact.pages[0].html.includes('class="sym"'), 'barcode present');
    }
    const used = new Set(STAGE_VARIABLES[stage].map((v) => v.key));
    for (const el of DEFAULT_STAGE_TEMPLATES[stage].elements) {
      for (const key of listPlaceholders(el.text || el.value || '')) assert.ok(used.has(key), `${stage} uses unknown variable @${key}`);
    }
  }
  const cal = buildPrintableArtifact(CALIBRATION_TEMPLATE, [{}], { stageKey: 'calibration', dpi: 300 });
  assert.equal(cal.dpi, 300);
});

test('barcode maxWidthMm narrows the module in whole dots and font families are attribute-safe', () => {
  const tpl = { version: 2, media: { widthMm: 75, heightMm: 125, orientation: 'landscape' }, elements: [createElement('barcode', { id: 'b', x: 2, y: 2, moduleMm: 0.375, quietZoneMm: 2.5, maxWidthMm: 70 })] };
  const long = layoutLabel(tpl, { barcode: 'RCO-240123-003-C012' }, measurer).elements[0];
  assert.ok(long.box.w <= 70.001, `width ${long.box.w}`);
  assert.equal(long.layout.narrowed, true);
  assert.equal(Math.round(long.layout.moduleMm * 1000) / 1000, 0.25);
  const short = layoutLabel(tpl, { barcode: 'RCO-1' }, measurer).elements[0];
  assert.equal(short.layout.narrowed, false);
  const tight = layoutLabel({ ...tpl, elements: [{ ...tpl.elements[0], maxWidthMm: 30 }] }, { barcode: 'RCO-240123-003-C012' }, measurer).elements[0];
  assert.equal(Math.round(tight.layout.moduleMm * 1000) / 1000, 0.25, 'never below two dots');
  assert.equal(tight.layout.overflowing, true);
  assert.ok(!fontFamilyCss('inter').includes('"'));
  const markup = renderLabelMarkup(layoutLabel({ ...tpl, elements: [createElement('text', { id: 't', text: 'x', w: 10, h: 5 })] }, {}, measurer), fontFamilyCss);
  assert.match(markup, /font-family:'Inter', sans-serif/);
});

test('backend seed data equals the exported factory designs', async () => {
  const { readFileSync } = await import('node:fs');
  const seed = JSON.parse(readFileSync(new URL('../../../../backend/scripts/stickerTemplates.v2.json', import.meta.url), 'utf8'));
  assert.equal(seed.templates.length, Object.keys(DEFAULT_STAGE_TEMPLATES).length);
  for (const entry of seed.templates) {
    assert.equal(entry.stageKey, `v2:${entry.stage}`, 'version 2 rows are namespaced');
    assert.deepEqual(entry.content, normalizeTemplate(DEFAULT_STAGE_TEMPLATES[entry.stage]), `${entry.stage} seed is stale; run apps/frontend/scripts/export-label-defaults.mjs`);
    assert.equal(entry.dimensions.version, 2);
  }
});

test('production design seed holds a normalized version 2 design for every stage', () => {
  const seed = JSON.parse(readFileSync(new URL('../../../../backend/scripts/stickerTemplates.production.json', import.meta.url), 'utf8'));
  assert.equal(seed.templates.length, Object.keys(DEFAULT_STAGE_TEMPLATES).length);
  for (const entry of seed.templates) {
    assert.ok(DEFAULT_STAGE_TEMPLATES[entry.stage], `unknown stage ${entry.stage}`);
    assert.equal(entry.stageKey, `v2:${entry.stage}`);
    assert.deepEqual(entry.content, normalizeTemplate(entry.content), `${entry.stage} is not normalized`);
    assert.deepEqual(entry.dimensions, { version: 2, ...entry.content.media });
    assert.ok(entry.content.elements.some((el) => el.type === 'barcode' || el.type === 'qr'), `${entry.stage} has no code`);
  }
});

test('every previous-designer factory template converts and prints without overflow', async () => {
  const { readFileSync } = await import('node:fs');
  const { templates } = JSON.parse(readFileSync(new URL('./fixtures/legacy-v1-templates.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(templates).length, 9);
  for (const [stage, row] of Object.entries(templates)) {
    const converted = toV2Template(row);
    assert.equal(converted.version, 2);
    assert.ok(converted.elements.some((el) => el.type === 'barcode'), `${stage} keeps its barcode`);
    for (const variant of ['typical', 'long']) {
      const artifact = buildPrintableArtifact(converted, [buildSampleData(stage, variant)], { stageKey: stage, dpi: 203 });
      const overflow = artifact.warnings.filter((w) => /does not fit|Outside/.test(w));
      assert.deepEqual(overflow, [], `${stage} ${variant}: ${overflow.join('; ')}`);
    }
  }
  const small = toV2Template(templates.cutter_issue_small);
  const item = small.elements.find((el) => el.id === 't-cis-item');
  assert.ok(item.w >= 40, `small cutter item box keeps the full width (${item.w} mm)`);
});

test('letter spacing counts every glyph and barcode boxes cover their text', () => {
  const spaced = measurer.measure('ABCD', { family: 'Inter', sizePt: 10, bold: false, italic: false, letterSpacingPt: 1 });
  const plain = measurer.measure('ABCD', { family: 'Inter', sizePt: 10, bold: false, italic: false, letterSpacingPt: 0 });
  assert.ok(Math.abs((spaced - plain) - 4 * 25.4 / 72) < 1e-9);
  const tpl = { version: 2, media: { widthMm: 75, heightMm: 125, orientation: 'landscape' }, elements: [createElement('barcode', { id: 'b', x: 2, y: 2, moduleMm: 0.25, quietZoneMm: 1, textSizePt: 12, showText: true })] };
  const short = layoutLabel(tpl, { barcode: 'A1' }, measurer).elements[0];
  assert.ok(short.layout.textLine.x >= 0, 'text starts inside the element');
  assert.ok(short.box.w >= short.layout.textLine.w + 2, 'element is at least as wide as its text');
  const qr = layoutLabel({ ...tpl, elements: [createElement('qr', { id: 'q', x: 1, y: 1, sizeMm: 15 })] }, { barcode: 'RCO-1' }, measurer, { dpi: 203 }).elements[0];
  const dot = 25.4 / 203;
  assert.ok(Math.abs(qr.layout.moduleMm / dot - Math.round(qr.layout.moduleMm / dot)) < 1e-9, 'QR modules are whole dots');
});
