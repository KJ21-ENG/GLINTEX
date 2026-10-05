// Geometry/contract tests use a recording canvas, not a claim of visual or hardware validation.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "../../frontend/src/utils");
function load(file, context) {
  let source = fs.readFileSync(path.join(root, file), "utf8");
  const names = [...source.matchAll(/export const (\w+)/g)].map((m) => m[1]);
  source = source
    .replace(/import[\s\S]*?from ['"][^'"]+['"];\n/g, "")
    .replace(/import\.meta(?:\?)?\.env/g, "({})")
    .replace(/export const /g, "const ")
    .replace(/export default \{[\s\S]*?\};/g, "");
  const c = vm.createContext({
    TextEncoder,
    Uint8Array,
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    ...context,
  });
  vm.runInContext(source + "\nthis.exports = {" + names.join(",") + "}", c);
  return c.exports;
}
const canvases = [];
function canvas() {
  const c = {
    width: 1,
    height: 1,
    ops: [],
    toDataURL() {
      return (
        "data:image/png;base64," +
        Buffer.from(
          JSON.stringify({
            width: this.width,
            height: this.height,
            ops: this.ops,
          }),
        ).toString("base64")
      );
    },
  };
  c.getContext = () => ({
    save() {},
    restore() {},
    translate(...a) {
      c.ops.push(["translate", ...a]);
    },
    rotate(a) {
      c.ops.push(["rotate", a]);
    },
    fillRect(...a) {
      c.ops.push(["fillRect", ...a]);
    },
    fillText(...a) {
      c.ops.push(["text", ...a]);
    },
    drawImage(other, ...a) {
      c.ops.push(["image", other.toDataURL(), ...a]);
    },
    measureText(s) {
      return { width: s.length * 6 };
    },
    getImageData() {
      return { data: new Uint8Array(c.width * c.height * 4) };
    },
    putImageData() {},
  });
  canvases.push(c);
  return c;
}
const lp = load("labelPrint.js", {
  formatDateDDMMYYYY: (x) => String(x),
  fetch: async () => ({ ok: false, status: 503 }),
});
const bitmap = load("labelBitmap.js", {
  ...lp,
  document: {
    createElement: canvas,
    fonts: { ready: Promise.resolve(), load: async () => [] },
  },
  bwipjs: {
    toCanvas(c, o) {
      c.width = 100;
      c.height = 40;
      c.ops.push(["barcode", o.text, o.bcid]);
    },
  },
});
test("every repository stage produces canonical pages with physical dimensions", async () => {
  for (const [stage, template] of Object.entries(lp.DEFAULT_STAGE_TEMPLATES)) {
    const a = await bitmap.buildPrintableArtifact(
      template,
      [
        {
          barcode: "RCO-123-C001",
          itemName: "Representative long material value",
          date: "2026-10-05",
        },
      ],
      { stageKey: stage },
    );
    assert.equal(a.pages.length, template.content.copies || 1, stage);
    const page = JSON.parse(
      Buffer.from(a.pages[0].pngDataUrl.split(",")[1], "base64"),
    );
    assert.equal(page.width, Math.round((a.widthMm * a.dpi) / 25.4));
    assert.equal(page.height, Math.round((a.heightMm * a.dpi) / 25.4));
    assert.equal(
      page.ops.filter((o) => o[0] === "image").length,
      template.dimensions.columns,
    );
  }
});
test("small format retains explicit origin without preview-only 1.5 mm centering", async () => {
  const t = lp.DEFAULT_STAGE_TEMPLATES.cutter_issue_small;
  const a = await bitmap.buildPrintableArtifact(t, [{}]);
  const p = JSON.parse(
    Buffer.from(a.pages[0].pngDataUrl.split(",")[1], "base64"),
  );
  const draws = p.ops.filter((o) => o[0] === "image");
  assert.equal(draws[0][2], 0);
  assert.equal(draws[1][2], Math.round((52 * 203) / 25.4));
  assert.equal(draws[0][1], draws[1][1]);
});
test("copies and columns are independent: pages repeat, columns share identical artwork", async () => {
  const t = lp.DEFAULT_STAGE_TEMPLATES.cutter_issue_small;
  const a = await bitmap.buildPrintableArtifact(
    t,
    [{ itemName: "A" }, { itemName: "B" }],
    { copies: 3 },
  );
  assert.equal(a.pages.length, 6);
  assert.equal(a.pages[0].pngDataUrl, a.pages[2].pngDataUrl);
  assert.notEqual(a.pages[0].pngDataUrl, a.pages[3].pngDataUrl);
});
test("off-roll geometry and excess copies fail explicitly", async () => {
  const t = lp.DEFAULT_STAGE_TEMPLATES.cutter_issue_small;
  await assert.rejects(
    bitmap.buildPrintableArtifact(
      { ...t, dimensions: { ...t.dimensions, pageWidth: 90 } },
      [{}],
    ),
    /roll width/,
  );
  await assert.rejects(
    bitmap.buildPrintableArtifact(t, [{}], { copies: 101 }),
    /100/,
  );
});
test("failed template request never substitutes a default", async () => {
  await assert.rejects(lp.loadTemplate("inbound"), /503/);
});
test("rotation and barcode content remain in rendered contract", () => {
  const result = bitmap.renderLabelToCanvas(
    {
      dimensions: { width: 75, height: 125 },
      content: {
        texts: [
          {
            id: "a",
            type: "text",
            pos: { x: 10, y: 10 },
            angle: 270,
            value: "Long text",
            style: { fontFamily: "inter", bold: true, size: 12 },
          },
          {
            id: "b",
            type: "barcode",
            pos: { x: 30, y: 50 },
            angle: 90,
            value: "{{barcode}}",
            style: { heightMm: 10, moduleMm: 0.25 },
          },
        ],
      },
    },
    { barcode: "ICU-000123-001" },
    { pixelsPerMm: 203 / 25.4 },
  );
  assert.ok(
    result.canvas.ops.some(
      (o) => o[0] === "rotate" && o[1] === (270 * Math.PI) / 180,
    ),
  );
  assert.ok(result.fields.some((f) => f._computedValue === "ICU-000123-001"));
});
test("all stage preview rasters equal artifact label rasters, with no guides or extra transforms", async () => {
  for (const [stage, t] of Object.entries(lp.DEFAULT_STAGE_TEMPLATES)) {
    const data = {
      barcode: "RCO-123-C001",
      itemName: "Long representative material value",
      operatorName: "Operator",
    };
    const options = {
      stageKey: stage,
      pixelsPerMm: 203 / 25.4,
      preserveColor: false,
      printerMode: true,
    };
    const preview = bitmap
      .renderLabelToCanvas(t, data, options)
      .canvas.toDataURL("image/png");
    const a = await bitmap.buildPrintableArtifact(t, [data], {
      stageKey: stage,
      copies: 1,
    });
    const p = JSON.parse(
      Buffer.from(a.pages[0].pngDataUrl.split(",")[1], "base64"),
    );
    for (const draw of p.ops.filter((o) => o[0] === "image"))
      assert.equal(draw[1], preview, stage);
  }
});
test("backend seed templates also use identical canonical preview/output geometry without touching database", async () => {
  const source = fs
    .readFileSync(
      path.resolve(root, "../../../backend/scripts/seedStickerTemplates.mjs"),
      "utf8",
    )
    .replace(/^import[^\n]+\n/, "")
    .split("async function seed()")[0];
  const c = vm.createContext({});
  vm.runInContext(source + "\nthis.data=templates", c);
  assert.equal(c.data.length, 8);
  for (const t of c.data) {
    const data = {
      barcode: "ICU-123-001",
      itemName: "Material",
      netWeight: "12.345",
    };
    const a = await bitmap.buildPrintableArtifact(t, [data], {
      stageKey: t.stageKey,
      copies: 1,
    });
    const page = JSON.parse(
      Buffer.from(a.pages[0].pngDataUrl.split(",")[1], "base64"),
    );
    const preview = bitmap
      .renderLabelToCanvas(t, data, {
        stageKey: t.stageKey,
        pixelsPerMm: 203 / 25.4,
        preserveColor: false,
        printerMode: true,
      })
      .canvas.toDataURL("image/png");
    assert.equal(page.ops.find((o) => o[0] === "image")[1], preview);
  }
});
test("line geometry rotates in local coordinates at every right angle", () => {
  for (const angle of [0, 90, 180, 270]) {
    const r = bitmap.renderLabelToCanvas(
      {
        dimensions: { width: 50, height: 50 },
        content: {
          texts: [
            {
              id: "line",
              type: "line",
              pos: { x: 25, y: 25 },
              angle,
              style: { lengthMm: 10, thicknessMm: 0.5 },
            },
          ],
        },
      },
      {},
      { pixelsPerMm: 203 / 25.4 },
    );
    assert.ok(
      r.canvas.ops.some(
        (o) => o[0] === "rotate" && o[1] === (angle * Math.PI) / 180,
      ),
    );
    assert.ok(
      r.canvas.ops.some(
        (o) =>
          o[0] === "fillRect" &&
          o[1] === 0 &&
          o[2] === 0 &&
          o[3] === Math.round((10 * 203) / 25.4) &&
          o[4] === Math.round((0.5 * 203) / 25.4),
      ),
    );
    assert.equal(r.fields[0].renderMetrics.widthMm, 10);
    assert.equal(r.fields[0].renderMetrics.heightMm, 0.5);
  }
});
test("renderer rejects high-DPI batch memory before allocating page canvases", async () => {
  const t = lp.DEFAULT_STAGE_TEMPLATES.inbound;
  const before = canvases.length;
  await assert.rejects(
    bitmap.buildPrintableArtifact(t, [{}], { dpi: 600, copies: 100 }),
    /decoded pixel budget/,
  );
  assert.equal(canvases.length, before);
});
