// Opt-in local read-only profile. Refuses any other DB/host before connecting.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
const { PrismaClient, Prisma } = await import(
  process.env.P3_PRISMA_CLIENT || "@prisma/client"
);
import { Writable } from "node:stream";
import { buildWorkerMonthlyReport } from "../../service.js";
import { sendReportDownload } from "../../exportDownload.js";
const env = dotenv.parse(
  await readFile(new URL("../../../../../.env", import.meta.url)),
);
const url = new URL(env.DATABASE_URL);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/glintex_dev" ||
  (url.port && url.port !== "5432") ||
  decodeURIComponent(url.username) !== "postgres"
)
  throw new Error("Refusing non-approved database identity");
const output = fileURLToPath(
  new URL("file:///Volumes/MacSSD/tmp/glintex-p3-profile/"),
);
await mkdir(output, { recursive: true });
const client = new PrismaClient({
  datasources: { db: { url: url.toString() } },
  log: [{ emit: "event", level: "query" }],
});
let queryCount = 0,
  queryMs = 0;
client.$on("query", (e) => {
  queryCount++;
  queryMs += e.duration;
});
let identity;
const readonly = {
  $transaction: (fn, options) =>
    client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      [identity] = await tx.$queryRawUnsafe(
        "SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('transaction_read_only') AS read_only",
      );
      console.log("Verified connection identity", identity);
      if (
        identity.database !== "glintex_dev" ||
        identity.role !== "postgres" ||
        !["127.0.0.1", "::1"].includes(identity.host) ||
        identity.port !== 5432 ||
        identity.read_only !== "on"
      )
        throw new Error("Identity or read-only mode mismatch");
      return fn(tx);
    }, options),
};
try {
  const columns = await readonly.$transaction((tx) =>
    tx.$queryRawUnsafe(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'",
    ),
  );
  const byTable = new Map();
  for (const c of columns) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Set());
    byTable.get(c.table_name).add(c.column_name);
  }
  const models = new Map(
    Prisma.dmmf.datamodel.models.map((model) => [model.name, model]),
  );
  const missing = [];
  function availableSelection(modelName, args = {}) {
    const model = models.get(modelName);
    const available = byTable.get(model.dbName || model.name);
    const select = {};
    for (const field of model.fields)
      if (field.kind !== "object") {
        if (available?.has(field.dbName || field.name))
          select[field.name] = true;
        else {
          const omission = `${modelName}.${field.name}`;
          if (omission !== "ReceiveFromHoloMachineRow.isWastage")
            throw new Error(`Unapproved missing column: ${omission}`);
          if (!missing.includes(omission)) missing.push(omission);
        }
      }
    for (const [name, value] of Object.entries(args.include || {})) {
      const field = model.fields.find((f) => f.name === name);
      select[name] = availableSelection(
        field.type,
        value === true ? {} : value,
      );
    }
    return { ...args, include: undefined, select };
  }
  // Old local DB lacks unrelated fields. Never change product sources/schema:
  // project findMany onto actual scalar columns, preserving requested relations.
  client.$use(async (params, next) => {
    if (params.action === "findMany" && params.model && !params.args?.select)
      params.args = availableSelection(params.model, params.args);
    return next(params);
  });
  const coverage = await readonly.$transaction((tx) =>
    tx.$queryRawUnsafe(
      'SELECT substring("date",1,7) AS month, count(*)::int AS rows FROM "ReceiveFromConingMachineRow" WHERE "date" ~ \'^[0-9]{4}-[0-9]{2}-[0-9]{2}$\' GROUP BY 1 ORDER BY rows DESC LIMIT 24',
    ),
  );
  const month =
    coverage.find((row) => row.month < "2026-09")?.month || "2026-08";
  const next = new Date(`${month}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = next.toISOString().slice(0, 10);
  const plans = await readonly.$transaction(async (tx) => ({
    period: await tx.$queryRawUnsafe(
      'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM "ReceiveFromConingMachineRow" WHERE "date" >= $1 AND "date" < $2 ORDER BY "date", "id"',
      `${month}-01`,
      end,
    ),
    dateAudit: await tx.$queryRawUnsafe(
      'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT "id", "date", "isDeleted" FROM "ReceiveFromConingMachineRow"',
    ),
  }));
  queryCount = 0;
  queryMs = 0;
  const before = process.memoryUsage();
  const start = performance.now();
  const report = await buildWorkerMonthlyReport(readonly, {
    month,
    workerId: "all",
  });
  const sourceMs = Math.round(performance.now() - start);
  const sourceQueries = queryCount;
  const sourceQueryMs = queryMs;
  const exports = {};
  for (const format of report.statements.length ? ["pdf", "xlsx"] : []) {
    let size = 0;
    const chunks = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        size += chunk.length;
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    sink.set = () => sink;
    sink.attachment = () => sink;
    sink.type = () => sink;
    const begin = performance.now();
    await sendReportDownload(report, format, sink);
    await writeFile(`${output}/actual-${format}.zip`, Buffer.concat(chunks));
    exports[format] = {
      durationMs: Math.round(performance.now() - begin),
      bytes: size,
      rssMiB: Math.round(process.memoryUsage().rss / 1048576),
    };
  }
  const evidence = {
    identity,
    localSchemaOmissions: missing,
    coverage,
    month: report.month,
    metrics: report.metrics,
    workers: report.statements.length,
    eligible: report.office.selectedTotals,
    exceptions: report.office.exceptions.length,
    excluded: report.office.excluded.length,
    unassigned: report.office.unassignedPeriodExceptions.length,
    sourceMs,
    sourceQueries,
    sourceQueryMs,
    heapGrowthMiB: Math.round(
      (process.memoryUsage().heapUsed - before.heapUsed) / 1048576,
    ),
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    exports,
    budgets: { sourceMs: 5000, perFormatMs: 30000, rssMiB: 512 },
    plans,
  };
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({ ...evidence, plans: "measurements.json" }, null, 2),
  );
} finally {
  await client.$disconnect();
}
