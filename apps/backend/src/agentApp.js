import express from 'express';

import agentRouter from './routes/agent/index.js';

export function createAgentApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return next();
  });
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/api/agent/v1', agentRouter);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error('Agent API unhandled error', error);
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}
