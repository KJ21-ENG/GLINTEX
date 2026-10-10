// Version 2 label artifacts: geometry contract, validation on the main-process side and
// the document the hidden print window receives. No visual or hardware claims here;
// the real-Chromium gate is scripts/print-integration.cjs.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { validateArtifact, buildDocument } = require("../src/printing/controller.cjs");
const labelDir = path.resolve(__dirname, "../../frontend/src/utils/label");
const load = (name) => import(pathToFileURL(path.join(labelDir, name)).href);

const fontDataUrl = "data:font/woff2;base64," + Buffer.from("not a real font but a valid data url").toString("base64");
const fonts = [{ family: "Inter", weight: 700, style: "normal", dataUrl: fontDataUrl }];

test("every repository stage produces a version 2 artifact with physical page geometry", async () => {
  const { DEFAULT_STAGE_TEMPLATES } = await load("defaults.js");
  const { buildPrintableArtifact } = await load("artifact.js");
  const { buildSampleData } = await load("sampleData.js");
  for (const [stage, template] of Object.entries(DEFAULT_STAGE_TEMPLATES)) {
    const artifact = buildPrintableArtifact(template, [buildSampleData(stage, "typical")], { stageKey: stage, dpi: 203, fonts });
    assert.equal(artifact.version, 2);
    assert.equal(artifact.widthMm, template.media.rollWidthMm);
    assert.equal(artifact.heightMm, template.media.heightMm + template.media.marginTopMm);
    assert.equal(artifact.templateSnapshot.stageKey, stage);
    const accepted = validateArtifact(artifact);
    assert.equal(accepted.pages.length, template.copies || 1, "one page per copy");
    const document = buildDocument(accepted);
    assert.ok(document.includes(`@page{size:${artifact.widthMm}mm ${artifact.heightMm}mm;margin:0}`));
    assert.ok(document.includes('@font-face{font-family:"Inter"'));
    assert.ok(document.includes('class="sym"'), `${stage} barcode missing`);
    assert.ok(!document.includes("<script"));
  }
});

test("copies repeat pages and columns repeat the transaction; sequence mode fills columns", async () => {
  const { buildPrintableArtifact } = await load("artifact.js");
  const { createElement } = await load("model.js");
  const base = { version: 2, media: { widthMm: 50, heightMm: 25, orientation: "portrait", rollWidthMm: 105, columns: 2, columnGapMm: 2, marginLeftMm: 1.5 }, elements: [createElement("text", { id: "t", text: "@n", w: 40, h: 6 })] };
  const repeat = validateArtifact(buildPrintableArtifact(base, [{ n: "one" }, { n: "two" }], { copies: 3, dpi: 300 }));
  assert.equal(repeat.pages.length, 6);
  assert.equal((repeat.pages[0].html.match(/>one</g) || []).length, 2);
  const sequence = validateArtifact(buildPrintableArtifact({ ...base, media: { ...base.media, columnMode: "sequence" } }, [{ n: "one" }, { n: "two" }, { n: "three" }], { dpi: 203 }));
  assert.equal(sequence.pages.length, 2);
  assert.throws(() => buildPrintableArtifact(base, Array.from({ length: 101 }, () => ({}))), /at most 100/);
});

test("main process rejects active content, external references and oversized pages", async () => {
  const { buildPrintableArtifact } = await load("artifact.js");
  const { createElement } = await load("model.js");
  const good = buildPrintableArtifact({ version: 2, media: { widthMm: 50, heightMm: 25, orientation: "portrait" }, elements: [createElement("text", { id: "t", text: "ok", w: 40, h: 6 })] }, [{}], { dpi: 203, fonts });
  validateArtifact(good);
  const withPage = (html) => ({ ...good, pages: [{ html }] });
  for (const bad of [
    '<div class="pg"><script>alert(1)</script></div>',
    '<div class="pg" onload="x()"></div>',
    '<div class="pg"><img src="http://evil.invalid/a.png"></div>',
    '<div class="pg"><iframe src="about:blank"></iframe></div>',
    '<div class="pg" style="background:url(http://evil.invalid/x)"></div>',
    '<div class="pg"><a href="javascript:alert(1)">x</a></div>',
    '<div class="pg"><link rel="stylesheet" href="x.css"></div>',
    '<div class="pg"><svg><use href="#x"/></svg></div>',
    "x".repeat(2 * 1024 * 1024 + 1),
  ]) assert.throws(() => validateArtifact(withPage(bad)), /unsupported content|inline HTML/i, bad.slice(0, 40));
  assert.throws(() => validateArtifact({ ...good, css: "@import url(http://evil.invalid/x.css)" }), /stylesheet/);
  assert.throws(() => validateArtifact({ ...good, fonts: [{ family: "Inter", weight: 700, dataUrl: "http://evil.invalid/f.woff2" }] }), /font/);
  assert.throws(() => validateArtifact({ ...good, fonts: [{ family: "Inter", weight: 700, dataUrl: "data:font/woff2;base64," + "A".repeat(600 * 1024) }] }), /font/);
  assert.throws(() => validateArtifact({ ...good, dpi: 150 }), /Unsupported/);
  assert.throws(() => validateArtifact({ ...good, widthMm: 900 }), /physical label size/);
  assert.throws(() => validateArtifact({ ...good, pages: [] }), /1–100 pages/);
  assert.throws(() => validateArtifact({ ...good, templateSnapshot: { stageKey: "../x" } }), /stage/);
  // inline data images remain allowed
  validateArtifact(withPage('<div class="pg"><img class="im" src="data:image/png;base64,iVBORw0KGgo="></div>'));
});

test("legacy version 1 PNG artifacts stay accepted for retained-job reprints", () => {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12); b.writeUInt32BE(400, 16); b.writeUInt32BE(200, 20); b[24] = 8; b[25] = 6;
  b.writeUInt32BE(require("node:zlib").crc32(b.subarray(12, 29)), 29);
  const v1 = { version: 1, widthMm: (400 * 25.4) / 203, heightMm: (200 * 25.4) / 203, dpi: 203, pages: [{ pngDataUrl: "data:image/png;base64," + b.toString("base64") }] };
  const accepted = validateArtifact(v1);
  assert.ok(buildDocument(accepted).includes("<img src=\"data:image/png;base64,"));
});

test("converted legacy designs keep their reading orientation on the page", async () => {
  const { migrateV1Template } = await load("migrate.js");
  const { buildPrintableArtifact } = await load("artifact.js");
  const legacy = migrateV1Template({ dimensions: { width: 75, height: 125, orientation: "landscape", pageWidth: 75, columns: 1 }, content: { copies: 1, texts: [{ id: "t", type: "text", angle: 270, pos: { x: 0, y: 123 }, value: "TITLE", style: { size: 20, bold: true } }] } });
  const artifact = buildPrintableArtifact(legacy, [{}], { dpi: 203 });
  assert.equal(artifact.widthMm, 75);
  assert.equal(artifact.heightMm, 125);
  assert.ok(artifact.pages[0].html.includes("rotate(-90deg)"));
  assert.ok(artifact.pages[0].html.includes(">TITLE<"));
});
