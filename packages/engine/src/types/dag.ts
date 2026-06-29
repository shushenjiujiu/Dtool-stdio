/**
 * DAG (Directed Acyclic Graph) execution types.
 *
 * Layered on top of the existing module/pipeline types.
 * After VariableResolver produces a ResolvedPipeline, the DAG
 * layer derives connections from port types, builds an execution
 * graph, topo-sorts, and executes.
 */

import type { ResolvedStepDef } from './pipeline.js';
import type { ModuleDef } from './module.js';

// ── Port types ─────────────────────────────────────────────────────────────

/**
 * Supported data types for module ports.
 *
 * - `string`: UTF-8 text (most modules)
 * - `any`:     Accepts any type (escape hatch, no type checking)
 * - `json`:    Parsed JSON object (reserved for future use)
 * - `stream`:  Binary/byte stream (reserved for future use)
 */
export type PortType = 'string' | 'any' | 'json' | 'stream';

/**
 * Type compatibility matrix.
 *
 * `any` accepts everything. Otherwise exact match required for v1.
 */
export function canConnect(source: PortType, target: PortType): boolean {
  if (target === 'any' || source === 'any') return true;
  return source === target;
}

// ── Wire (connection) ──────────────────────────────────────────────────────

/**
 * A directed wire from one node's output port to another node's input port.
 *
 * nodeId / portId reference the resolved step's id and port definition id.
 */
export interface Wire {
  /** Source node step id */
  fromNode: string;
  /** Source port id on the output side of the source node */
  fromPort: string;

  /** Target node step id */
  toNode: string;
  /** Target port id on the input side of the destination node */
  toPort: string;
}

// ── Execution node ─────────────────────────────────────────────────────────

/**
 * A fully resolved node in the DAG, ready for execution.
 *
 * `inputs` maps each input port id → { value, sourceNode, sourcePort }
 * so the executor knows where data came from (for debugging/provenance).
 */
export interface ExecutionNode {
  /** Step id */
  id: string;
  /** Module type id (e.g. "base64_encode") */
  module: string;
  /** Resolved config (all $param/$steps replaced) */
  config: Record<string, unknown>;
  /** Module definition (for port metadata) */
  definition: ModuleDef;

  /** Resolved input values keyed by input port id */
  inputValues: Record<string, unknown>;
}

// ── Execution graph ────────────────────────────────────────────────────────

export interface ExecutionGraph {
  nodes: ExecutionNode[];
  wires: Wire[];
}
