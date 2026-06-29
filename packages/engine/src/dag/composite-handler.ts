/**
 * Composite Module Handler — executes a CompositeModule as a black-box handler.
 *
 * A CompositeModule (defined in types/composite.ts) wraps an internal pipeline
 * of sub-modules. This handler:
 *
 *   1. Resolves the composite's internal steps (applying param values from ctx.config)
 *   2. Builds a sub-DAG from those steps
 *   3. Routes external inputs to the sub-DAG's exposed ports
 *   4. Executes the sub-DAG in topological order
 *   5. Collects outputs and returns them keyed by derived port id (`{stepId}/{portId}`)
 *
 * Recursive nesting is supported: if a sub-step references another composite
 * module, the handler recursively creates a nested CompositeHandler.
 */

import type { CompositeModule } from '../types/composite.js';
import type {
  ModuleHandler,
  ModuleContext,
  ModuleDef,
  ModuleMeta,
} from '../types/module.js';
import type { ResolvedPipeline, ResolvedStepDef } from '../types/pipeline.js';
import type { StepDef } from '../types/template.js';
import { buildGraph, type GraphBuilderOptions } from './graph-builder.js';
import { executeGraph } from './dag-executor.js';
import type { DagExecuteCallbacks } from './dag-executor.js';
import { deriveWires } from './connection-resolver.js';
import { derivePorts, parseDerivedPortId } from './port-derivation.js';
import type { PortDef } from '../types/module.js';

// ── Lookup interface ───────────────────────────────────────────────────────

/**
 * Lookup functions needed by the composite handler to resolve
 * sub-modules and handlers (including other composites for recursion).
 */
export interface CompositeModuleLookup {
  /** Resolve an atomic module's definition */
  getModuleDef: (moduleId: string) => ModuleDef | undefined;
  /** Resolve an atomic module's handler */
  getHandler: (moduleId: string) => ModuleHandler | undefined;
  /** Resolve a composite module by id (for recursive nesting) */
  getComposite: (moduleId: string) => CompositeModule | undefined;
}

// ── Handler factory ────────────────────────────────────────────────────────

/**
 * Create a ModuleHandler that executes a CompositeModule.
 *
 * The returned handler can be used anywhere a regular ModuleHandler is
 * expected — the DAG executor doesn't need to know it's a composite.
 */
export function createCompositeHandler(
  composite: CompositeModule,
  lookup: CompositeModuleLookup,
): ModuleHandler {
  return async (ctx: ModuleContext): Promise<Record<string, unknown>> => {
    // 1. Resolve the composite's internal steps with param values
    const resolvedSteps = resolveSteps(composite.steps, ctx.config);

    // 2. Build the sub-DAG
    const pipeline: ResolvedPipeline = { steps: resolvedSteps };

    // Build a temporary module table for port derivation
    const tempModTable = new Map<string, { inputs: { id: string; type?: string }[]; outputs: { id: string; type?: string }[] }>();
    for (const step of resolvedSteps) {
      const def = lookup.getModuleDef(step.module)
        ?? (lookup.getComposite(step.module) as unknown as { inputs: { id: string; type?: string }[]; outputs: { id: string; type?: string }[] } | undefined);
      if (def) tempModTable.set(step.module, def);
    }

    // Derive internal wires and external ports
    const internalWires = deriveWires(resolvedSteps, tempModTable as Map<string, any>);
    const derivedPorts = derivePorts({
      steps: resolvedSteps,
      wires: internalWires,
      resolveModule: (mid) => tempModTable.get(mid) ?? undefined,
    });

    // Build port mapping: declared port[i] ↔ derived port[i] (positional)
    const inputMap = buildPortMap(composite.inputs, derivedPorts.inputs);
    const outputMap = buildPortMap(composite.outputs, derivedPorts.outputs);

    // 3. Build the execution graph
    const graph = buildGraph({
      pipeline,
      resolveModule: (moduleId) => {
        const def = lookup.getModuleDef(moduleId);
        if (def) return def;
        const comp = lookup.getComposite(moduleId);
        if (comp) return comp as unknown as ModuleDef;
        return undefined;
      },
    });

    // 4. Route external inputs → internal nodes using port mapping
    for (const [declaredPortId, value] of Object.entries(ctx.inputs)) {
      const derivedId = inputMap.get(declaredPortId);
      if (!derivedId) continue;
      const parsed = parseDerivedPortId(derivedId);
      if (!parsed) continue;

      const node = graph.nodes.find((n) => n.id === parsed.stepId);
      if (node) {
        node.inputValues[parsed.portId] = value;
      }
    }

    // 5. Execute the sub-DAG
    const outputs = await executeGraph({
      graph,
      signal: ctx.signal as AbortSignal,
      callbacks: wrapCallbacks(ctx, composite.name),
      resolveHandler: (moduleId) => {
        const handler = lookup.getHandler(moduleId);
        if (handler) return handler;
        const comp = lookup.getComposite(moduleId);
        if (comp) return createCompositeHandler(comp, lookup);
        return undefined;
      },
    });

    // 6. Collect outputs using reverse port mapping
    const result: Record<string, unknown> = {};
    const reverseOutputMap = new Map<string, string>();
    for (const [declaredId, derivedId] of outputMap) {
      reverseOutputMap.set(derivedId, declaredId);
    }

    for (const [nodeId, nodeOutputs] of outputs) {
      for (const [portId, value] of Object.entries(nodeOutputs)) {
        const derivedId = `${nodeId}/${portId}`;
        const declaredId = reverseOutputMap.get(derivedId);
        if (declaredId !== undefined) {
          result[declaredId] = value;
        }
        // Fallback: also include raw derived ids for flexibility
        result[derivedId] = value;
      }
    }

    return result;
  };
}

