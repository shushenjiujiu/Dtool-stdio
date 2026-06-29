/**
 * Composite module tests — port derivation, composite handler, inline expansion.
 */

import { describe, it, expect } from 'vitest';
import { derivePorts, parseDerivedPortId } from '../dag/port-derivation.js';
import { createCompositeHandler } from '../dag/composite-handler.js';
import type { CompositeModuleLookup } from '../dag/composite-handler.js';
import { buildGraph, COMPOSITE_SENTINEL } from '../dag/graph-builder.js';
import { executeGraph, topologicalSort } from '../dag/dag-executor.js';
import { deriveWires } from '../dag/connection-resolver.js';
import type { ModuleDef, ModuleHandler, ModuleContext } from '../types/module.js';
import type { CompositeModule } from '../types/composite.js';
import type { ResolvedStepDef, ResolvedPipeline } from '../types/pipeline.js';
import type { ExecutionGraph, Wire, ExecutionNode } from '../types/dag.js';

// ── Helpers ──

function makeDef(overrides: Partial<ModuleDef> = {}): ModuleDef {
  return {
    id: 'test_module',
    name: 'Test',
    category: 'encoding',
    description: 'Test module',
    inputs: [{ id: 'input', type: 'string' }],
    outputs: [{ id: 'output', type: 'string' }],
    configFields: [],
    ...overrides,
  };
}

function makeGraph(nodes: ExecutionNode[], wires: Wire[] = []): ExecutionGraph {
  return { nodes, wires };
}

/** Create a simple passthrough handler that echoes input to output */
function passthroughHandler(moduleId: string, inPort: string, outPort: string): ModuleHandler {
  return async (ctx: ModuleContext) => {
    const val = ctx.inputs[inPort] ?? ctx.config._input ?? `result-from-${moduleId}`;
    return { [outPort]: val };
  };
}

// ── Port derivation ────────────────────────────────────────────────────────

describe('derivePorts', () => {
  it('derives external inputs from unconnected input ports', () => {
    const steps: ResolvedStepDef[] = [
      { id: 's1', module: 'base64_encode', config: {} },
      { id: 's2', module: 'url_encode', config: {} },
    ];

    const def1 = makeDef({ id: 'base64_encode' });
    const def2 = makeDef({ id: 'url_encode' });

    const moduleMap = new Map<string, ModuleDef>();
    moduleMap.set('base64_encode', def1);
    moduleMap.set('url_encode', def2);

    const wires = deriveWires(steps, moduleMap);

    const result = derivePorts({
      steps,
      wires,
      resolveModule: (id) => moduleMap.get(id),
    });

    // s1 has input "input" with no incoming wire → external input
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].id).toBe('s1/input');

    // s2 has output "output" with no outgoing wire → external output
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].id).toBe('s2/output');
  });

  it('derives external outputs from unconnected output ports', () => {
    const steps: ResolvedStepDef[] = [
      { id: 'a', module: 'm1', config: {} },
    ];

    const def = makeDef({
      id: 'm1',
      inputs: [{ id: 'in1', type: 'string' }],
      outputs: [
        { id: 'out1', type: 'string' },
        { id: 'out2', type: 'string' },
      ],
    });

    const moduleMap = new Map<string, ModuleDef>();
    moduleMap.set('m1', def);

    const result = derivePorts({
      steps,
      wires: [],
      resolveModule: (id) => moduleMap.get(id),
    });

    // All ports are unconnected
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].id).toBe('a/in1');
    expect(result.outputs).toHaveLength(2);
    expect(result.outputs.map((o) => o.id).sort()).toEqual(['a/out1', 'a/out2']);
  });

  it('returns empty when internal wires fully connect everything', () => {
    const steps: ResolvedStepDef[] = [
      { id: 's1', module: 'm1', config: {} },
      { id: 's2', module: 'm2', config: {} },
      { id: 's3', module: 'm3', config: {} },
    ];

    const def1 = makeDef({ id: 'm1', inputs: [{ id: 'input', type: 'string' }] });
    const def2 = makeDef({ id: 'm2' });
    const def3 = makeDef({
      id: 'm3',
      inputs: [{ id: 'input', type: 'string' }],
      outputs: [{ id: 'output', type: 'string' }],
    });

    const moduleMap = new Map<string, ModuleDef>();
    moduleMap.set('m1', def1);
    moduleMap.set('m2', def2);
    moduleMap.set('m3', def3);

    // Fully connected: s1→s2, s2→s3
    const wires = deriveWires(steps, moduleMap);

    const result = derivePorts({
      steps,
      wires,
      resolveModule: (id) => moduleMap.get(id),
    });

    // s1/input has no incoming → external input
    // s3/output has no outgoing → external output
    expect(result.inputs).toHaveLength(1);
    expect(result.inputs[0].id).toBe('s1/input');
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].id).toBe('s3/output');
  });

  it('handles missing module gracefully', () => {
    const steps: ResolvedStepDef[] = [
      { id: 'unknown', module: 'nonexistent', config: {} },
    ];

    const result = derivePorts({
      steps,
      wires: [],
      resolveModule: () => undefined,
    });

    expect(result.inputs).toHaveLength(0);
    expect(result.outputs).toHaveLength(0);
  });
});

