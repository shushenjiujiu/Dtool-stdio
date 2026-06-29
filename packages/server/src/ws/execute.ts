/**
 * WebSocket execution handler.
 *
 * Uses the real ModuleRegistry instead of mock execution.
 */

import type { FastifyInstance } from 'fastify';
import {
  resolveTemplate,
  buildGraph,
  executeGraph,
  ModuleRegistry,
} from '@dtool-studio/engine';
import type {
  TemplateDef,
} from '@dtool-studio/engine';

interface ExecuteMessage {
  type: 'execute';
  template: TemplateDef;
  params: Record<string, unknown>;
}

interface CancelMessage {
  type: 'cancel';
}

type WsMessage = ExecuteMessage | CancelMessage;

export function registerExecuteWS(app: FastifyInstance, registry: ModuleRegistry): void {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const log = req.log.child({ ws: true });

    const abortController = new AbortController();
    const signal = abortController.signal;

    socket.on('message', async (raw: Buffer) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString()) as WsMessage;
      } catch {
        send({ type: 'error', message: 'Invalid JSON' });
        return;
      }

      if (msg.type === 'cancel') {
        abortController.abort();
        send({ type: 'complete', outputs: {}, cancelled: true });
        return;
      }

      if (msg.type !== 'execute') {
        send({ type: 'error', message: `Unknown message type: ${(msg as { type: string }).type}` });
        return;
      }

      try {
        await executePipeline(msg.template, msg.params, signal, send, registry);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!signal.aborted) {
          send({ type: 'error', message });
        }
      }
    });

    socket.on('close', () => {
      abortController.abort();
    });

    function send(data: Record<string, unknown>): void {
      try {
        socket.send(JSON.stringify(data));
      } catch {
        // Socket closed
      }
    }
  });
}

// ── Pipeline execution (DAG-based) ──

async function executePipeline(
  template: TemplateDef,
  params: Record<string, unknown>,
  signal: AbortSignal,
  send: (data: Record<string, unknown>) => void,
  registry: ModuleRegistry,
): Promise<void> {
  // Phase 1: Resolve $param references
  const pipeline = resolveTemplate(template, params);

  // Phase 2: Build execution graph (derives wires from port types)
  const graph = buildGraph({
    pipeline,
    resolveModule: (id) => registry.get(id)?.definition,
  });

  // Phase 3: Execute via DAG executor
  const outputs = await executeGraph({
    graph,
    signal,
    callbacks: {
      onStepStart: (nodeId, module) => send({ type: 'step-start', stepId: nodeId, module }),
      onStepComplete: (nodeId, output) => send({ type: 'step-complete', stepId: nodeId, output }),
      onStepError: (nodeId, error) => send({ type: 'step-error', stepId: nodeId, error }),
      onLog: (level, message) => send({ type: 'log', level, message }),
      onProgress: (percent) => send({ type: 'progress', percent }),
    },
    resolveHandler: (moduleId) => registry.get(moduleId)?.handler,
  });

  if (!signal.aborted) {
    const outputMap: Record<string, unknown> = {};
    outputs.forEach((value, key) => { outputMap[key] = value; });
    send({ type: 'complete', outputs: outputMap });
  }
}