// ── Step resolution ────────────────────────────────────────────────────────

/**
 * Resolve a composite module's internal steps by substituting
 * `$param.xxx` references in step configs with the provided param values.
 *
 * This is a lightweight, single-level resolver for composite param
 * substitution. It does NOT resolve `$steps.xxx` references — those
 * are handled by the DAG executor at runtime.
 */
function resolveSteps(
  steps: StepDef[],
  params: Record<string, unknown>,
): ResolvedStepDef[] {
  return steps.map((step) => {
    const resolvedConfig: Record<string, unknown> = {};

    if (step.config) {
      for (const [key, value] of Object.entries(step.config)) {
        resolvedConfig[key] = resolveParamRefs(value, params);
      }
    }

    return {
      id: step.id,
      module: step.module,
      label: step.label,
      config: resolvedConfig,
      substeps: step.substeps
        ? resolveSteps(step.substeps, params)
        : undefined,
    };
  });
}

/**
 * Resolve `$param.xxx` references in a single config value.
 *
 * Supports:
 *   - `"$param.key"`        → direct substitution
 *   - `"prefix $param.key"` → embedded substitution
 *   - Nested objects/arrays  → recursive resolution
 */
function resolveParamRefs(
  value: unknown,
  params: Record<string, unknown>,
): unknown {
  // String: check for $param references
  if (typeof value === 'string') {
    return value.replace(/\$param\.(\w+)/g, (_match, key: string) => {
      if (key in params) {
        return String(params[key] ?? '');
      }
      return _match; // keep unresolved reference as-is
    });
  }

  // Array: recurse into elements
  if (Array.isArray(value)) {
    return value.map((v) => resolveParamRefs(v, params));
  }

  // Object: recurse into values
  if (value !== null && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      resolved[k] = resolveParamRefs(v, params);
    }
    return resolved;
  }

  return value;
}

// ── Port mapping ───────────────────────────────────────────────────────────

/**
 * Build a positional mapping from declared ports to derived ports.
 *
 * declared[i] ↔ derived[i] (by positional order).
 * If there's a port id collision (declared id matches a derived id),
 * that takes precedence over positional mapping.
 */
function buildPortMap(
  declared: PortDef[],
  derived: PortDef[],
): Map<string, string> {
  const map = new Map<string, string>();

  // Set of derived ids for collision detection
  const derivedIds = new Set(derived.map((d) => d.id));

  for (let i = 0; i < declared.length; i++) {
    const dPort = declared[i];

    // If declared id matches a derived id exactly, use direct match
    if (derivedIds.has(dPort.id)) {
      map.set(dPort.id, dPort.id);
      continue;
    }

    // Positional fallback
    if (i < derived.length) {
      map.set(dPort.id, derived[i].id);
    }
  }

  return map;
}

// ── Callback wrapping ──────────────────────────────────────────────────────

/**
 * Wrap the composite's ModuleContext callbacks with a name prefix
 * so sub-step events are distinguishable in the execution log.
 */
function wrapCallbacks(
  ctx: ModuleContext,
  compositeName: string,
): DagExecuteCallbacks {
  const prefix = `[${compositeName}]`;
  return {
    onStepStart: (nodeId, module) => {
      ctx.log('info', `${prefix} ▶ ${nodeId} (${module})`);
    },
    onStepComplete: (nodeId, _output) => {
      ctx.log('info', `${prefix} ✓ ${nodeId}`);
    },
    onStepError: (nodeId, error) => {
      ctx.log('error', `${prefix} ✗ ${nodeId}: ${error}`);
    },
    onLog: (level, message) => {
      ctx.log(level, `${prefix} ${message}`);
    },
    onProgress: (percent) => {
      ctx.progress(percent);
    },
  };
}
