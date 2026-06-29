/**
 * Loop module tests — iteration, variable injection, output modes.
 */

import { describe, it, expect } from 'vitest';
import { createLoopHandler, loopDef, type LoopHandlerLookup } from '../builtin/loop.js';
import type { ModuleDef, ModuleHandler, ModuleContext } from '../types/module.js';
import type { ResolvedStepDef } from '../types/pipeline.js';

// ── Test helpers ───────────────────────────────────────────────────────────

/**
 * Create a simple echo module: outputs whatever is on its input port.
 */
function makeEchoModule(): { definition: ModuleDef; handler: ModuleHandler } {
  const def: ModuleDef = {
    id: 'test/echo',
    name: 'Echo',
    category: 'test',
    description: 'Echoes input to output',
    inputs: [{ id: 'data', type: 'string' }],
    outputs: [{ id: 'data', type: 'string' }],
    configFields: [],
  };
  const handler: ModuleHandler = async (ctx) => {
    return { data: String(ctx.inputs.data ?? '') };
  };
  return { definition: def, handler };
}

/**
 * Create a module that outputs _loop_index from its config.
 */
function makeLoopIndexModule(): { definition: ModuleDef; handler: ModuleHandler } {
  const def: ModuleDef = {
    id: 'test/loop_index',
    name: 'LoopIndex',
    category: 'test',
    description: 'Outputs _loop_index config value',
    inputs: [{ id: 'data', type: 'string' }],
    outputs: [{ id: 'data', type: 'string' }],
    configFields: [],
  };
  const handler: ModuleHandler = async (ctx) => {
    return { data: String(ctx.config._loop_index ?? 'no-index') };
  };
  return { definition: def, handler };
}

/**
 * Create a module that appends its config suffix to input.
 */
function makeAppendModule(suffix: string): { definition: ModuleDef; handler: ModuleHandler } {
  const def: ModuleDef = {
    id: `test/append_${suffix}`,
    name: 'Append',
    category: 'test',
    description: 'Appends config suffix',
    inputs: [{ id: 'data', type: 'string' }],
    outputs: [{ id: 'data', type: 'string' }],
    configFields: [
      { key: 'suffix', label: 'Suffix', type: 'string', default: suffix },
    ],
  };
  const handler: ModuleHandler = async (ctx) => {
    return { data: String(ctx.inputs.data ?? '') + String(ctx.config.suffix ?? '') };
  };
  return { definition: def, handler };
}

/**
 * Build a lookup from an array of test module pairs.
 */
function makeLookup(
  modules: Array<{ definition: ModuleDef; handler: ModuleHandler }>,
): LoopHandlerLookup {
  const defMap = new Map<string, ModuleDef>();
  const handlerMap = new Map<string, ModuleHandler>();
  for (const m of modules) {
    defMap.set(m.definition.id, m.definition);
    handlerMap.set(m.definition.id, m.handler);
  }
  return {
    getModuleDef: (id) => defMap.get(id),
    getHandler: (id) => handlerMap.get(id),
  };
}

/**
 * Create a minimal ModuleContext for testing.
 */
