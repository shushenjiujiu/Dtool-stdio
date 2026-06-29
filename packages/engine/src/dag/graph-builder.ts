/**
 * GraphBuilder — builds an ExecutionGraph from a resolved pipeline.
 *
 * This is the bridge between the existing pipeline resolution
 * (VariableResolver) and the new DAG executor.
 *
 * Flow:
 *   ResolvedPipeline + ModuleRegistry
 *     → buildGraph()
 *     → ExecutionGraph { nodes, wires }
 *     → executeGraph()
 *
 * Layer 2: Composite module support.
 * When a step has `module === "_composite"` (inline composite), its substeps
 * are expanded and their wires merged into the parent graph.  Port derivation
 * is used to connect parent wires to/from the expanded sub-nodes.
 */

import type { ExecutionGraph, ExecutionNode, Wire } from '../types/dag.js';
import type { ResolvedStepDef, ResolvedPipeline } from '../types/index.js';
import type { ModuleDef } from '../types/module.js';
import { deriveWires } from './connection-resolver.js';
import { derivePorts } from './port-derivation.js';

export interface GraphBuilderOptions {
  pipeline: ResolvedPipeline;
  /** Module definition lookup (atomic or composite) */
  resolveModule: (moduleId: string) => ModuleDef | undefined;
  /** Explicit wires (optional). When provided, skip auto-derivation. */
  explicitWires?: Wire[];
}

// ── Sentinel ───────────────────────────────────────────────────────────────

/** Module id sentinel for inline composite modules */
export const COMPOSITE_SENTINEL = '_composite';

// ── Graph builder ──────────────────────────────────────────────────────────

/**
 * Build an execution graph from a resolved pipeline.
 *
 * - Steps that are 'input' or 'output' modules are filtered out.
 * - Steps with `module === "_composite"` are expanded inline:
 *   their substeps become nodes in the parent graph, and wires are
 *   remapped through port derivation.
 * - Wires are auto-derived in linear order for v1 (sequential steps).
 */
export function buildGraph(opts: GraphBuilderOptions): ExecutionGraph {
  const { pipeline, resolveModule } = opts;

  // ── Step 1: Collect all execution steps (including input/output) ──
  const execSteps = pipeline.steps;

  // ── Step 2: Expand composite modules inline ──
  const { expandedSteps, moduleTable, compositeMappings } = expandComposites(
    execSteps,
    resolveModule,
  );

  // ── Step 3: Build ExecutionNodes ──
  const nodes: ExecutionNode[] = [];

  for (const step of expandedSteps) {
    const def = resolveModule(step.module);
    if (!def) continue;

    nodes.push({
      id: step.id,
      module: step.module,
      config: {
        ...step.config,
        ...(step.substeps?.length ? { substeps: step.substeps } : {}),
      },
      definition: def,
      inputValues: {},
    });
  }

  // ── Step 4: Derive wires among expanded steps ──
  const effectiveWires = opts.explicitWires
    ? opts.explicitWires
    : deriveWires(expandedSteps, moduleTable);

  // ── Step 5: Remap wires that crossed composite boundaries ──
  const remappedWires = remapCompositeWires(
    effectiveWires,
    execSteps,
    expandedSteps,
    compositeMappings,
    resolveModule,
  );

  return { nodes, wires: remappedWires };
}

// ── Composite expansion ────────────────────────────────────────────────────

interface CompositeMapping {
  /** The composite's step id in the original (un-expanded) pipeline */
  parentStepId: string;
  /** The ids of the expanded substeps (in order) */
  childStepIds: string[];
}

interface ExpandedResult {
  /** Steps after composite expansion */
  expandedSteps: ResolvedStepDef[];
  /** Module lookup table keyed by module type id */
  moduleTable: Map<string, ModuleDef>;
  /** Mappings from original composite step → expanded child steps */
  compositeMappings: CompositeMapping[];
}

/**
 * Expand inline composite steps (`_composite`) into their substeps.
 *
 * Substeps are inserted in place of the composite step in the
 * step list, maintaining order.  Each expanded step gets a
 * unique id by prefixing with the parent composite's id to
 * avoid collisions.
 */
function expandComposites(
  steps: ResolvedStepDef[],
  resolveModule: (moduleId: string) => ModuleDef | undefined,
): ExpandedResult {
  return expandStepsRecursive(steps, resolveModule, '');
}

/**
 * Recursively expand composite steps with id prefixing.
 *
 * When a step is `_composite`, its substeps are recursively expanded
 * in place. Each expanded step gets a fully-qualified id by prefixing
 * with ancestor composite ids to guarantee uniqueness.
 */
function expandStepsRecursive(
  steps: ResolvedStepDef[],
  resolveModule: (moduleId: string) => ModuleDef | undefined,
  idPrefix: string,
): ExpandedResult {
  const expanded: ResolvedStepDef[] = [];
  const moduleTable = new Map<string, ModuleDef>();
  const mappings: CompositeMapping[] = [];

  for (const step of steps) {
    const fullId = idPrefix ? `${idPrefix}/${step.id}` : step.id;

    if (step.module === COMPOSITE_SENTINEL && step.substeps && step.substeps.length > 0) {
      // Recursively expand nested composites
      const childResult = expandStepsRecursive(step.substeps, resolveModule, fullId);

      // Merge child steps and module table
      for (const s of childResult.expandedSteps) {
        expanded.push(s);
      }
      for (const [k, v] of childResult.moduleTable) {
        if (!moduleTable.has(k)) moduleTable.set(k, v);
      }

      // Record mapping: this composite's id → its expanded child step ids
      mappings.push({
        parentStepId: fullId,
        childStepIds: childResult.expandedSteps.map((s) => s.id),
      });
    } else {
      // Non-composite step: pass through
      const def = resolveModule(step.module);
      if (def) {
        moduleTable.set(step.module, def);
      }

      expanded.push({ ...step, id: fullId });
    }
  }

  return { expandedSteps: expanded, moduleTable, compositeMappings: mappings };
}

