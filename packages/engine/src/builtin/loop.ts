/**
 * Loop module — iterates internal substeps.
 *
 * Modes:
 *   - count:   execute substeps `count` times
 *   - foreach: parse input as JSON array, iterate over items
 *   - until:   execute repeatedly until output includes untilCondition (max 100)
 *
 * Output modes:
 *   - last:        return the output from the last iteration
 *   - all:         return JSON array of all iteration outputs
 *   - first-match: return first output that includes untilCondition
 *
 * Each iteration injects `_loop_index` (0-based) and `_loop_item`
 * variables into the first sub-step's config.
 */

import type { ModuleDef, ModuleHandler, ModuleContext } from '../types/index.js';
import type { ResolvedStepDef, ResolvedPipeline } from '../types/pipeline.js';
import { buildGraph } from '../dag/graph-builder.js';
import { executeGraph } from '../dag/dag-executor.js';
import type { DagExecuteCallbacks } from '../dag/dag-executor.js';

// ── Definition ─────────────────────────────────────────────────────────────

export const loopDef: ModuleDef = {
  id: '_loop',
  name: '循环',
  category: 'flow',
  description: '循环执行内部步骤，支持计数、遍历数组、条件循环',
  inputs: [{ id: 'data', label: '数据', type: 'string' }],
  outputs: [{ id: 'data', label: '数据', type: 'string' }],
  configFields: [
    {
      key: 'mode', label: '循环模式', type: 'select', default: 'count',
      options: [
        { label: '计数循环', value: 'count' },
        { label: '遍历数组', value: 'foreach' },
        { label: '条件循环', value: 'until' },
      ],
    },
    { key: 'count', label: '循环次数', type: 'number', default: 3, min: 0, max: 10000 },
    { key: 'foreachVar', label: '遍历变量名', type: 'string', default: 'item', placeholder: '如 item, row' },
    { key: 'untilCondition', label: '停止条件', type: 'string', default: '', placeholder: '循环直到输出包含此字符串' },
    {
      key: 'outputMode', label: '输出模式', type: 'select', default: 'last',
      options: [
        { label: '最后一条', value: 'last' },
        { label: '全部（JSON 数组）', value: 'all' },
        { label: '首个匹配', value: 'first-match' },
      ],
    },
  ],
};

// ── Lookup interface ───────────────────────────────────────────────────────

export interface LoopHandlerLookup {
  getModuleDef: (moduleId: string) => ModuleDef | undefined;
  getHandler: (moduleId: string) => ModuleHandler | undefined;
}

// ── Handler factory ────────────────────────────────────────────────────────

/**
 * Create a loop module handler.
 *
 * The handler reads substeps from `ctx.config.substeps` and executes
 * them repeatedly according to the configured mode.
 */
