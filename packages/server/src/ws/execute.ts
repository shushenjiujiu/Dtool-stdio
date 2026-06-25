/**
 * WebSocket execution handler.
 *
 * Protocol (JSON messages):
 *
 * Client → Server:
 *   { type: "execute", template: TemplateDef, params: Record<string, unknown> }
 *   { type: "cancel" }
 *
 * Server → Client:
 *   { type: "step-start", stepId: string, module: string }
 *   { type: "step-complete", stepId: string, output: unknown }
 *   { type: "step-error", stepId: string, error: string }
 *   { type: "progress", percent: number }
 *   { type: "complete", outputs: Record<string, unknown> }
 *   { type: "error", message: string }
 *   { type: "log", level: string, message: string, meta?: unknown }
 */

import type { FastifyInstance } from 'fastify';
import { resolveTemplate, resolveStepConfig, parseYamlTemplate, ScopeChain } from '@dtool-studio/engine';
import type { TemplateDef, StepOutputs, ResolvedStepDef } from '@dtool-studio/engine';

interface ExecuteMessage {
  type: 'execute';
  template: TemplateDef;
  params: Record<string, unknown>;
}

interface CancelMessage {
  type: 'cancel';
}

type WsMessage = ExecuteMessage | CancelMessage;

export function registerExecuteWS(app: FastifyInstance): void {
  app.get('/ws', { websocket: true }, (socket, req) => {
    const log = req.log.child({ ws: true });

    // ── Abort controller for cancellation ──
    const abortController = new AbortController();
    const signal = abortController.signal;

    // ── Handle incoming messages ──
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

      // Start execution
      try {
        await executePipeline(msg.template, msg.params, signal, send);
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

    // ── Helper: send JSON message ──
    function send(data: Record<string, unknown>): void {
      try {
        socket.send(JSON.stringify(data));
      } catch {
        // Socket closed
      }
    }
  });
}

// ── Pipeline execution ─────────────────────────────────────────────────────

async function executePipeline(
  template: TemplateDef,
  params: Record<string, unknown>,
  signal: AbortSignal,
  send: (data: Record<string, unknown>) => void,
): Promise<void> {
  // Phase 1: Resolve $param references
  const pipeline = resolveTemplate(template, params);

  // Phase 2: Execute steps sequentially (depth-first)
  const outputs: StepOutputs = new Map();
  const scope = new ScopeChain();

  await executeSteps(pipeline.steps, outputs, scope, signal, send);

  if (!signal.aborted) {
    // Gather all step outputs
    const outputMap: Record<string, unknown> = {};
    outputs.forEach((value, key) => { outputMap[key] = value; });
    send({ type: 'complete', outputs: outputMap });
  }
}

async function executeSteps(
  steps: ResolvedStepDef[],
  outputs: StepOutputs,
  scope: ScopeChain,
  signal: AbortSignal,
  send: (data: Record<string, unknown>) => void,
): Promise<void> {
  for (const step of steps) {
    if (signal.aborted) return;

    send({ type: 'step-start', stepId: step.id, module: step.module });
    send({ type: 'log', level: 'info', message: `Executing step: ${step.id} (${step.module})` });

    try {
      if (step.module === 'loop') {
        await executeLoop(step, outputs, scope, signal, send);
      } else {
        // Resolve $steps references in config from already-executed outputs
        const resolvedConfig = resolveStepConfig(step.config, outputs);

        // Simulate module execution with a brief delay
        const output = await simulateModuleExecution(step, resolvedConfig, signal, send);

        outputs.set(step.id, output);
        send({ type: 'step-complete', stepId: step.id, output });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send({ type: 'step-error', stepId: step.id, error: message });
      throw err; // Abort pipeline on step failure
    }
  }
}

// ── Loop execution ─────────────────────────────────────────────────────────

async function executeLoop(
  step: ResolvedStepDef,
  outputs: StepOutputs,
  scope: ScopeChain,
  signal: AbortSignal,
  send: (data: Record<string, unknown>) => void,
): Promise<void> {
  const count = Number(step.config.count) || 1;
  const total = Math.min(count, 10000);
  let lastOutput: unknown = undefined;

  for (let i = 0; i < total; i++) {
    if (signal.aborted) return;

    send({ type: 'log', level: 'info', message: `Loop iteration ${i + 1}/${total}` });
    send({ type: 'progress', percent: Math.round(((i + 1) / total) * 100) });

    // Push a new scope for this iteration
    scope.pushScope();

    // Execute substeps within this scope
    if (step.substeps) {
      // Pass the loop's own config as substep context
      for (const substep of step.substeps) {
        if (signal.aborted) return;

        send({ type: 'step-start', stepId: `${step.id}/${substep.id}`, module: substep.module });

        const resolvedConfig = resolveStepConfig(substep.config, outputs);
        const subOutput = await simulateModuleExecution(substep, resolvedConfig, signal, send);

        scope.set(substep.id, subOutput);
        outputs.set(`${step.id}/${substep.id}-${i}`, subOutput);
        lastOutput = subOutput;

        send({ type: 'step-complete', stepId: `${step.id}/${substep.id}`, output: subOutput });
      }
    }

    scope.popScope();
  }

  // Loop output = last iteration's last substep output
  outputs.set(step.id, lastOutput);
}

// ── Simulated module execution ─────────────────────────────────────────────

/**
 * Simulate running a module. In Phase 1, this just passes through the input
 * config as output with a small artificial delay.
 *
 * Real module execution will replace this when modules are registered.
 */
async function simulateModuleExecution(
  step: ResolvedStepDef,
  resolvedConfig: Record<string, unknown>,
  signal: AbortSignal,
  send: (data: Record<string, unknown>) => void,
): Promise<unknown> {
  // Artificial delay to make execution visible in the UI
  await delay(100);

  // For now, just return the resolved config as a mock output
  return {
    stepId: step.id,
    module: step.module,
    config: resolvedConfig,
    result: 'ok',
    timestamp: new Date().toISOString(),
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