// ── parseDerivedPortId ─────────────────────────────────────────────────────

describe('parseDerivedPortId', () => {
  it('parses stepId/portId format', () => {
    const result = parseDerivedPortId('s1/input');
    expect(result).toEqual({ stepId: 's1', portId: 'input' });
  });

  it('returns null for port without slash', () => {
    expect(parseDerivedPortId('simpleport')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseDerivedPortId('')).toBeNull();
  });

  it('splits at first slash when multiple slashes present', () => {
    const result = parseDerivedPortId('step/sub/extra');
    expect(result).toEqual({ stepId: 'step', portId: 'sub/extra' });
  });
});

// ── Composite handler (black-box execution) ────────────────────────────────

describe('createCompositeHandler', () => {
  it('executes a simple composite with one internal step', async () => {
    // Define an atomic module
    const encodeDef = makeDef({ id: 'encode/b64', name: 'Base64' });
    const encodeHandler: ModuleHandler = async (ctx) => {
      return { output: `encoded:${ctx.inputs.input}` };
    };

    // Define a composite that wraps the atomic module
    const composite: CompositeModule = {
      id: 'my-wrapper',
      name: 'My Wrapper',
      category: 'test',
      description: 'A simple composite',
      inputs: [
        { id: 's1/input', label: 'Data In', type: 'string' },
      ],
      outputs: [
        { id: 's1/output', label: 'Data Out', type: 'string' },
      ],
      params: [],
      steps: [
        { id: 's1', module: 'encode/b64', config: {} },
      ],
    };

    const lookup: CompositeModuleLookup = {
      getModuleDef: (id) => id === 'encode/b64' ? encodeDef : undefined,
      getHandler: (id) => id === 'encode/b64' ? encodeHandler : undefined,
      getComposite: () => undefined,
    };

    const handler = createCompositeHandler(composite, lookup);

    const ctx: ModuleContext = {
      inputs: { 's1/input': 'hello' },
      config: {},
      variables: {},
      log: () => {},
      signal: { aborted: false } as AbortSignal,
      progress: () => {},
    };

    const result = await handler(ctx);
    expect(result).toEqual({ 's1/output': 'encoded:hello' });
  });

  it('supports recursive nesting (composite inside composite)', async () => {
    // Inner atomic module
    const echoDef = makeDef({ id: 'echo', name: 'Echo' });
    const echoHandler: ModuleHandler = async (ctx) => {
      return { output: ctx.inputs.input };
    };

    // Inner composite
    const innerComposite: CompositeModule = {
      id: 'inner-wrap',
      name: 'Inner Wrap',
      category: 'test',
      description: '',
      inputs: [{ id: 'e1/input', type: 'string' }],
      outputs: [{ id: 'e1/output', type: 'string' }],
      params: [],
      steps: [{ id: 'e1', module: 'echo', config: {} }],
    };

    // Outer composite (wraps inner composite)
    const outerComposite: CompositeModule = {
      id: 'outer-wrap',
      name: 'Outer Wrap',
      category: 'test',
      description: '',
      inputs: [{ id: 'wrap/input', type: 'string' }],
      outputs: [{ id: 'wrap/output', type: 'string' }],
      params: [],
      steps: [{ id: 'wrap', module: 'inner-wrap', config: {} }],
    };

    const lookup: CompositeModuleLookup = {
      getModuleDef: (id) => id === 'echo' ? echoDef : undefined,
      getHandler: (id) => id === 'echo' ? echoHandler : undefined,
      getComposite: (id) => id === 'inner-wrap' ? innerComposite : undefined,
    };

    const handler = createCompositeHandler(outerComposite, lookup);
    const ctx: ModuleContext = {
      inputs: { 'wrap/input': 'nested-value' },
      config: {},
      variables: {},
      log: () => {},
      signal: { aborted: false } as AbortSignal,
      progress: () => {},
    };

    const result = await handler(ctx);
    // outer: wrap → inner-wrap → e1 → echo
    // port naming: wrap/output comes from inner composite which produces e1/output
    expect(result['wrap/output']).toBe('nested-value');
  });

  it('routes input to first step via positional port mapping', async () => {
    // v1 linear wiring: steps are auto-connected s1→s2
    // The first step receives the external input, second step receives from first
    const m1Def = makeDef({
      id: 'm1',
      inputs: [{ id: 'in1', type: 'string' }],
      outputs: [{ id: 'out1', type: 'string' }],
    });
    const m2Def = makeDef({
      id: 'm2',
      inputs: [{ id: 'in2', type: 'string' }],
      outputs: [{ id: 'out2', type: 'string' }],
    });

    const m1Handler: ModuleHandler = async (ctx) => ({ out1: `first:${ctx.inputs.in1}` });
    const m2Handler: ModuleHandler = async (ctx) => ({ out2: `second:${ctx.inputs.in2}` });

    // Composite has one external input → routes to s1 (positional match)
    // And one external output ← collects from s2 (positional match)
    const composite: CompositeModule = {
      id: 'linear',
      name: 'Linear Chain',
      category: 'test',
      description: '',
      inputs: [
        { id: 'my_data_in', type: 'string' },
      ],
      outputs: [
        { id: 'my_data_out', type: 'string' },
      ],
      params: [],
      steps: [
        { id: 'a', module: 'm1', config: {} },
        { id: 'b', module: 'm2', config: {} },
      ],
    };

    const lookup: CompositeModuleLookup = {
      getModuleDef: (id) => {
        if (id === 'm1') return m1Def;
        if (id === 'm2') return m2Def;
        return undefined;
      },
      getHandler: (id) => {
        if (id === 'm1') return m1Handler;
        if (id === 'm2') return m2Handler;
        return undefined;
      },
      getComposite: () => undefined,
    };

    const handler = createCompositeHandler(composite, lookup);
    const ctx: ModuleContext = {
      inputs: { 'my_data_in': 'hello-chain' },
      config: {},
      variables: {},
      log: () => {},
      signal: { aborted: false } as AbortSignal,
      progress: () => {},
    };

    const result = await handler(ctx);
    // First step: out1 = first:hello-chain
    // Second step: in2 = first:hello-chain (from wire), out2 = second:first:hello-chain
    expect(result['my_data_out']).toBe('second:first:hello-chain');
  });

  it('passes param values to internal step configs', async () => {
    const greetDef = makeDef({
      id: 'greet',
      inputs: [{ id: 'msg', type: 'string' }],
      outputs: [{ id: 'out', type: 'string' }],
    });
    const greetHandler: ModuleHandler = async (ctx) => {
      const prefix = ctx.config.prefix ?? '';
      return { out: `${prefix}${ctx.inputs.msg}` };
    };

    const composite: CompositeModule = {
      id: 'greeter',
      name: 'Greeter',
      category: 'test',
      description: '',
      inputs: [{ id: 'g/msg', type: 'string' }],
      outputs: [{ id: 'g/out', type: 'string' }],
      params: [
        { id: 'prefix', label: 'Prefix', type: 'string' },
      ],
      steps: [
        { id: 'g', module: 'greet', config: { prefix: '$param.prefix' } },
      ],
    };

    const lookup: CompositeModuleLookup = {
      getModuleDef: (id) => id === 'greet' ? greetDef : undefined,
      getHandler: (id) => id === 'greet' ? greetHandler : undefined,
      getComposite: () => undefined,
    };

    const handler = createCompositeHandler(composite, lookup);
    const ctx: ModuleContext = {
      inputs: { 'g/msg': 'world' },
      config: { prefix: 'Hello, ' },
      variables: {},
      log: () => {},
      signal: { aborted: false } as AbortSignal,
      progress: () => {},
    };

    const result = await handler(ctx);
    expect(result).toEqual({ 'g/out': 'Hello, world' });
  });
});

