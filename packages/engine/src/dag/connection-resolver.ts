/**
 * ConnectionResolver — derives DAG wires from node port declarations.
 *
 * Strategy (v1):
 *   1. If the pipeline has explicit `wires` defined (future), use those.
 *   2. Otherwise, auto-derive in LINEAR order:
 *      - For each step[i].output port, connect to step[i+1].input port
 *        of the same type (or `any`).
 *      - First match wins; if no match, that output is terminal.
 *
 * This is deliberately simple for v1. Branching/merging via
 * explicit wires comes in a later iteration.
 */

import type { Wire, ExecutionNode, PortType } from '../types/dag.js';
import { canConnect } from '../types/dag.js';
import type { ResolvedStepDef } from '../types/pipeline.js';
import type { ModuleDef, PortDef } from '../types/module.js';

// ── Module lookup table ────────────────────────────────────────────────────

type ModuleTable = Map<string, ModuleDef>;

// ── Auto-derive linear wires ───────────────────────────────────────────────

/**
 * Given resolved steps and a module lookup table, derive connection wires.
 *
 * Linear strategy:
 *   For each consecutive pair (step[i] → step[i+1]):
 *     - Take each output port of step[i]
 *     - Find the first type-compatible input port on step[i+1]
 *     - Create a wire
 */
export function deriveWires(
  steps: ResolvedStepDef[],
  modules: ModuleTable,
): Wire[] {
  const wires: Wire[] = [];

  for (let i = 0; i < steps.length - 1; i++) {
    const srcNode = steps[i];
    const tgtNode = steps[i + 1];

    const srcDef = modules.get(srcNode.module);
    const tgtDef = modules.get(tgtNode.module);

    if (!srcDef || !tgtDef) continue;

    for (const outPort of srcDef.outputs) {
      for (const inPort of tgtDef.inputs) {
        if (canConnect(
          (outPort.type as PortType) || 'string',
          (inPort.type as PortType) || 'string',
        )) {
          wires.push({
            fromNode: srcNode.id,
            fromPort: outPort.id,
            toNode: tgtNode.id,
            toPort: inPort.id,
          });
          break; // one wire per output port (first match)
        }
      }
    }
  }

  return wires;
}

// ── Resolve input values for a node ────────────────────────────────────────

/**
 * Given the wires targeting a node and the completed outputs so far,
 * build the `inputValues` map for the node.
 *
 * Also handles `_input` backward compatibility:
 *   - If a node has no incoming wires but has `_input` in config,
 *     route `_input` → first input port.
 *   - `_input` is stripped from config after routing.
 */
export function resolveNodeInputs(
  nodeId: string,
  wires: Wire[],
  outputs: Map<string, Record<string, unknown>>, // stepId → { portId: value }
  nodeDef: ModuleDef,
  fallbackInput: unknown,
): Record<string, unknown> {
  const inputValues: Record<string, unknown> = {};

  // Route from wires
  for (const w of wires) {
    if (w.toNode !== nodeId) continue;

    const srcOutputs = outputs.get(w.fromNode);
    if (srcOutputs && w.fromPort in srcOutputs) {
      inputValues[w.toPort] = srcOutputs[w.fromPort];
    }
  }

  // Backward compat: if no wires targeted this node but we have a fallback,
  // fill the first input port
  const incomingWires = wires.filter((w) => w.toNode === nodeId);
  if (incomingWires.length === 0 && fallbackInput !== undefined && nodeDef.inputs.length > 0) {
    inputValues[nodeDef.inputs[0].id] = fallbackInput;
  }

  return inputValues;
}

// ── Type-level validation ──────────────────────────────────────────────────

export interface WireError {
  wire: Wire;
  message: string;
}

/**
 * Validate all wires against their modules' port type declarations.
 *
 * @param wires  The wires to validate
 * @param modules  Module table keyed by MODULE TYPE ID
 * @param stepModule  Maps step id → module type id
 * @returns Empty array if all wires are valid
 */
export function validateWires(
  wires: Wire[],
  modules: ModuleTable,
  stepModule?: Map<string, string>,
): WireError[] {
  const errors: WireError[] = [];

  for (const w of wires) {
    const srcModuleId = stepModule?.get(w.fromNode) ?? w.fromNode;
    const tgtModuleId = stepModule?.get(w.toNode) ?? w.toNode;
    const srcDef = modules.get(srcModuleId);
    const tgtDef = modules.get(tgtModuleId);

    if (!srcDef || !tgtDef) {
      errors.push({ wire: w, message: `Module not found: ${w.fromNode} or ${w.toNode}` });
      continue;
    }

    const outPort = srcDef.outputs.find((p) => p.id === w.fromPort);
    const inPort = tgtDef.inputs.find((p) => p.id === w.toPort);

    if (!outPort) {
      errors.push({ wire: w, message: `Output port "${w.fromPort}" not found on "${srcDef.id}"` });
      continue;
    }
    if (!inPort) {
      errors.push({ wire: w, message: `Input port "${w.toPort}" not found on "${tgtDef.id}"` });
      continue;
    }

    if (!canConnect(
      (outPort.type as PortType) || 'string',
      (inPort.type as PortType) || 'string',
    )) {
      errors.push({
        wire: w,
        message: `Type mismatch: ${w.fromNode}.${w.fromPort}(${outPort.type}) → ${w.toNode}.${w.toPort}(${inPort.type})`,
      });
    }
  }

  return errors;
}