export function createLoopHandler(lookup: LoopHandlerLookup): ModuleHandler {
  return async (ctx: ModuleContext): Promise<Record<string, unknown>> => {
    const mode = String(ctx.config.mode ?? 'count');
    const count = Number(ctx.config.count ?? 3);
    const foreachVar = String(ctx.config.foreachVar ?? 'item');
    const untilCondition = String(ctx.config.untilCondition ?? '');
    const outputMode = String(ctx.config.outputMode ?? 'last');
    const input = String(ctx.inputs.data ?? '');

    // Get substeps from config
    const substeps = (ctx.config.substeps as ResolvedStepDef[] | undefined) ?? [];

    if (substeps.length === 0) {
      return { data: input };
    }

    // Determine iteration count and items
    let iterations = 0;
    let loopItems: unknown[] = [];

    switch (mode) {
      case 'foreach': {
        try {
          const parsed = JSON.parse(input);
          loopItems = Array.isArray(parsed) ? parsed : [];
        } catch {
          loopItems = [];
        }
        iterations = loopItems.length;
        break;
      }
      case 'until':
        iterations = 100; // safety ceiling
        break;
      case 'count':
      default:
        iterations = Math.max(0, Math.min(Math.floor(count), 10000));
        break;
    }

    const allOutputs: string[] = [];
    let firstMatch: string | null = null;

    for (let i = 0; i < iterations; i++) {
      if (ctx.signal.aborted) break;

      const loopItem = mode === 'foreach' ? loopItems[i] : undefined;

      // Build a fresh sub-graph for this iteration
      const resolvedSubsteps: ResolvedStepDef[] = substeps.map((s) => ({
        ...s,
        config: { ...s.config },
      }));

      const pipeline: ResolvedPipeline = { steps: resolvedSubsteps };
      const graph = buildGraph({
        pipeline,
        resolveModule: (mid) => lookup.getModuleDef(mid) ?? undefined,
      });

      // Route data into the first node: the previous iteration's output
      // (or the original input on iteration 0)
      const currentInput = i === 0
        ? input
        : allOutputs.length > 0
          ? allOutputs[allOutputs.length - 1]
          : input;

      if (graph.nodes.length > 0) {
        const firstNode = graph.nodes[0];
        const inputPortId = firstNode.definition.inputs[0]?.id;
        if (inputPortId) {
          // Pre-fill the input value on the first node
          firstNode.inputValues[inputPortId] = currentInput;
        }
        // Inject loop variables as config on the first node
        (firstNode.config as Record<string, unknown>)._loop_index = i;
        if (loopItem !== undefined) {
          (firstNode.config as Record<string, unknown>)._loop_item = loopItem;
        }
      }

      // Internal abort controller for this iteration
      const iterationAbort = new AbortController();
      const parentSignal = ctx.signal as unknown as AbortSignal;
      const onParentAbort = () => iterationAbort.abort();
      try {
        parentSignal.addEventListener?.('abort', onParentAbort, { once: true });
      } catch {
        // ignore if not a real AbortSignal
      }

      try {
        // Wrap callbacks with iteration prefix
        const callbacks: DagExecuteCallbacks = {
          onStepStart: (nodeId, module) =>
            ctx.log('info', `[循环 #${i + 1}] ▶ ${nodeId} (${module})`),
          onStepComplete: (nodeId) =>
            ctx.log('info', `[循环 #${i + 1}] ✓ ${nodeId}`),
          onStepError: (nodeId, error) =>
            ctx.log('error', `[循环 #${i + 1}] ✗ ${nodeId}: ${error}`),
          onLog: (level, msg) =>
            ctx.log(level, `[循环 #${i + 1}] ${msg}`),
          onProgress: (pct) => ctx.progress(pct),
        };

        const outputs = await executeGraph({
          graph,
          signal: iterationAbort.signal,
          callbacks,
          resolveHandler: (mid) => lookup.getHandler(mid) ?? undefined,
        });

        // Collect output from the last node
        const lastNode = graph.nodes[graph.nodes.length - 1];
        const lastOutputs = outputs.get(lastNode?.id ?? '');
        const outputPortId = lastNode?.definition.outputs[0]?.id ?? 'output';
        const iterOutput = lastOutputs
          ? String(lastOutputs[outputPortId] ?? '')
          : '';
        allOutputs.push(iterOutput);

        // For 'until' mode, check stop condition
        if (mode === 'until' && iterOutput.includes(untilCondition)) {
          break;
        }

        // Track first match
        if (
          outputMode === 'first-match' &&
          firstMatch === null &&
          iterOutput.includes(untilCondition)
        ) {
          firstMatch = iterOutput;
        }
      } finally {
        try {
          parentSignal.removeEventListener?.('abort', onParentAbort);
        } catch {
          // ignore
        }
      }
    }

    // Build output according to outputMode
    switch (outputMode) {
      case 'all':
        return { data: JSON.stringify(allOutputs) };
      case 'first-match':
        return { data: firstMatch ?? '' };
      case 'last':
      default:
        return { data: allOutputs.length > 0 ? allOutputs[allOutputs.length - 1] : input };
    }
  };
}