// ── Graph builder with composite expansion ─────────────────────────────────

describe('buildGraph with composite expansion', () => {
  it('expands _composite inline, merging substeps into parent graph', () => {
    const def1 = makeDef({ id: 'm1' });
    const def2 = makeDef({ id: 'm2' });
    const def3 = makeDef({ id: 'm3' });

    const modules = new Map<string, ModuleDef>();
    modules.set('m1', def1);
    modules.set('m2', def2);
    modules.set('m3', def3);

    const pipeline: ResolvedPipeline = {
      steps: [
        { id: 'step1', module: 'm1', config: {} },
        {
          id: 'step2',
          module: COMPOSITE_SENTINEL,
          config: {},
          substeps: [
            { id: 'inner1', module: 'm2', config: {} },
            { id: 'inner2', module: 'm3', config: {} },
          ],
        },
      ],
    };

    const graph = buildGraph({
      pipeline,
      resolveModule: (id) => modules.get(id),
    });

    // Should have 3 nodes: step1, step2/inner1, step2/inner2
    expect(graph.nodes).toHaveLength(3);

    const nodeIds = graph.nodes.map((n) => n.id).sort();
    expect(nodeIds).toEqual(['step1', 'step2/inner1', 'step2/inner2']);

    // Wires should connect: step1 → step2/inner1 → step2/inner2
    expect(graph.wires.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps non-composite steps as-is', () => {
    const def1 = makeDef({ id: 'm1' });
    const def2 = makeDef({ id: 'm2' });

    const modules = new Map<string, ModuleDef>();
    modules.set('m1', def1);
    modules.set('m2', def2);

    const pipeline: ResolvedPipeline = {
      steps: [
        { id: 's1', module: 'm1', config: {} },
        { id: 's2', module: 'm2', config: {} },
      ],
    };

    const graph = buildGraph({
      pipeline,
      resolveModule: (id) => modules.get(id),
    });

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0].id).toBe('s1');
    expect(graph.nodes[1].id).toBe('s2');
    expect(graph.wires.length).toBe(1);
  });

  it('expands _composite with no substeps gracefully (passthrough)', () => {
    const def = makeDef({ id: 'm1' });
    const modules = new Map<string, ModuleDef>();
    modules.set('m1', def);

    const pipeline: ResolvedPipeline = {
      steps: [
        { id: 's1', module: 'm1', config: {} },
        {
          id: 'empty-comp',
          module: COMPOSITE_SENTINEL,
          config: {},
          substeps: [],
        },
      ],
    };

    const graph = buildGraph({
      pipeline,
      resolveModule: (id) => modules.get(id),
    });

    // Only the non-composite step remains
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe('s1');
  });

  it('handles two-level nesting (composite inside composite)', () => {
    const def = makeDef({ id: 'leaf', inputs: [{ id: 'input', type: 'string' }], outputs: [{ id: 'output', type: 'string' }] });
    const modules = new Map<string, ModuleDef>();
    modules.set('leaf', def);

    const pipeline: ResolvedPipeline = {
      steps: [
        {
          id: 'outer',
          module: COMPOSITE_SENTINEL,
          config: {},
          substeps: [
            { id: 'pre', module: 'leaf', config: {} },
            {
              id: 'inner',
              module: COMPOSITE_SENTINEL,
              config: {},
              substeps: [
                { id: 'core', module: 'leaf', config: {} },
              ],
            },
          ],
        },
      ],
    };

    const graph = buildGraph({
      pipeline,
      resolveModule: (id) => modules.get(id),
    });

    // pre, inner/core
    expect(graph.nodes).toHaveLength(2);
    const nodeIds = graph.nodes.map((n) => n.id).sort();
    expect(nodeIds).toContain('outer/pre');
    expect(nodeIds).toContain('outer/inner/core');

    // Wires should connect pre → inner/core
    expect(graph.wires.length).toBeGreaterThanOrEqual(1);
  });

  it('filters input/output module types from expanded steps too', () => {
    const def = makeDef({ id: 'm1' });
    const modules = new Map<string, ModuleDef>();
    modules.set('m1', def);

    const pipeline: ResolvedPipeline = {
      steps: [
        { id: 's1', module: 'input', config: {} },
        {
          id: 'comp',
          module: COMPOSITE_SENTINEL,
          config: {},
          substeps: [
            { id: 'io', module: 'output', config: {} },
            { id: 'real', module: 'm1', config: {} },
          ],
        },
        { id: 's3', module: 'output', config: {} },
      ],
    };

    const graph = buildGraph({
      pipeline,
      resolveModule: (id) => modules.get(id),
    });

    // Only 'comp/real' should remain
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe('comp/real');
  });
});

