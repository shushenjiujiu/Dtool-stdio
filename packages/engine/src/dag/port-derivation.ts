/**
 * Port Derivation — derive external ports from an internal DAG.
 *
 * When a user defines a composite module's internal pipeline (steps + wires),
 * this module derives what the external interface should look like:
 *
 *   - External inputs  = internal node input ports that have no incoming wire
 *   - External outputs = internal node output ports that have no outgoing wire
 *
 * The derived port id uses the pattern `{stepId}/{portId}` so the caller
 * can trace each external port back to its originating internal node.
 */

import type { PortDef } from '../types/module.js';
import type { Wire } from '../types/dag.js';
import type { ResolvedStepDef } from '../types/pipeline.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PortDerivationInput {
  /** Internal pipeline steps */
  steps: ResolvedStepDef[];
  /** Internal wires */
  wires: Wire[];
  /** Resolve a step's module definition to get its port metadata */
  resolveModule: (moduleId: string) => { inputs: PortDef[]; outputs: PortDef[] } | undefined;
}

export interface DerivedPorts {
  inputs: PortDef[];
  outputs: PortDef[];
}

// ── Derivation ─────────────────────────────────────────────────────────────

/**
 * Derive external ports from an internal DAG.
 *
 * For each internal step, check its input/output ports against the
 * wire set. Any port with no connection is "exposed" as an external port.
 *
 * Port ids use `{stepId}/{portId}` to guarantee uniqueness across steps.
 */
export function derivePorts(input: PortDerivationInput): DerivedPorts {
  const { steps, wires, resolveModule } = input;

  const externalInputs: PortDef[] = [];
  const externalOutputs: PortDef[] = [];

  for (const step of steps) {
    const def = resolveModule(step.module);
    if (!def) continue;

    // ── External inputs: input ports with no incoming wire ──
    for (const inPort of def.inputs) {
      const hasIncoming = wires.some(
        (w) => w.toNode === step.id && w.toPort === inPort.id,
      );
      if (!hasIncoming) {
        externalInputs.push({
          id: `${step.id}/${inPort.id}`,
          label: `${step.label || step.id} › ${inPort.label || inPort.id}`,
          type: inPort.type,
          required: inPort.required,
          description: inPort.description,
        });
      }
    }

    // ── External outputs: output ports with no outgoing wire ──
    for (const outPort of def.outputs) {
      const hasOutgoing = wires.some(
        (w) => w.fromNode === step.id && w.fromPort === outPort.id,
      );
      if (!hasOutgoing) {
        externalOutputs.push({
          id: `${step.id}/${outPort.id}`,
          label: `${step.label || step.id} › ${outPort.label || outPort.id}`,
          type: outPort.type,
        });
      }
    }
  }

  return { inputs: externalInputs, outputs: externalOutputs };
}

/**
 * Parse a derived port id back into its constituent {stepId, portId}.
 *
 * External ports use the format `{stepId}/{portId}`.
 * Returns null if the port id doesn't match the derived format.
 */
export function parseDerivedPortId(portId: string): { stepId: string; portId: string } | null {
  const idx = portId.indexOf('/');
  if (idx <= 0 || idx >= portId.length - 1) return null;
  return {
    stepId: portId.substring(0, idx),
    portId: portId.substring(idx + 1),
  };
}
