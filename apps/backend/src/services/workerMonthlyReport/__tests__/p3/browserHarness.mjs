// Loopback-only, synthetic data, no DB or production server/hooks. This harness
// renders the actual Reports page and uses actual guarded report routes/service.
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { hashSessionToken } from "../../../../utils/auth.js";
import prisma from "../../../../lib/prisma.js";
import { createWorkerMonthlyReportRouter } from "../../../../routes/workerMonthlyReport.js";
import { buildWorkerMonthlyReport } from "../../service.js";
import { sources, row, issue } from "../fixtures.js";
const root = fileURLToPath(new URL("../../../../../../..", import.meta.url));
const frontend = path.join(root, "apps/frontend");
const requireFrontend = createRequire(path.join(frontend, "package.json"));
const { createServer } = await import(
  path.join(
    path.dirname(requireFrontend.resolve("vite/package.json")),
    "dist/node/index.js",
  )
);
const src = sources(
  Array.from({ length: 126 }, (_, i) =>
    row({
      id: `fixture-${String(i).padStart(3, "0")}`,
      date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
      operatorId: `worker/${i % 2}`,
      operator: {
        id: `worker/${i % 2}`,
        name: "Same Worker",
        processType: "cutter",
      },
      netWeight: i === 0 ? null : i === 1 ? 0 : 1.2345,
      issue: issue({ itemId: i % 2 ? "item1" : "item2" }),
    }),
  ),
  {
    items: [
      {
        id: "item1",
        name: "Quality with long descriptive metallic yarn label ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        side: "SINGLE",
      },
      { id: "item2", name: "Other quality", side: "BOTH" },
    ],
  },
);
src.periodRows.push(
  row({ id: "missing-worker", operatorId: null }),
  row({ id: "excluded-stock", createdBy: "opening" }),
);
src.undatedRows.push(row({ id: "undated", date: null }));
const client = {};
client.receiveFromConingMachineRow = {
  findMany: async (args) => {
    const rows = [...src.periodRows, ...src.undatedRows];
    if (args.select)
      return rows.map(({ id, date, isDeleted }) => ({ id, date, isDeleted }));
    if (args.where?.id)
      return rows.filter((row) => args.where.id.in.includes(row.id));
    return rows.filter(
      (row) => row.date >= args.where.date.gte && row.date < args.where.date.lt,
    );
  },
};
client.receiveFromHoloMachineRow = {
  findMany: async () => [{ id: "h1", issue: { id: "hi1", cutId: "c1" } }],
};
client.receiveFromCutterMachineRow = { findMany: async () => [] };
for (const [model, key] of [
  ["item", "items"],
  ["yarn", "yarns"],
  ["twist", "twists"],
  ["cut", "cuts"],
  ["coneType", "coneTypes"],
])
  client[model] = { findMany: async () => src[key] };
const fixturePrisma = { $transaction: async (fn) => fn(client) };
prisma.userSession.findUnique = async ({ where }) => ({
  id: "fixture-session",
  expiresAt: new Date("2099-01-01"),
  user: {
    id: "fixture-office",
    isActive: true,
    roles: [
      {
        role: {
          id: "staff",
          key: "staff",
          name: "Staff",
          permissions:
            where.tokenHash === hashSessionToken("p3-denied")
              ? {}
              : { reports: 1 },
        },
      },
    ],
  },
});
const app = express();
const api = express();
// Match production app.js policy without changing its origin/credential rules.
api.use(cors({ origin: true, credentials: true }));
api.use(cookieParser());
app.use(cookieParser());
app.use((req, res, next) => {
  if (!req.path.startsWith("/api") && !req.cookies.glintex_session)
    res.cookie("glintex_session", "synthetic-local-fixture");
  next();
});
api.use(
  "/api/reports/worker-monthly",
  createWorkerMonthlyReportRouter({
    client: fixturePrisma,
    buildReport: async (db, filters) => {
      await new Promise((resolve) => setTimeout(resolve, 650));
      if (filters.month === "2026-06")
        throw new Error("Synthetic report service failure");
      return buildWorkerMonthlyReport(db, filters, { now: new Date("2026-09-07T00:00:00Z") });
    },
  }),
);
api.get("/api/bootstrap", (_req, res) => res.json({}));
api.get("/api/module/:module", (_req, res) => res.json({}));
api.get("/api/reports/production", (_req, res) =>
  res.json({
    data: [],
    summary: {
      totalIssued: 0,
      totalReceived: 0,
      totalWastage: 0,
      efficiency: 0,
    },
  }),
);
api.use("/api", (_req, res) => res.json({}));
api.use((err, _req, res, _next) =>
  res.status(500).json({ error: err.message }),
);
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {Reports} from '/src/pages/Reports.jsx';import {InventoryProvider} from '/src/context/InventoryContext.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(<BrowserRouter><InventoryProvider><main className="p-4 max-w-6xl mx-auto"><p className="text-sm mb-4">LOCAL SYNTHETIC FIXTURE · actual Reports page and report routes · no database</p><Reports/></main></InventoryProvider></BrowserRouter>);`;
process.chdir(frontend);
const vite = await createServer({
  root: frontend,
  appType: "custom",
  configFile: false,
  define: {
    "import.meta.env.VITE_API_BASE": JSON.stringify("http://127.0.0.1:5188"),
  },
  plugins: [
    {
      name: "p3-entry",
      resolveId(id) {
        if (id === "/p3-entry.jsx") return id;
      },
      load(id) {
        if (id === "/p3-entry.jsx") return entry;
      },
    },
  ],
  server: { middlewareMode: true, fs: { allow: [root] } },
});
app.use(vite.middlewares);
app.get("*", async (req, res) =>
  res
    .type("html")
    .send(
      await vite.transformIndexHtml(
        req.originalUrl,
        '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><title>P3 local report validation</title></head><body><div id="root"></div><script type="module" src="/p3-entry.jsx"></script></body></html>',
      ),
    ),
);
const server = app.listen(5187, "127.0.0.1", () =>
  console.log("P3 fixture server http://127.0.0.1:5187 (no DB)"),
);
const apiServer = api.listen(5188, "127.0.0.1", () =>
  console.log("P3 fixture API http://127.0.0.1:5188 (credentialed cross-origin, no DB)"),
);
process.on("SIGTERM", async () => {
  await vite.close();
  await Promise.all([server, apiServer].map(listener => new Promise(resolve => listener.close(resolve))));
  process.exit(0);
});
