/**
 * DAG Executor — topological sort + ordered execution.
 *
 * Given an ExecutionGraph (nodes + wires), topologically sorts the
 * nodes and executes them in dependency order.
 *
 * Uses Kahn's algorithm for topological sort. Detects cycles and
 * reports them as errors before execution begins.
 *
 * Parallel execution of independent nodes is reserved for a future
 * iteration (adds complexity around error handling and cancellation).
 */

import type {
  ExecutionGraph,
  ExecutionNode,
  Wire,
} from '../types/dag.js';
import type { ModuleHandler, ModuleContext, StepOutputs } from '../types/index.js';

// ── Topological sort (Kahn's algorithm) ────────────────────────────────────

/**
 * Result of a topological sort.
 */
export type TopoSortResult = {
  ok: true;
  order: string[]; // node ids in execution order
} | {
  ok: false;
  cycleNodes: string[];
}

/**
 * Sort nodes in execution order. Detects cycles.
 *
 * If a cycle is detected, returns the nodes involved in the cycle
 * so the caller can report a meaningful error.
 */
export function topologicalSort(graph: ExecutionGraph): TopoSortResult {
  const { nodes, wires } = graph;

  // Build adjacency and in-degree maps
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>(); // fromNode → [toNode, ...]
  const inDegree = new Map<string, number>();    // nodeId → count

  for (const id of nodeIds) {
    adjacency.set(id, []);
    inDegree.set(id, 0);
  }

  for (const w of wires) {
    if (!nodeIds.has(w.fromNode) || !nodeIds.has(w.toNode)) continue;
    adjacency.get(w.fromNode)!.push(w.toNode);
    inDegree.set(w.toNode, (inDegree.get(w.toNode) || 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);

    for (const neighbor of adjacency.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (order.length !== nodeIds.size) {
    // Cycle detected — collect remaining nodes
    const cycleNodes: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg > 0) cycleNodes.push(id);
    }
    return { ok: false, cycleNodes };
  }

  return { ok: true, order };
}

// ── Graph execution ────────────────────────────────────────────────────────

export interface DagExecuteCallbacks {
  /** Called when a node starts executing */
  onStepStart: (nodeId: string, module: string) => void;
  /** Called when a node completes */
  onStepComplete: (nodeId: string, output: Record<string, unknown>) => void;
  /** Called when a node fails */
  onStepError: (nodeId: string, error: string) => void;
  /** Called for log messages */
  onLog: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Called for progress updates */
  onProgress: (percent: number) => void;
}

export interface DagExecuteOptions {
  graph: ExecutionGraph;
  signal: AbortSignal;
  callbacks: DagExecuteCallbacks;
  /**
   * Module handler lookup function.
   * Returns the handler for a given module id, or undefined if not found.
   */
  resolveHandler: (moduleId: string) => ModuleHandler | undefined;
}

/**
 * Execute a graph in topological order.
 *
 * Returns the collected outputs keyed by node id.
 * Throws on the first step error (after reporting to callbacks).
 */
export async function executeGraph(
  opts: DagExecuteOptions,
): Promise<Map<string, Record<string, unknown>>> {
  const { graph, signal, callbacks, resolveHandler } = opts;

  // 1. Topological sort
  const sortResult = topologicalSort(graph);
  if (!sortResult.ok) {
    throw new Error(
      `DAG contains a cycle involving nodes: ${sortResult.cycleNodes.join(', ')}`,
    );
  }

  // 2. Build node lookup
  const nodeMap = new Map<string, ExecutionNode>();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }

  // 3. Execute in order
  const outputs = new Map<string, Record<string, unknown>>();

  for (const nodeId of sortResult.order) {
    if (signal.aborted) break;

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    callbacks.onStepStart(nodeId, node.module);

    try {
      const handler = resolveHandler(node.module);
      if (!handler) {
        throw new Error(`Module not found: ${node.module}`);
      }

      // Resolve input values at runtime from wire connections
      const runtimeInputs = resolveRuntimeInputs(nodeId, node, graph.wires, outputs);

      const ctx: ModuleContext = {
        inputs: runtimeInputs,
        config: stripInternalKeys(node.config),
        variables: {},
        log: (level, message) => callbacks.onLog(level, message),
        signal: signal as unknown as { readonly aborted: boolean; readonly reason?: unknown },
        progress: (percent) => callbacks.onProgress(percent),
      };

      const result = await handler(ctx);
      outputs.set(nodeId, result);
      callbacks.onStepComplete(nodeId, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      callbacks.onStepError(nodeId, message);
      throw err;
    }
  }

  return outputs;
}

// ── Runtime input resolution ──────────────────────────────────────────────

/**
 * Resolve input values for a node at execution time.
 *
 * Combines:
 *   1. Wire-based inputs: for each wire targeting this node,
 *      pull the output value from the source node's completed output.
 *   2. Build-time pre-filled inputs: `_input` from the first node
 *      (already set in buildGraph).
 *
 * If no wires target this node and no pre-filled inputs exist,
 * input ports get `undefined` values.
 */
function resolveRuntimeInputs(
  nodeId: string,
  node: ExecutionNode,
  wires: Wire[],
  completedOutputs: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  // Start with any pre-filled inputs (e.g., _input on first node)
  const inputs: Record<string, unknown> = { ...node.inputValues };

  // Route from completed upstream nodes via wires
  for (const w of wires) {
    if (w.toNode !== nodeId) continue;

    const srcOutput = completedOutputs.get(w.fromNode);
    if (srcOutput && w.fromPort in srcOutput) {
      inputs[w.toPort] = srcOutput[w.fromPort];
    }
  }

  return inputs;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip internal keys (_input, _stepIndex, etc.) from config
 * before passing to module handlers. These are used for wire
 * routing but should not be visible to module code.
 */
function stripInternalKeys(config: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    // Preserve loop-context keys and any non-internal keys
    if (!k.startsWith('_') || k === '_loop_index' || k === '_loop_item') {
      cleaned[k] = v;
    }
  }
  return cleaned;
}
