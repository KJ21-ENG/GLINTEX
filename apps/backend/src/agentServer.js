import dotenv from 'dotenv';

import { createAgentApp } from './agentApp.js';
import prisma from './lib/prisma.js';

dotenv.config();

const PORT = Number(process.env.AGENT_API_PORT || 4003);

const app = createAgentApp();
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`GLINTEX owner agent API listening on port ${PORT}`);
});

async function shutdown(signal) {
  console.log(`GLINTEX owner agent API received ${signal}`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;
