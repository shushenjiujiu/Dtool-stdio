import { describe, it, expect } from 'vitest';
import type { TemplateDef } from '../types/index.js';
import { validateStructure, validateSemantics } from '../validator/validator.js';

// ── Valid template for semantic tests ──

const validTemplate = {
  version: '0.1',
  name: 'Test Template',
  description: 'A template for testing',
  category: '工具',
  params: [
    { id: 'input_text', label: 'Input', type: 'string' as const, required: true },
    { id: 'count', label: 'Count', type: 'number' as const, default: 3 },
  ],
  flow: {
    steps: [
      { id: 'read', module: 'input', config: { text: '$param.input_text' } },
      { id: 'encode', module: 'encode/base64', config: { source: '$steps.read' } },
      { id: 'output', module: 'output', config: { source: '$steps.encode' } },
    ],
  },
};

// ── Structure validation tests ──

describe('validateStructure', () => {
  it('accepts a valid template', () => {
    const result = validateStructure(validTemplate);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects non-object input', () => {
    expect(validateStructure(null).valid).toBe(false);
    expect(validateStructure('string').valid).toBe(false);
    expect(validateStructure(42).valid).toBe(false);
  });

  it('requires version field', () => {
    const { version, ...noVersion } = validTemplate;
    const result = validateStructure(noVersion);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'struct/missing-required-field')).toBe(true);
  });

  it('requires name field', () => {
    const { name, ...noName } = validTemplate;
    const result = validateStructure(noName);
    expect(result.valid).toBe(false);
  });

  it('requires description field', () => {
    const { description, ...noDesc } = validTemplate;
    const result = validateStructure(noDesc);
    expect(result.valid).toBe(false);
  });

  it('requires category field', () => {
    const { category, ...noCategory } = validTemplate;
    const result = validateStructure(noCategory);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid category', () => {
    const result = validateStructure({ ...validTemplate, category: 'invalid-cat' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'struct/invalid-enum-value')).toBe(true);
  });

  it('rejects invalid version format', () => {
    const result = validateStructure({ ...validTemplate, version: 'abc' });
    expect(result.valid).toBe(false);
  });

  it('requires params array', () => {
    const result = validateStructure({ ...validTemplate, params: 'not-array' });
    expect(result.valid).toBe(false);
  });

  it('rejects param with invalid type', () => {
    const result = validateStructure({
      ...validTemplate,
      params: [{ id: 'x', label: 'X', type: 'invalid-type' }],
    });
    expect(result.valid).toBe(false);
  });

  it('rejects select param without options', () => {
    const result = validateStructure({
      ...validTemplate,
      params: [{ id: 'x', label: 'X', type: 'select' }],
    });
    expect(result.valid).toBe(false);
  });

  it('requires flow.steps array', () => {
    const result = validateStructure({ ...validTemplate, flow: {} });
    expect(result.valid).toBe(false);
  });

  it('accepts valid version format', () => {
    const result = validateStructure({ ...validTemplate, version: '1.0' });
    expect(result.valid).toBe(true);
  });
});

// ── Semantic validation tests ──

function asTemplate(t: unknown): TemplateDef { return t as TemplateDef; }

describe('validateSemantics', () => {
  it('accepts valid template with good references', () => {
    const result = validateSemantics(validTemplate);
    expect(result.valid).toBe(true);
  });

  it('detects undefined $param reference', () => {
    const result = validateSemantics(asTemplate({
      ...validTemplate,
      flow: {
        steps: [
          { id: 'read', module: 'input', config: { text: '$param.nonexistent' } },
        ],
      },
    }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'semantic/param-undefined')).toBe(true);
  });

  it('detects duplicate step ids', () => {
    const t = {
      ...validTemplate,
      flow: {
        steps: [
          { id: 'dup', module: 'input' },
          { id: 'dup', module: 'encode' },
        ],
      },
    };
    const result = validateSemantics(asTemplate(t));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'semantic/duplicate-step-id')).toBe(true);
  });

  it('detects loop missing count', () => {
    const t = {
      ...validTemplate,
      flow: {
        steps: [
          { id: 'loop1', module: 'loop', substeps: [{ id: 'inner', module: 'encode' }] },
        ],
      },
    };
    const result = validateSemantics(asTemplate(t));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'semantic/loop-missing-count')).toBe(true);
  });

  it('detects loop missing substeps', () => {
    const t = {
      ...validTemplate,
      flow: {
        steps: [
          { id: 'loop1', module: 'loop', config: { count: 3 } },
        ],
      },
    };
    const result = validateSemantics(asTemplate(t));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'semantic/loop-missing-substeps')).toBe(true);
  });

  it('detects unused branch module', () => {
    const t = {
      ...validTemplate,
      flow: {
        steps: [
          { id: 'br', module: 'branch', config: { condition: 'true' } },
        ],
      },
    };
    const result = validateSemantics(asTemplate(t));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'semantic/branch-not-implemented')).toBe(true);
  });

  it('detects loop count exceeding limit', () => {
    const t = {
      ...validTemplate,
      flow: {
        steps: [
          {
            id: 'loop1', module: 'loop',
            config: { count: 99999 },
            substeps: [{ id: 'inner', module: 'encode' }],
          },
        ],
      },
    };
    const result = validateSemantics(asTemplate(t), { maxLoopIterations: 10000 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'semantic/loop-count-exceeds-limit')).toBe(true);
  });

  it('detects undefined module (with registry)', () => {
    const t = {
      ...validTemplate,
      flow: {
        steps: [
          { id: 'x', module: 'does-not-exist' },
        ],
      },
    };
    const result = validateSemantics(asTemplate(t), { registeredModules: new Set(['input', 'encode']) });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'semantic/module-not-registered')).toBe(true);
  });

  it('allows loop and branch modules without registry check', () => {
    const t = {
      ...validTemplate,
      flow: {
        steps: [
          { id: 'lp', module: 'loop', config: { count: 3 }, substeps: [{ id: 'i', module: 'input' }] },
        ],
      },
    };
    // Should not flag 'loop' as unregistered
    const result = validateSemantics(asTemplate(t), { registeredModules: new Set(['input']) });
    expect(result.valid).toBe(true);
  });

  it('detects nested loop depth exceeding limit', () => {
    const t = {
      ...validTemplate,
      flow: {
        steps: [{
          id: 'l1', module: 'loop', config: { count: 3 },
          substeps: [{
            id: 'l2', module: 'loop', config: { count: 3 },
            substeps: [{
              id: 'l3', module: 'loop', config: { count: 3 },
              substeps: [{
                id: 'l4', module: 'loop', config: { count: 3 },
                substeps: [{ id: 'inner', module: 'input' }],
              }],
            }],
          }],
        }],
      },
    };
    const result = validateSemantics(asTemplate(t), { maxLoopDepth: 3 });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'limit/loop-depth-exceeded')).toBe(true);
  });

  it('detects dynamic module param not in params list', () => {
    const t = {
      ...validTemplate,
      params: [],  // no params defined
      flow: {
        steps: [
          { id: 'x', module: '$param.encode_type' },
        ],
      },
    };
    const result = validateSemantics(asTemplate(t));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'semantic/param-undefined')).toBe(true);
  });
});
