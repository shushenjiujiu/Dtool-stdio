/**
 * DAG engine tests — topological sort, connection resolver, graph builder.
 */

import { describe, it, expect } from 'vitest';
import { topologicalSort } from '../dag/dag-executor.js';
import { deriveWires, validateWires } from '../dag/connection-resolver.js';
import { buildGraph } from '../dag/graph-builder.js';
import { canConnect } from '../types/dag.js';
import type { PortType, ExecutionGraph } from '../types/dag.js';
import type { ModuleDef } from '../types/module.js';
import type { ResolvedStepDef, ResolvedPipeline } from '../types/pipeline.js';

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

function makeStep(overrides: Partial<ResolvedStepDef> = {}): ResolvedStepDef {
  return {
    id: 's1',
    module: 'base64_encode',
    config: {},
    ...overrides,
  };
}

function makeGraph(nodes: ExecutionGraph['nodes'], wires: ExecutionGraph['wires'] = []): ExecutionGraph {
  return { nodes, wires };
}

// ── canConnect ──

describe('canConnect', () => {
  it('any accepts anything', () => {
    expect(canConnect('string', 'any')).toBe(true);
    expect(canConnect('json', 'any')).toBe(true);
  });

  it('any source connects to anything', () => {
    expect(canConnect('any', 'string')).toBe(true);
    expect(canConnect('any', 'json')).toBe(true);
  });

  it('exact type match', () => {
    expect(canConnect('string', 'string')).toBe(true);
  });

  it('mismatch returns false', () => {
    expect(canConnect('string', 'json')).toBe(false);
    expect(canConnect('json', 'string')).toBe(false);
  });
});

// ── topologicalSort ──

describe('topologicalSort', () => {
  it('sorts linear pipeline', () => {
    const graph = makeGraph([
      { id: 'a', module: 'm1', config: {}, definition: makeDef(), inputValues: {} },
      { id: 'b', module: 'm2', config: {}, definition: makeDef(), inputValues: {} },
      { id: 'c', module: 'm3', config: {}, definition: makeDef(), inputValues: {} },
    ], [
      { fromNode: 'a', fromPort: 'output', toNode: 'b', toPort: 'input' },
      { fromNode: 'b', fromPort: 'output', toNode: 'c', toPort: 'input' },
    ]);

    const result = topologicalSort(graph);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order).toEqual(['a', 'b', 'c']);
    }
  });

  it('detects cycle', () => {
    const graph = makeGraph([
      { id: 'a', module: 'm1', config: {}, definition: makeDef(), inputValues: {} },
      { id: 'b', module: 'm2', config: {}, definition: makeDef(), inputValues: {} },
    ], [
      { fromNode: 'a', fromPort: 'output', toNode: 'b', toPort: 'input' },
      { fromNode: 'b', fromPort: 'output', toNode: 'a', toPort: 'input' },
    ]);

    const result = topologicalSort(graph);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.cycleNodes.length).toBe(2);
    }
  });

  it('handles diamond DAG (no cycle)', () => {
    // a → b, a → c, b → d, c → d
    const graph = makeGraph([
      { id: 'a', module: 'm1', config: {}, definition: makeDef(), inputValues: {} },
      { id: 'b', module: 'm2', config: {}, definition: makeDef(), inputValues: {} },
      { id: 'c', module: 'm3', config: {}, definition: makeDef(), inputValues: {} },
      { id: 'd', module: 'm4', config: {}, definition: makeDef(), inputValues: {} },
    ], [
      { fromNode: 'a', fromPort: 'output', toNode: 'b', toPort: 'input' },
      { fromNode: 'a', fromPort: 'output', toNode: 'c', toPort: 'input' },
      { fromNode: 'b', fromPort: 'output', toNode: 'd', toPort: 'input' },
      { fromNode: 'c', fromPort: 'output', toNode: 'd', toPort: 'input' },
    ]);

    const result = topologicalSort(graph);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // a comes first, d comes last, b and c between
      expect(result.order[0]).toBe('a');
      expect(result.order[3]).toBe('d');
    }
  });

  it('handles isolated nodes (no wires)', () => {
    const graph = makeGraph([
      { id: 'a', module: 'm1', config: {}, definition: makeDef(), inputValues: {} },
      { id: 'b', module: 'm2', config: {}, definition: makeDef(), inputValues: {} },
    ], []);

    const result = topologicalSort(graph);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.order.length).toBe(2);
    }
  });
});

// ── deriveWires ──

