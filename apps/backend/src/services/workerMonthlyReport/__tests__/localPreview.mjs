// Explicit local report preview: loopback only, read-only local DB, no app jobs.
// Run from the repository root with node <this-file>.
import express from 'express';
import dotenv from 'dotenv';
import { PrismaClient, Prisma } from '@prisma/client';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createWorkerMonthlyReportRouter } from '../../../routes/workerMonthlyReport.js';

const root = fileURLToPath(new URL('../../../../../..', import.meta.url));
const frontend = `${root}/apps/frontend`;
dotenv.config({ path: `${root}/apps/backend/.env` });
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/glintex_dev' || (url.port || '5432') !== '5432') throw Error('Requires local glintex_dev on port 5432');
url.searchParams.set('options', '-c default_transaction_read_only=on');
const client = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const [identity] = await client.$queryRawUnsafe("SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('transaction_read_only') AS read_only");
if (identity.database !== 'glintex_dev' || !['127.0.0.1', '::1'].includes(identity.host) || identity.port !== 5432 || identity.read_only !== 'on') throw Error('Read-only local identity mismatch');
console.log('Verified preview database', identity);
const columns = await client.$queryRawUnsafe("SELECT column_name FROM information_schema.columns WHERE table_name='ReceiveFromConingMachineRow'");
if (!columns.some(column => column.column_name === 'isOpeningStock')) {
  // The report does not read this newer generated-client field. Do not migrate
  // the user's database merely to preview report presentation.
  const scalar = Object.fromEntries(Prisma.dmmf.datamodel.models.find(model => model.name === 'ReceiveFromConingMachineRow').fields.filter(field => field.kind !== 'object' && field.name !== 'isOpeningStock').map(field => [field.name, true]));
  client.$use(async (params, next) => {
    if (params.model === 'ReceiveFromConingMachineRow' && params.action === 'findMany' && !params.args?.select) {
      const { include = {}, ...args } = params.args || {};
      params.args = { ...args, select: { ...scalar, ...include } };
    }
    return next(params);
  });
  console.log('Local compatibility: omit unused isOpeningStock column');
}
const app = express();
app.use((req, res, next) => {
  if (req.headers.host !== '127.0.0.1:5187') return res.sendStatus(403);
  if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405);
  next();
});
app.use('/api/reports/worker-monthly', createWorkerMonthlyReportRouter({ client, authenticate: (req, _res, next) => {
  req.user = { id: 'local-preview', isAdmin: true }; next();
} }));
app.use('/api', (_req, res) => res.sendStatus(404));
const requireFrontend = createRequire(`${frontend}/package.json`);
const { createServer } = await import(requireFrontend.resolve('vite/package.json').replace('package.json', 'dist/node/index.js'));
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {WorkerMonthlyReport} from '/src/components/reports/WorkerMonthlyReport.jsx';import '/src/index.css';createRoot(document.getElementById('root')).render(<BrowserRouter><main className="p-4 max-w-6xl mx-auto"><p className="text-sm mb-4 text-muted-foreground">Local preview · existing glintex_dev data · read-only</p><WorkerMonthlyReport/></main></BrowserRouter>);`;
process.chdir(frontend);
const vite = await createServer({ root: frontend, configFile: false, appType: 'custom',
  define: { 'import.meta.env.VITE_API_BASE': JSON.stringify('http://127.0.0.1:5187') },
  plugins: [{ name: 'worker-calendar-preview', resolveId: id => id === '/calendar-preview.jsx' ? id : null, load: id => id === '/calendar-preview.jsx' ? entry : null }],
  server: { middlewareMode: true, fs: { allow: [root] } },
});
app.use(vite.middlewares);
app.get('*', async (req, res) => res.type('html').send(await vite.transformIndexHtml(req.originalUrl, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Worker monthly report preview</title></head><body><div id="root"></div><script type="module" src="/calendar-preview.jsx"></script></body></html>')));
app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
const server = app.listen(5187, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:5187/?wmMonth=2026-07'));
process.on('SIGTERM', async () => { await vite.close(); server.close(); await client.$disconnect(); process.exit(0); });
