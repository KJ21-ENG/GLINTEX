"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { crc32 } = require("node:zlib");
const TERMINAL = new Set(["submitted", "failed", "outcome uncertain"]);
const MAX_BYTES = 20 * 1024 * 1024;
const clone = (value) => JSON.parse(JSON.stringify(value));
function validateProfile(profile) {
  if (
    !profile ||
    typeof profile.printerName !== "string" ||
    !profile.printerName.trim() ||
    profile.printerName.length > 256
  )
    throw new Error("Select an explicit Windows printer");
  if (![203, 300, 600].includes(profile.dpi))
    throw new Error("Supported printer resolutions: 203, 300, 600 dpi");
  return {
    printerName: profile.printerName,
    dpi: profile.dpi,
    mode: "windows-driver",
  };
}
const SUPPORTED_DPI = [203, 300, 600];
const HTML_PAGE_MAX = 2 * 1024 * 1024;
const CSS_MAX = 256 * 1024;
const FONT_MAX = 512 * 1024;
// Active content, external references and anything that is not inline markup.
const FORBIDDEN_MARKUP = [
  /<\s*\/?\s*(script|iframe|frame|frameset|object|embed|link|meta|base|form|input|button|textarea|select|video|audio|source|template|slot|math|svg\s+[^>]*\bhref|use|foreignObject|noscript|style)\b/i,
  /\bon[a-z]+\s*=/i,
  /javascript:/i,
  /vbscript:/i,
  /expression\s*\(/i,
  /@import/i,
  /url\(\s*(?!['"]?data:image\/(png|jpeg|svg\+xml);base64,)[^)]*\)/i,
  /\b(src|href|xlink:href)\s*=\s*(?!"data:image\/(png|jpeg|svg\+xml);base64,[A-Za-z0-9+/=]+")/i,
  /<\?/,
  /<!(?!doctype)/i,
];
const FORBIDDEN_CSS = [/@import/i, /url\(\s*(?!['"]?data:font\/woff2;base64,)/i, /expression\s*\(/i, /javascript:/i, /<\//i];

function validateHtmlArtifact(a) {
  if (!SUPPORTED_DPI.includes(a.dpi)) throw new Error("Unsupported label artifact");
  for (const key of ["widthMm", "heightMm"])
    if (!Number.isFinite(a[key]) || a[key] < 1 || a[key] > 500)
      throw new Error("Invalid physical label size");
  if (!Array.isArray(a.pages) || !a.pages.length || a.pages.length > 100)
    throw new Error("Label jobs require 1–100 pages");
  if (Buffer.byteLength(JSON.stringify(a)) > MAX_BYTES)
    throw new Error("Label job exceeds 20 MB; split the batch");
  if (typeof a.css !== "string" || a.css.length > CSS_MAX)
    throw new Error("Invalid label stylesheet");
  for (const pattern of FORBIDDEN_CSS)
    if (pattern.test(a.css)) throw new Error("Label stylesheet contains unsupported content");
  if (!Array.isArray(a.fonts) || a.fonts.length > 12)
    throw new Error("Invalid label fonts");
  for (const f of a.fonts) {
    if (
      !f ||
      typeof f.family !== "string" ||
      !/^[A-Za-z0-9 ]{1,64}$/.test(f.family) ||
      ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(f.weight) ||
      !["normal", "italic"].includes(f.style || "normal") ||
      typeof f.dataUrl !== "string" ||
      f.dataUrl.length > FONT_MAX ||
      !/^data:font\/woff2;base64,[A-Za-z0-9+/]+=*$/.test(f.dataUrl)
    )
      throw new Error("Invalid embedded label font");
  }
  for (const p of a.pages) {
    if (!p || typeof p.html !== "string" || !p.html.length || p.html.length > HTML_PAGE_MAX)
      throw new Error("Only inline HTML label pages are accepted");
    for (const pattern of FORBIDDEN_MARKUP)
      if (pattern.test(p.html)) throw new Error("Label page contains unsupported content");
  }
  const stage = a.templateSnapshot?.stageKey;
  if (stage !== undefined && (typeof stage !== "string" || !/^[a-z0-9_]{1,40}$/.test(stage)))
    throw new Error("Invalid label stage");
}

function validateArtifact(a) {
  if (!a || typeof a !== "object") throw new Error("Unsupported label artifact");
  if (a.version === 2) {
    validateHtmlArtifact(a);
    return clone(a);
  }
  if (a.version !== 1 || !SUPPORTED_DPI.includes(a.dpi))
    throw new Error("Unsupported label artifact");
  for (const key of ["widthMm", "heightMm"])
    if (!Number.isFinite(a[key]) || a[key] < 1 || a[key] > 500)
      throw new Error("Invalid physical label size");
  if (!Array.isArray(a.pages) || !a.pages.length || a.pages.length > 100)
    throw new Error("Label jobs require 1–100 pages");
  if (Buffer.byteLength(JSON.stringify(a)) > MAX_BYTES)
    throw new Error("Label job exceeds 20 MB; split the batch");
  if (
    Math.round((a.widthMm * a.dpi) / 25.4) *
      Math.round((a.heightMm * a.dpi) / 25.4) >
    24000000
  )
    throw new Error("Label raster exceeds safe pixel limit");
  if (
    Math.round((a.widthMm * a.dpi) / 25.4) *
      Math.round((a.heightMm * a.dpi) / 25.4) *
      a.pages.length >
    48000000
  )
    throw new Error(
      "Label batch exceeds decoded pixel budget; split the batch",
    );
  for (const p of a.pages) {
    if (
      !p ||
      typeof p.pngDataUrl !== "string" ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(p.pngDataUrl)
    )
      throw new Error("Only embedded PNG label pages are accepted");
    const b = Buffer.from(p.pngDataUrl.split(",")[1], "base64");
    if (
      b.length < 33 ||
      b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      b.readUInt32BE(8) !== 13 ||
      b.subarray(12, 16).toString() !== "IHDR" ||
      crc32(b.subarray(12, 29)) !== b.readUInt32BE(29)
    )
      throw new Error("Invalid PNG artwork");
    if (
      b.readUInt32BE(16) !== Math.round((a.widthMm * a.dpi) / 25.4) ||
      b.readUInt32BE(20) !== Math.round((a.heightMm * a.dpi) / 25.4)
    )
      throw new Error("Artwork pixels do not match physical size and DPI");
  }
  return clone(a);
}

const mm = (v) => `${Math.round(Number(v) * 1000) / 1000}mm`;
// The complete document the hidden print window loads; identical for preview and paper.
function buildDocument(a) {
  if (a.version === 2) {
    const fonts = a.fonts
      .map(
        (f) =>
          `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:${f.style || "normal"};src:url(${f.dataUrl}) format("woff2")}`,
      )
      .join("\n");
    return `<!doctype html><html><head><meta charset="utf-8"><title>GLINTEX label</title><style>@page{size:${mm(a.widthMm)} ${mm(a.heightMm)};margin:0}html,body{margin:0;padding:0;background:#fff}.pg{break-after:page;page-break-after:always}.pg:last-child{break-after:auto;page-break-after:auto}\n${fonts}\n${a.css}</style></head><body>${a.pages.map((p) => p.html).join("")}</body></html>`;
  }
  return `<!doctype html><meta charset="utf-8"><style>@page{size:${a.widthMm}mm ${a.heightMm}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}img{display:block;width:${a.widthMm}mm;height:${a.heightMm}mm;break-after:page;image-rendering:pixelated}img:last-child{break-after:auto}</style>${a.pages.map((p) => `<img src="${p.pngDataUrl}">`).join("")}`;
}
class PrintController {
  constructor({
    directory,
    getPrinters,
    printArtifact,
    settings,
    maxJobs = 100,
    maxRetainedBytes = 100 * 1024 * 1024,
  }) {
    this.directory = directory;
    this.getPrinters = getPrinters;
    this.printArtifact = printArtifact;
    this.settings = settings;
    this.maxJobs = maxJobs;
    this.maxRetainedBytes = maxRetainedBytes;
    this.jobs = new Map();
    this.unreadableRecords = 0;
    this.unreadableBytes = 0;
    this.chain = Promise.resolve();
    this.admission = Promise.resolve();
    this.ready = this.restore();
  }
  async restore() {
    await fs.mkdir(this.directory, { recursive: true });
    for (const name of (await fs.readdir(this.directory)).sort()) {
      if (/^[a-f0-9-]{36}\.json\.tmp$/.test(name)) {
        const orphan = await fs
          .stat(path.join(this.directory, name))
          .catch(() => null);
        if (orphan) {
          this.unreadableRecords++;
          this.unreadableBytes += orphan.size;
        }
        continue;
      }
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const file = path.join(this.directory, name);
        if ((await fs.stat(file)).size > MAX_BYTES + 65536)
          throw new Error("Oversized retained record");
        const job = JSON.parse(await fs.readFile(file, "utf8"));
        if (job.id + ".json" !== name)
          throw new Error("Invalid retained job identity");
        validateArtifact(job.artifact);
        validateProfile(job.profile);
        if (job.state === "submitting") {
          job.state = "outcome uncertain";
          job.error =
            "Application stopped during printer submission. Check labels before reprinting.";
        } else if (!TERMINAL.has(job.state)) {
          job.state = "failed";
          job.error =
            "Application stopped before submission. Use Reprint to submit deliberately.";
        }
        this.jobs.set(job.id, job);
        await this.persist(job);
      } catch {
        this.unreadableRecords++;
        this.unreadableBytes += (
          await fs
            .stat(path.join(this.directory, name))
            .catch(() => ({ size: 0 }))
        ).size; /* Never execute or delete unreadable jobs: physical outcome is unknown. */
      }
    }
    await this.prune();
  }
  async persist(job) {
    const file = path.join(this.directory, `${job.id}.json`);
    const tmp = file + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(job), { mode: 0o600 });
    const handle = await fs.open(tmp, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  }
  summary(job) {
    const { artifact, ...rest } = job;
    return clone({
      ...rest,
      stageKey: artifact.templateSnapshot?.stageKey || "calibration",
    });
  }
  async enumerate() {
    return this.getPrinters();
  }
  async configure(profile) {
    const valid = validateProfile(profile);
    const printers = await this.enumerate();
    if (!printers.some((p) => (p.name || p) === valid.printerName))
      throw new Error("Selected printer is unavailable");
    await this.settings.set("printer", valid);
    return valid;
  }
  async status() {
    await this.ready;
    const profile = await this.settings.get("printer");
    const printers = await this.enumerate();
    const selectedPrinter =
      profile && printers.find((p) => (p.name || p) === profile.printerName);
    return {
      driverStatus:
        selectedPrinter && typeof selectedPrinter === "object"
          ? (selectedPrinter.status ?? null)
          : null,
      statusMeaning:
        "Windows driver status; installed does not prove paper is ready or printed",
      error: this.unreadableRecords
        ? `${this.unreadableRecords} retained job record(s) could not be read. Inspect labels before any reprint; preserve queue files for support.`
        : null,
      profile: profile || null,
      available:
        !!profile &&
        printers.some((p) => (p.name || p) === profile.printerName),
      pending: [...this.jobs.values()].filter((j) => !TERMINAL.has(j.state))
        .length,
    };
  }
  async getJob(id) {
    await this.ready;
    const job = this.jobs.get(id);
    if (!job)
      throw new Error("Print job not found or retention period exceeded");
    return this.summary(job);
  }
  async listJobs() {
    await this.ready;
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((j) => this.summary(j));
  }
  jobBytes(job) {
    return Buffer.byteLength(JSON.stringify(job)) + 4096;
  } // Reserve bounded final state/error metadata.
  async submit(input = {}) {
    await this.ready;
    const admitted = this.admission.then(() => this.admit(input));
    this.admission = admitted.then(
      () => {},
      () => {},
    );
    const job = await admitted;
    const run = this.chain.then(() => this.execute(job));
    this.chain = run.catch(() => {});
    return run;
  }
  async admit({ artifact, profile, reprintOf, ownerUserId } = {}) {
    const valid = validateArtifact(artifact);
    const selected = validateProfile(
      profile || (await this.settings.get("printer")),
    );
    if (valid.dpi !== selected.dpi)
      throw new Error("Label DPI does not match selected printer profile");
    const job = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      state: "queued",
      artifact: valid,
      profile: selected,
      ownerUserId:
        typeof ownerUserId === "string" ? ownerUserId.slice(0, 100) : null,
      artifactSha256: createHash("sha256")
        .update(JSON.stringify(valid))
        .digest("hex"),
      ...(reprintOf ? { reprintOf } : {}),
    };
    const reserveBytes = this.jobBytes(job);
    await this.prune(reserveBytes);
    const retainedBytes =
      this.unreadableBytes +
      [...this.jobs.values()].reduce((n, j) => n + this.jobBytes(j), 0);
    if (this.jobs.size + this.unreadableRecords >= this.maxJobs)
      throw new Error(
        "Print queue capacity reached; finish active jobs or inspect uncertain records",
      );
    if (retainedBytes + reserveBytes > this.maxRetainedBytes)
      throw new Error(
        "Retained print data limit reached. Resolve uncertain jobs or archive queue records before printing more.",
      );
    await this.persist(job);
    this.jobs.set(job.id, job);
    return job;
  }
  async execute(job) {
    try {
      job.state = "preparing";
      await this.persist(job);
      if (
        !(await this.enumerate()).some(
          (p) => (p.name || p) === job.profile.printerName,
        )
      )
        throw new Error(
          "Selected printer is unavailable; no alternate printer was used",
        );
      job.state = "submitting";
      await this.persist(job);
      const result = await this.printArtifact(job.artifact, job.profile);
      if (!result?.success) {
        job.state = result?.uncertain ? "outcome uncertain" : "failed";
        job.error = String(
          result?.error || "Windows rejected the print job",
        ).slice(0, 512);
      } else {
        job.state = "submitted";
        job.message =
          "Submitted to Windows. Physical printing is not confirmed.";
      }
    } catch (error) {
      job.state = job.state === "submitting" ? "outcome uncertain" : "failed";
      job.error = String(error.message || "Print failure").slice(0, 512);
    }
    job.updatedAt = new Date().toISOString();
    await this.persist(job);
    const cleanup = this.admission.then(() => this.prune());
    this.admission = cleanup.catch(() => {});
    await cleanup;
    return {
      success: job.state === "submitted",
      job: this.summary(job),
      error: job.error,
    };
  }
  async reprint(id, { ownerUserId } = {}) {
    await this.ready;
    const job = this.jobs.get(typeof id === "object" ? id.id : id);
    if (!job) throw new Error("Print job unavailable");
    if (!TERMINAL.has(job.state))
      throw new Error("Wait for the current submission before reprinting");
    return this.submit({
      artifact: job.artifact,
      profile: job.profile,
      reprintOf: job.id,
      ownerUserId: ownerUserId || job.ownerUserId,
    });
  }
  async prune(reserveBytes = 0) {
    let bytes =
      this.unreadableBytes +
      [...this.jobs.values()].reduce((n, j) => n + this.jobBytes(j), 0);
    for (const job of [...this.jobs.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )) {
      if (
        this.jobs.size + this.unreadableRecords <=
          this.maxJobs - (reserveBytes ? 1 : 0) &&
        bytes + reserveBytes <= this.maxRetainedBytes
      )
        break;
      if (!TERMINAL.has(job.state) || job.state === "outcome uncertain")
        continue;
      await fs.unlink(path.join(this.directory, `${job.id}.json`));
      this.jobs.delete(job.id);
      bytes -= this.jobBytes(job);
    }
  }
}
module.exports = { PrintController, validateArtifact, validateProfile, buildDocument };
