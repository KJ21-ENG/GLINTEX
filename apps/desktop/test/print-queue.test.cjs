const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  PrintController,
  validateArtifact,
} = require("../src/printing/controller.cjs");
const { printSize, pdfSize } = require("../src/printing/electron-printer.cjs");
const profile = { printerName: "TSC TE244", dpi: 203 };
function artifact() {
  const b = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(b);
  b.writeUInt32BE(Math.round((50 * 203) / 25.4), 16);
  b.writeUInt32BE(Math.round((25 * 203) / 25.4), 20);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b[24] = 8;
  b[25] = 6;
  b.writeUInt32BE(require("node:zlib").crc32(b.subarray(12, 29)), 29);
  return {
    version: 1,
    widthMm: 50,
    heightMm: 25,
    dpi: 203,
    pages: [{ pngDataUrl: "data:image/png;base64," + b.toString("base64") }],
    templateSnapshot: { name: "test" },
  };
}
async function create(t, extra = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "glintex-print-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let selected = profile;
  const settings = {
    get: () => selected,
    set: (_k, v) => {
      selected = v;
    },
  };
  const options = {
    directory,
    settings,
    getPrinters: async () => [{ name: profile.printerName }],
    printArtifact: async () => ({ success: true }),
    ...extra,
  };
  const controller = new PrintController(options);
  await controller.ready;
  return { controller, options };
}
test("physical print and PDF units are deliberately different", () => {
  assert.deepEqual(printSize(artifact()), { width: 50000, height: 25000 });
  assert.equal(pdfSize(artifact()).width, 50 / 25.4);
});
test("PNG dimensions and embedded-only format are validated", () => {
  assert.equal(validateArtifact(artifact()).dpi, 203);
  assert.throws(
    () => validateArtifact({ ...artifact(), widthMm: 40 }),
    /pixels/,
  );
  assert.throws(
    () =>
      validateArtifact({
        ...artifact(),
        pages: [{ pngDataUrl: "https://example.com/x.png" }],
      }),
    /embedded PNG/,
  );
});
test("durable submission snapshots artifact and explicit reprint preserves it", async (t) => {
  const { controller, options } = await create(t);
  const a = artifact();
  const result = await controller.submit({ artifact: a });
  assert.equal(result.job.state, "submitted");
  a.templateSnapshot.name = "changed";
  const second = await controller.reprint(result.job.id);
  assert.equal(second.job.reprintOf, result.job.id);
  assert.equal(second.job.artifactSha256, result.job.artifactSha256);
  const restored = new PrintController(options);
  await restored.ready;
  assert.equal((await restored.listJobs()).length, 2);
});
test("unavailable explicit printer fails without fallback", async (t) => {
  let calls = 0;
  const { controller } = await create(t, {
    getPrinters: async () => [{ name: "Other" }],
    printArtifact: async () => {
      calls++;
      return { success: true };
    },
  });
  const r = await controller.submit({ artifact: artifact() });
  assert.equal(r.job.state, "failed");
  assert.equal(calls, 0);
});
test("timeout or crash during submission is uncertain and never automatically retried", async (t) => {
  let calls = 0;
  const { controller, options } = await create(t, {
    printArtifact: async () => {
      calls++;
      throw new Error("timeout");
    },
  });
  const r = await controller.submit({ artifact: artifact() });
  assert.equal(r.job.state, "outcome uncertain");
  const restored = new PrintController(options);
  await restored.ready;
  assert.equal(calls, 1);
  assert.equal((await restored.getJob(r.job.id)).state, "outcome uncertain");
});
test("crash-state submitting recovery preserves job without submission", async (t) => {
  const { controller, options } = await create(t);
  const r = await controller.submit({ artifact: artifact() });
  const file = path.join(options.directory, r.job.id + ".json");
  const j = JSON.parse(await fs.readFile(file));
  j.state = "submitting";
  await fs.writeFile(file, JSON.stringify(j));
  const restored = new PrintController({
    ...options,
    printArtifact: () => assert.fail("must not retry"),
  });
  await restored.ready;
  assert.equal((await restored.getJob(j.id)).state, "outcome uncertain");
});
test("known driver refusal reaches caller and jobs serialize", async (t) => {
  let active = 0;
  const { controller } = await create(t, {
    printArtifact: async () => {
      assert.equal(active++, 0);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { success: false, error: "Invalid printer settings" };
    },
  });
  const jobs = await Promise.all([
    controller.submit({ artifact: artifact() }),
    controller.submit({ artifact: artifact() }),
  ]);
  assert.ok(jobs.every((j) => !j.success && j.job.state === "failed"));
});
test("retention and input bounds reject oversized jobs", async (t) => {
  const { controller } = await create(t, { maxRetainedBytes: 10 });
  await assert.rejects(controller.submit({ artifact: artifact() }), /limit/);
  assert.throws(
    () =>
      validateArtifact({
        ...artifact(),
        pages: Array(101).fill(artifact().pages[0]),
      }),
    /1–100/,
  );
});
test("concurrent admissions cannot exceed one active job or create extra persisted records", async (t) => {
  let release;
  let entered;
  const started = new Promise((r) => (entered = r));
  const blocked = new Promise((r) => (release = r));
  const { controller, options } = await create(t, {
    maxJobs: 1,
    printArtifact: async () => {
      entered();
      await blocked;
      return { success: true };
    },
  });
  const first = controller.submit({ artifact: artifact() });
  const others = [
    controller.submit({ artifact: artifact() }).catch((e) => e),
    controller.submit({ artifact: artifact() }).catch((e) => e),
  ];
  await started;
  const refused = await Promise.all(others);
  assert.ok(refused.every((e) => /capacity/.test(e.message)));
  assert.equal((await controller.listJobs()).length, 1);
  assert.equal(
    (await fs.readdir(options.directory)).filter((n) => n.endsWith(".json"))
      .length,
    1,
  );
  release();
  assert.equal((await first).success, true);
});
test("uncertain job occupies quota and cannot be silently pruned for new admission", async (t) => {
  const { controller } = await create(t, {
    maxJobs: 1,
    printArtifact: async () => ({
      success: false,
      uncertain: true,
      error: "timeout",
    }),
  });
  const old = await controller.submit({ artifact: artifact() });
  await assert.rejects(controller.submit({ artifact: artifact() }), /capacity/);
  assert.equal(
    (await controller.getJob(old.job.id)).state,
    "outcome uncertain",
  );
});
test("main process rejects forged renderer raster dimensions above 24 million pixels", () => {
  assert.throws(
    () =>
      validateArtifact({
        ...artifact(),
        widthMm: 500,
        heightMm: 500,
        dpi: 600,
      }),
    /pixel limit/,
  );
});
test("PNG header corruption is rejected before decode/spool submission", () => {
  const a = artifact();
  const b = Buffer.from(a.pages[0].pngDataUrl.split(",")[1], "base64");
  b[16] ^= 1;
  a.pages[0].pngDataUrl = "data:image/png;base64," + b.toString("base64");
  assert.throws(() => validateArtifact(a), /Invalid PNG/);
});
test("many individually small compressed pages cannot exceed decoded memory budget", () => {
  const a = { ...artifact(), widthMm: 100, heightMm: 100, dpi: 203 };
  a.pages = Array(100).fill(artifact().pages[0]);
  assert.throws(() => validateArtifact(a), /decoded pixel budget/);
});

test("authenticated creator metadata persists separately from label artwork", async (t) => {
  const { controller, options } = await create(t);
  const r = await controller.submit({
    artifact: artifact(),
    ownerUserId: "operator-1",
  });
  assert.equal(r.job.ownerUserId, "operator-1");
  const restored = new PrintController(options);
  await restored.ready;
  assert.equal((await restored.getJob(r.job.id)).ownerUserId, "operator-1");
  const reprint = await restored.reprint(r.job.id, { ownerUserId: "admin" });
  assert.equal(reprint.job.ownerUserId, "admin");
  assert.equal(reprint.job.artifactSha256, r.job.artifactSha256);
});