// ── End-to-end: Composite handler + DAG executor ───────────────────────────

describe('composite end-to-end', () => {
  it('executes a pipeline with a composite module via executeGraph', async () => {
    // Define modules
    const encodeDef = makeDef({ id: 'encode/b64', name: 'Base64' });
    const encodeHandler: ModuleHandler = async (ctx) => {
      return { output: `b64(${ctx.inputs.input})` };
    };

    const upperDef = makeDef({ id: 'text/upper', name: 'Upper' });
    const upperHandler: ModuleHandler = async (ctx) => {
      return { output: String(ctx.inputs.input).toUpperCase() };
    };

    // Define composite that does base64 encode
    const b64Wrapper: CompositeModule = {
      id: 'b64-wrap',
      name: 'B64 Wrapper',
      category: 'encoding',
      description: 'Wraps base64 encode',
      inputs: [{ id: 'enc/input', type: 'string' }],
      outputs: [{ id: 'enc/output', type: 'string' }],
      params: [],
      steps: [
        { id: 'enc', module: 'encode/b64', config: {} },
      ],
    };

    const lookup: CompositeModuleLookup = {
      getModuleDef: (id) => {
        if (id === 'encode/b64') return encodeDef;
        if (id === 'text/upper') return upperDef;
        return undefined;
      },
      getHandler: (id) => {
        if (id === 'encode/b64') return encodeHandler;
        if (id === 'text/upper') return upperHandler;
        return undefined;
      },
      getComposite: (id) => {
        if (id === 'b64-wrap') return b64Wrapper;
        return undefined;
      },
    };

    const handler = createCompositeHandler(b64Wrapper, lookup);

    // Build a simple graph: one node that uses the composite handler
    const graph: ExecutionGraph = {
      nodes: [
        {
          id: 'step1',
          module: 'b64-wrap',
          config: {},
          definition: b64Wrapper as unknown as ModuleDef,
          inputValues: { 'enc/input': 'test-data' },
        },
      ],
      wires: [],
    };

    const outputs = await executeGraph({
      graph,
      signal: new AbortController().signal,
      callbacks: {
        onStepStart: () => {},
        onStepComplete: () => {},
        onStepError: () => {},
        onLog: () => {},
        onProgress: () => {},
      },
      resolveHandler: (moduleId) => {
        if (moduleId === 'b64-wrap') return handler;
        if (moduleId === 'encode/b64') return encodeHandler;
        return undefined;
      },
    });

    expect(outputs.get('step1')).toEqual({ 'enc/output': 'b64(test-data)' });
  });
});
