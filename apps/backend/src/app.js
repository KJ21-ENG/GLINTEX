import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import dotenv from 'dotenv';
import apiRouter from './routes/index.js';
import { perfLoggerMiddleware } from './middleware/perfLogger.js';

dotenv.config();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if ((req.originalUrl || req.url || '').split('?')[0] === '/api/whatsapp/events') return false;
    return compression.filter(req, res);
  },
}));
app.use(perfLoggerMiddleware);
app.use(apiRouter);

export default app;