describe('deriveWires', () => {
  it('connects linear pipeline by type', () => {
    const def1 = makeDef({ id: 'base64_encode', inputs: [{ id: 'input', type: 'string' }], outputs: [{ id: 'output', type: 'string' }] });
    const def2 = makeDef({ id: 'url_encode', inputs: [{ id: 'input', type: 'string' }], outputs: [{ id: 'output', type: 'string' }] });

    const steps: ResolvedStepDef[] = [
      { id: 's1', module: 'base64_encode', config: {} },
      { id: 's2', module: 'url_encode', config: {} },
    ];

    const modules = new Map<string, ModuleDef>();
    modules.set('base64_encode', def1);
    modules.set('url_encode', def2);

    const wires = deriveWires(steps, modules);
    expect(wires.length).toBe(1);
    expect(wires[0]).toEqual({
      fromNode: 's1', fromPort: 'output',
      toNode: 's2', toPort: 'input',
    });
  });

  it('skips connection when types mismatch', () => {
    const def1 = makeDef({ id: 'm1', outputs: [{ id: 'output', type: 'string' }] });
    const def2 = makeDef({ id: 'm2', inputs: [{ id: 'input', type: 'json' }], outputs: [{ id: 'output', type: 'json' }] });

    const steps: ResolvedStepDef[] = [
      { id: 's1', module: 'm1', config: {} },
      { id: 's2', module: 'm2', config: {} },
    ];

    const modules = new Map<string, ModuleDef>();
    modules.set('m1', def1);
    modules.set('m2', def2);

    const wires = deriveWires(steps, modules);
    expect(wires.length).toBe(0); // no compatible connection
  });

  it('connects when target is any type', () => {
    const def1 = makeDef({ id: 'm1', outputs: [{ id: 'output', type: 'string' }] });
    const def2 = makeDef({ id: 'm2', inputs: [{ id: 'input', type: 'any' }], outputs: [{ id: 'output', type: 'any' }] });

    const steps: ResolvedStepDef[] = [
      { id: 's1', module: 'm1', config: {} },
      { id: 's2', module: 'm2', config: {} },
    ];

    const modules = new Map<string, ModuleDef>();
    modules.set('m1', def1);
    modules.set('m2', def2);

    const wires = deriveWires(steps, modules);
    expect(wires.length).toBe(1);
  });
});

// ── validateWires ──

describe('validateWires', () => {
  it('accepts valid wires', () => {
    const def1 = makeDef({ id: 'm1', outputs: [{ id: 'output', type: 'string' }] });
    const def2 = makeDef({ id: 'm2', inputs: [{ id: 'input', type: 'string' }], outputs: [{ id: 'output', type: 'string' }] });

    const modules = new Map<string, ModuleDef>();
    modules.set('m1', def1);
    modules.set('m2', def2);

    const wires = deriveWires(
      [{ id: 's1', module: 'm1', config: {} }, { id: 's2', module: 'm2', config: {} }],
      modules,
    );

    const errors = validateWires(wires, modules, new Map([['s1','m1'],['s2','m2']]));
    expect(errors).toEqual([]);
  });
});

// ── buildGraph ──

describe('buildGraph', () => {
  it('filters out input/output steps', () => {
    const def = makeDef({ id: 'base64_encode' });
    const modules = new Map<string, ModuleDef>();
    modules.set('base64_encode', def);

    const pipeline: ResolvedPipeline = {
      steps: [
        { id: 'io_in', module: 'input', config: {} },
        { id: 's1', module: 'base64_encode', config: {} },
        { id: 'io_out', module: 'output', config: {} },
      ],
    };

    const graph = buildGraph({
      pipeline,
      resolveModule: (id) => modules.get(id),
    });

    expect(graph.nodes.length).toBe(1);
    expect(graph.nodes[0].id).toBe('s1');
  });

  it('auto-derives linear wires for compatible ports', () => {
    const def1 = makeDef({ id: 'base64_encode' });
    const def2 = makeDef({ id: 'url_encode' });
    const modules = new Map<string, ModuleDef>();
    modules.set('base64_encode', def1);
    modules.set('url_encode', def2);

    const pipeline: ResolvedPipeline = {
      steps: [
        { id: 's1', module: 'base64_encode', config: {} },
        { id: 's2', module: 'url_encode', config: {} },
      ],
    };

    const graph = buildGraph({
      pipeline,
      resolveModule: (id) => modules.get(id),
    });

    expect(graph.nodes.length).toBe(2);
    expect(graph.wires.length).toBe(1);
    expect(graph.wires[0].fromNode).toBe('s1');
    expect(graph.wires[0].toNode).toBe('s2');
  });
});
