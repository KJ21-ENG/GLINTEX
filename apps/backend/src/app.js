import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import apiRouter from './routes/index.js';
import { perfLoggerMiddleware } from './middleware/perfLogger.js';

dotenv.config();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(perfLoggerMiddleware);
app.use(apiRouter);

export default app;
