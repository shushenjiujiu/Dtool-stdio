/**
 * dtool Studio — Backend Server
 *
 * Fastify + WebSocket API server.
 * Serves template management REST endpoints and WebSocket execution.
 */

import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { ModuleRegistry, registerAll } from '@dtool-studio/engine';
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

  // ── Initialize module registry ──
  const registry = new ModuleRegistry();
  registerAll(registry);
  app.log.info(`Registered ${registry.size} built-in modules`);

  // Store registry on Fastify instance for route access
  app.decorate('moduleRegistry', registry);

  // ── Plugins ──
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // ── Health check ──
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // ── REST routes ──
  await registerTemplateRoutes(app);

  // ── WebSocket routes ──
  registerExecuteWS(app, registry);

  // ── Start ──
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`dtool Studio server running at http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.fatal(err);
    process.exit(1);
  }
}

// Extend Fastify types for the decorated registry
declare module 'fastify' {
  interface FastifyInstance {
    moduleRegistry: ModuleRegistry;
  }
}

main();