// ── Wire remapping across composite boundaries ─────────────────────────────

/**
 * Remap wires that cross composite boundaries.
 *
 * When a composite is expanded, wires that connected to the
 * composite step must be remapped to connect to/from the
 * expanded substeps instead.
 *
 * Strategy: use port derivation to identify which substeps
 * expose which external ports, then remap:
 *   - Wires targeting the composite → target the substep
 *     whose exposed input port matches the wire's toPort
 *   - Wires from the composite → originate from the substep
 *     whose exposed output port matches the wire's fromPort
 */
function remapCompositeWires(
  derivedWires: Wire[],
  originalSteps: ResolvedStepDef[],
  expandedSteps: ResolvedStepDef[],
  mappings: CompositeMapping[],
  resolveModule: (moduleId: string) => ModuleDef | undefined,
): Wire[] {
  if (mappings.length === 0) return derivedWires;

  // Build a map: composite parent step id → mapping
  const mappingByParent = new Map<string, CompositeMapping>();
  for (const m of mappings) {
    mappingByParent.set(m.parentStepId, m);
  }

  // Build a set of all expanded child step ids for quick lookup
  const childIdSet = new Set<string>();
  for (const m of mappings) {
    for (const cid of m.childStepIds) {
      childIdSet.add(cid);
    }
  }

  // For each composite, derive its exposed ports from internal DAG
  // so we know which child step/port corresponds to each external port
  const portMapByParent = new Map<string, {
    inputMap: Map<string, { childStepId: string; childPortId: string }>;
    outputMap: Map<string, { childStepId: string; childPortId: string }>;
  }>();

  for (const m of mappings) {
    // Get the composite's substeps
    const parentStep = originalSteps.find((s) => s.id === m.parentStepId);
    if (!parentStep?.substeps) continue;

    // Build internal wires among substeps
    const subModuleTable = new Map<string, ModuleDef>();
    for (const sub of parentStep.substeps) {
      const def = resolveModule(sub.module);
      if (def) subModuleTable.set(sub.module, def);
    }
    const internalWires = deriveWires(parentStep.substeps, subModuleTable);

    // Derive external ports
    const derived = derivePorts({
      steps: parentStep.substeps,
      wires: internalWires,
      resolveModule: (mid) => {
        const d = subModuleTable.get(mid);
        if (d) return d;
        // Try the parent's resolveModule as fallback
        return resolveModule(mid) ?? undefined;
      },
    });

    // Build lookup maps: external port id → original (stepId, portId)
    const inputMap = new Map<string, { childStepId: string; childPortId: string }>();
    for (const p of derived.inputs) {
      // p.id is like "subStepId/subPortId" — but we need to prefix with parent
      const idx = p.id.indexOf('/');
      if (idx > 0) {
        const origStepId = p.id.substring(0, idx);
        const origPortId = p.id.substring(idx + 1);
        const fullChildStepId = `${m.parentStepId}/${origStepId}`;
        inputMap.set(p.id, { childStepId: fullChildStepId, childPortId: origPortId });
      }
    }

    const outputMap = new Map<string, { childStepId: string; childPortId: string }>();
    for (const p of derived.outputs) {
      const idx = p.id.indexOf('/');
      if (idx > 0) {
        const origStepId = p.id.substring(0, idx);
        const origPortId = p.id.substring(idx + 1);
        const fullChildStepId = `${m.parentStepId}/${origStepId}`;
        outputMap.set(p.id, { childStepId: fullChildStepId, childPortId: origPortId });
      }
    }

    portMapByParent.set(m.parentStepId, { inputMap, outputMap });
  }

  // Remap wires
  const remapped: Wire[] = [];

  for (const w of derivedWires) {
    let fromNode = w.fromNode;
    let fromPort = w.fromPort;
    let toNode = w.toNode;
    let toPort = w.toPort;

    // Is the source node an expanded child? Remap from child to its exposed parent port
    if (childIdSet.has(w.fromNode)) {
      const parentId = getParentCompositeId(w.fromNode, mappings);
      if (parentId) {
        const portInfo = portMapByParent.get(parentId);
        if (portInfo) {
          // Find the output port that corresponds to this child
          for (const [extPortId, info] of portInfo.outputMap) {
            if (info.childStepId === w.fromNode && info.childPortId === w.fromPort) {
              fromNode = parentId;
              fromPort = extPortId;
              break;
            }
          }
        }
      }
    }

    // Is the target node an expanded child? Remap from child to its exposed parent port
    if (childIdSet.has(w.toNode)) {
      const parentId = getParentCompositeId(w.toNode, mappings);
      if (parentId) {
        const portInfo = portMapByParent.get(parentId);
        if (portInfo) {
          for (const [extPortId, info] of portInfo.inputMap) {
            if (info.childStepId === w.toNode && info.childPortId === w.toPort) {
              toNode = parentId;
              toPort = extPortId;
              break;
            }
          }
        }
      }
    }

    // Avoid self-loops after remapping
    if (fromNode === toNode && fromPort === toPort) continue;

    remapped.push({ fromNode, fromPort, toNode, toPort });
  }

  return remapped;
}

/**
 * Given a child step id (e.g. "parentComp/subStep"), find the parent
 * composite step id.
 */
function getParentCompositeId(
  childStepId: string,
  mappings: CompositeMapping[],
): string | null {
  for (const m of mappings) {
    if (m.childStepIds.includes(childStepId)) {
      return m.parentStepId;
    }
  }
  return null;
}
