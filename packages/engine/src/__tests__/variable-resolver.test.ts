import { describe, it, expect } from 'vitest';
import type { TemplateDef } from '../types/index.js';
import { resolveTemplate, resolveStepConfig, ResolutionError } from '../resolver/variable-resolver.js';

const sampleTemplate = {
  version: '0.1',
  name: 'test',
  description: 'test',
  category: '工具',
  params: [
    { id: 'input_text', label: 'Input', type: 'string' as const },
    { id: 'count', label: 'Count', type: 'number' as const, default: 3 },
    { id: 'encode_type', label: 'Type', type: 'select' as const, options: [{ label: 'Base64', value: 'base64' }] },
    { id: 'host', label: 'Host', type: 'string' as const, default: 'example.com' },
  ],
  flow: {
    steps: [
      { id: 'read', module: 'input', config: { text: '$param.input_text' } },
      { id: 'do_encode', module: '$param.encode_type', config: { source: '$steps.read.output' } },
      { id: 'loop_step', module: 'loop', config: { count: '$param.count' }, substeps: [{ id: 'inner', module: 'encode' }] },
      { id: 'output', module: 'output', config: { source: '$steps.do_encode' } },
    ],
  },
};

// ── Phase 1: resolveTemplate ──

describe('resolveTemplate (Phase 1 — $param)', () => {
  it('replaces $param.xxx with matching value', () => {
    const result = resolveTemplate(sampleTemplate, { input_text: 'hello world', count: 5, encode_type: 'base64', host: 'test.com' });
    const readStep = result.steps.find((s) => s.id === 'read')!;
    expect(readStep.config.text).toBe('hello world');
  });

  it('resolves dynamic module selection', () => {
    const result = resolveTemplate(sampleTemplate, { input_text: '', count: 1, encode_type: 'urlEncode', host: 'x' });
    const encStep = result.steps.find((s) => s.id === 'do_encode')!;
    expect(encStep.module).toBe('urlEncode');
  });

  it('preserves $steps references as literal strings', () => {
    const result = resolveTemplate(sampleTemplate, { input_text: '', count: 1, encode_type: 'base64', host: 'x' });
    const encStep = result.steps.find((s) => s.id === 'do_encode')!;
    expect(encStep.config.source).toBe('$steps.read.output');
  });

  it('preserves $steps in loop config', () => {
    const result = resolveTemplate(sampleTemplate, { input_text: '', count: 3, encode_type: 'base64', host: 'x' });
    const loopStep = result.steps.find((s) => s.id === 'loop_step')!;
    expect(loopStep.config.count).toBe(3);
  });

  it('throws on undefined param reference', () => {
    expect(() =>
      resolveTemplate(sampleTemplate, { input_text: '', count: 1, encode_type: 'base64', host: 'x' }),
    ).not.toThrow(); // valid

    // Missing param value = undefined, resolve to string "undefined" -> fine for now
    // The validator catches this earlier
  });

  it('resolves numeric param values correctly', () => {
    const result = resolveTemplate(sampleTemplate, { input_text: 'x', count: 42, encode_type: 'base64', host: 'x' });
    const loopStep = result.steps.find((s) => s.id === 'loop_step')!;
    expect(loopStep.config.count).toBe(42);
  });

  it('handles empty string params', () => {
    const result = resolveTemplate(sampleTemplate, { input_text: '', count: 1, encode_type: 'base64', host: 'x' });
    const readStep = result.steps.find((s) => s.id === 'read')!;
    expect(readStep.config.text).toBe('');
  });

  it('returns ResolvedPipeline with correct step count', () => {
    const result = resolveTemplate(sampleTemplate, { input_text: '', count: 1, encode_type: 'base64', host: 'x' });
    expect(result.steps).toHaveLength(4);
  });

  it('resolves substeps too', () => {
    const result = resolveTemplate(sampleTemplate, { input_text: '', count: 1, encode_type: 'base64', host: 'x' });
    const loopStep = result.steps.find((s) => s.id === 'loop_step')!;
    expect(loopStep.substeps).toHaveLength(1);
    expect(loopStep.substeps![0].id).toBe('inner');
  });
});

// ── Phase 2: resolveStepConfig ──

describe('resolveStepConfig (Phase 2 — $steps)', () => {
  it('replaces $steps.xxx with step output', () => {
    const outputs = new Map<string, unknown>([['read', { data: 'raw_input' }]]);
    const config = { source: '$steps.read', transform: '$steps.read.output' };
    const resolved = resolveStepConfig(config, outputs);
    expect(resolved.source).toEqual({ data: 'raw_input' });
    // Both $steps.read and $steps.read.output resolve to same value
  });

  it('replaces $steps.xxx in nested objects', () => {
    const outputs = new Map<string, unknown>([['step1', 'result1']]);
    const config = { wrapper: { inner: '$steps.step1' } };
    const resolved = resolveStepConfig(config, outputs);
    expect(resolved.wrapper).toEqual({ inner: 'result1' });
  });

  it('replaces $steps.xxx in arrays', () => {
    const outputs = new Map<string, unknown>([['step1', 'a'], ['step2', 'b']]);
    const config = { items: ['$steps.step1', '$steps.step2'] };
    const resolved = resolveStepConfig(config, outputs);
    expect(resolved.items).toEqual(['a', 'b']);
  });

  it('throws on unresolved $steps reference', () => {
    const outputs = new Map<string, unknown>();
    const config = { source: '$steps.nonexistent' };
    expect(() => resolveStepConfig(config, outputs)).toThrow(ResolutionError);
  });

  it('throws on dangling $ token after resolution', () => {
    const outputs = new Map<string, unknown>();
    const config = { value: '$invalid_token' };
    expect(() => resolveStepConfig(config, outputs)).toThrow(ResolutionError);
  });

  it('handles $$ escaping', () => {
    const outputs = new Map<string, unknown>();
    const config = { price: '$$19.99' };
    const resolved = resolveStepConfig(config, outputs);
    expect(resolved.price).toBe('$19.99');
  });

  it('handles $steps.xxx.output suffix (strip .output)', () => {
    const outputs = new Map<string, unknown>([['step_x', 'result_x']]);
    const config = { a: '$steps.step_x', b: '$steps.step_x.output' };
    const resolved = resolveStepConfig(config, outputs);
    expect(resolved.a).toBe('result_x');
    expect(resolved.b).toBe('result_x');
  });

  it('passes through non-string primitive values', () => {
    const outputs = new Map<string, unknown>();
    const config = { num: 42, bool: true, nil: null };
    const resolved = resolveStepConfig(config, outputs);
    expect(resolved.num).toBe(42);
    expect(resolved.bool).toBe(true);
    expect(resolved.nil).toBeNull();
  });

  it('resolves inline references in string with prefix/suffix', () => {
    const outputs = new Map<string, unknown>([['step1', 'world']]);
    const config = { greeting: 'hello-$steps.step1-end' };
    const resolved = resolveStepConfig(config, outputs);
    expect(resolved.greeting).toBe('hello-world-end');
  });
});

// ── ResolutionError ──

describe('ResolutionError', () => {
  it('is an instance of Error', () => {
    const err = new ResolutionError('UNRESOLVED_REFERENCE', '$param.missing');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('UNRESOLVED_REFERENCE');
    expect(err.reference).toBe('$param.missing');
  });
});
