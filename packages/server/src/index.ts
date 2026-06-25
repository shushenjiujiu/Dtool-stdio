/**
 * dtool Studio — Backend Server
 *
 * Fastify + WebSocket API server.
 * Serves template management REST endpoints and WebSocket execution.
 */

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { registerTemplateRoutes } from './api/template.js';
import { registerExecuteWS } from './ws/execute.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  // ── Plugins ──
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // ── Health check ──
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // ── REST routes ──
  await registerTemplateRoutes(app);

  // ── WebSocket routes ──
  registerExecuteWS(app);

  // ── Start ──
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`dtool Studio server running at http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.fatal(err);
    process.exit(1);
  }
}

main();