function makeCtx(overrides: Partial<ModuleContext> = {}): ModuleContext {
  return {
    inputs: { data: '' },
    config: {},
    variables: {},
    log: () => {},
    signal: { aborted: false } as unknown as AbortSignal,
    progress: () => {},
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('loop module', () => {
  // ── count mode ──

  it('count=3 executes 3 iterations', async () => {
    const append = makeAppendModule('X');
    const lookup = makeLookup([append]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: 'start' },
      config: {
        mode: 'count',
        count: 3,
        outputMode: 'last',
        substeps: [
          {
            id: 'step1',
            module: 'test/append_X',
            config: { suffix: 'X' },
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    // Each iteration appends 'X': start → startX → startXX → startXXX
    expect(result.data).toBe('startXXX');
  });

  // ── _loop_index injection ──

  it('injects _loop_index variable into sub-step config', async () => {
    const indexMod = makeLoopIndexModule();
    const lookup = makeLookup([indexMod]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: 'irrelevant' },
      config: {
        mode: 'count',
        count: 3,
        outputMode: 'all',
        substeps: [
          {
            id: 'idx',
            module: 'test/loop_index',
            config: {},
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    const outputs = JSON.parse(String(result.data));
    // Iteration 0, 1, 2 → outputs "0", "1", "2"
    expect(outputs).toEqual(['0', '1', '2']);
  });

  // ── outputMode "last" ──

  it('outputMode "last" returns the last iteration output', async () => {
    const append = makeAppendModule('.');
    const lookup = makeLookup([append]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: 'A' },
      config: {
        mode: 'count',
        count: 2,
        outputMode: 'last',
        substeps: [
          {
            id: 's',
            module: 'test/append_.',
            config: { suffix: '.' },
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    // A → A. → A..
    expect(result.data).toBe('A..');
  });

  // ── outputMode "all" ──

  it('outputMode "all" returns JSON array of all outputs', async () => {
    const indexMod = makeLoopIndexModule();
    const lookup = makeLookup([indexMod]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: '' },
      config: {
        mode: 'count',
        count: 3,
        outputMode: 'all',
        substeps: [
          {
            id: 'idx',
            module: 'test/loop_index',
            config: {},
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    const outputs = JSON.parse(String(result.data));
    expect(Array.isArray(outputs)).toBe(true);
    expect(outputs).toHaveLength(3);
    expect(outputs).toEqual(['0', '1', '2']);
  });

  // ── until mode ──

  it('until mode stops when output includes condition', async () => {
    const append = makeAppendModule('#');
    const lookup = makeLookup([append]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: 'go' },
      config: {
        mode: 'until',
        untilCondition: '###',
        outputMode: 'last',
        substeps: [
          {
            id: 'add',
            module: 'test/append_#',
            config: { suffix: '#' },
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    // go → go# → go## → go### (stops here since output includes '###')
    expect(result.data).toBe('go###');
  });

  // ── until mode with safetry cap ──

  it('until mode stops at 100 iterations maximum', async () => {
    // A module that never produces the condition
    const append = makeAppendModule('x');
    const lookup = makeLookup([append]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: 'start' },
      config: {
        mode: 'until',
        untilCondition: 'IMPOSSIBLE',
        outputMode: 'last',
        substeps: [
          {
            id: 'add',
            module: 'test/append_x',
            config: { suffix: 'x' },
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    // Should stop after 100 iterations max
    const output = String(result.data);
    // start + 100 'x's
    expect(output).toBe('start' + 'x'.repeat(100));
  });

  // ── outputMode "first-match" ──

  it('outputMode "first-match" returns first output matching condition', async () => {
    const append = makeAppendModule('!');
    const lookup = makeLookup([append]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: 'hi' },
      config: {
        mode: 'count',
        count: 5,
        untilCondition: '!!!',
        outputMode: 'first-match',
        substeps: [
          {
            id: 'add',
            module: 'test/append_!',
            config: { suffix: '!' },
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    // hi → hi! → hi!! → hi!!! (first match)
    expect(result.data).toBe('hi!!!');
  });

  // ── foreach mode ──

  it('foreach mode iterates over JSON array input', async () => {
    const echo = makeEchoModule();
    const indexMod = makeLoopIndexModule();
    const lookup = makeLookup([echo, indexMod]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: JSON.stringify(['a', 'b', 'c']) },
      config: {
        mode: 'foreach',
        foreachVar: 'item',
        outputMode: 'all',
        substeps: [
          {
            id: 'idx',
            module: 'test/loop_index',
            config: {},
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    const outputs = JSON.parse(String(result.data));
    // 3 iterations, each outputs _loop_index value
    expect(outputs).toEqual(['0', '1', '2']);
  });

  // ── empty substeps ──

  it('returns input unchanged when substeps are empty', async () => {
    const lookup = makeLookup([]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: 'passthrough' },
      config: {
        mode: 'count',
        count: 5,
        outputMode: 'last',
        substeps: [],
      },
    });

    const result = await handler(ctx);
    expect(result.data).toBe('passthrough');
  });

  // ── zero count ──

  it('zero count returns input unchanged', async () => {
    const append = makeAppendModule('Z');
    const lookup = makeLookup([append]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: 'original' },
      config: {
        mode: 'count',
        count: 0,
        outputMode: 'last',
        substeps: [
          {
            id: 's',
            module: 'test/append_Z',
            config: { suffix: 'Z' },
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    expect(result.data).toBe('original');
  });

  // ── _loop_item injection ──

  it('injects _loop_item variable in foreach mode', async () => {
    // Module that outputs _loop_item from config
    const itemModDef: ModuleDef = {
      id: 'test/echo_item',
      name: 'EchoItem',
      category: 'test',
      description: 'Outputs _loop_item config value',
      inputs: [{ id: 'data', type: 'string' }],
      outputs: [{ id: 'data', type: 'string' }],
      configFields: [],
    };
    const itemModHandler: ModuleHandler = async (ctx) => {
      return { data: String(ctx.config._loop_item ?? 'no-item') };
    };
    const lookup = makeLookup([{ definition: itemModDef, handler: itemModHandler }]);
    const handler = createLoopHandler(lookup);

    const ctx = makeCtx({
      inputs: { data: JSON.stringify(['apple', 'banana', 'cherry']) },
      config: {
        mode: 'foreach',
        foreachVar: 'item',
        outputMode: 'all',
        substeps: [
          {
            id: 'echo',
            module: 'test/echo_item',
            config: {},
          } as ResolvedStepDef,
        ],
      },
    });

    const result = await handler(ctx);
    const outputs = JSON.parse(String(result.data));
    expect(outputs).toEqual(['apple', 'banana', 'cherry']);
  });

  // ── abort signal ──

  it('returns input when signal is already aborted', async () => {
    const append = makeAppendModule('X');
    const lookup = makeLookup([append]);
    const handler = createLoopHandler(lookup);

    const abortCtrl = new AbortController();
    abortCtrl.abort(); // already aborted

    const ctx = makeCtx({
      inputs: { data: 'original' },
      config: {
        mode: 'count',
        count: 100,
        outputMode: 'last',
        substeps: [
          {
            id: 's',
            module: 'test/append_X',
            config: { suffix: 'X' },
          } as ResolvedStepDef,
        ],
      },
      signal: abortCtrl.signal as unknown as AbortSignal,
    });

    const result = await handler(ctx);
    // No iterations should execute — signal already aborted at loop start
    expect(result.data).toBe('original');
  });
});

// ── Module definition verification ─────────────────────────────────────────

describe('loopDef', () => {
  it('has correct id and ports', () => {
    expect(loopDef.id).toBe('_loop');
    expect(loopDef.name).toBe('循环');
    expect(loopDef.category).toBe('flow');
    expect(loopDef.inputs).toEqual([{ id: 'data', label: '数据', type: 'string' }]);
    expect(loopDef.outputs).toEqual([{ id: 'data', label: '数据', type: 'string' }]);
  });

  it('has all config fields', () => {
    const keys = loopDef.configFields.map((f) => f.key);
    expect(keys).toContain('mode');
    expect(keys).toContain('count');
    expect(keys).toContain('foreachVar');
    expect(keys).toContain('untilCondition');
    expect(keys).toContain('outputMode');
  });

  it('mode config is a select with count/foreach/until', () => {
    const modeField = loopDef.configFields.find((f) => f.key === 'mode');
    expect(modeField?.type).toBe('select');
    const values = modeField?.options?.map((o) => o.value);
    expect(values).toContain('count');
    expect(values).toContain('foreach');
    expect(values).toContain('until');
  });
});
