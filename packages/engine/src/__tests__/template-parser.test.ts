import { describe, it, expect } from 'vitest';
import { parseYamlTemplate, parseJsonTemplate } from '../parser/template-parser.js';

const validYaml = `
version: "0.1"
name: "测试模板"
description: "用于测试的模板"
category: "工具"
params:
  - id: name
    label: "名称"
    type: string
    required: true
    placeholder: "输入名称"
flow:
  steps:
    - id: step1
      module: input
      config:
        text: "$param.name"
`.trim();

describe('parseYamlTemplate', () => {
  it('parses valid YAML template successfully', () => {
    const result = parseYamlTemplate(validYaml);
    expect(result.validation.valid).toBe(true);
    expect(result.template).toBeDefined();
    expect(result.template!.name).toBe('测试模板');
    expect(result.template!.params).toHaveLength(1);
    expect(result.template!.flow.steps).toHaveLength(1);
  });

  it('extracts step config correctly', () => {
    const result = parseYamlTemplate(validYaml);
    const step = result.template!.flow.steps[0];
    expect(step.id).toBe('step1');
    expect(step.module).toBe('input');
    expect(step.config!.text).toBe('$param.name');
  });

  it('extracts param metadata', () => {
    const result = parseYamlTemplate(validYaml);
    const param = result.template!.params[0];
    expect(param.id).toBe('name');
    expect(param.label).toBe('名称');
    expect(param.type).toBe('string');
    expect(param.required).toBe(true);
    expect(param.placeholder).toBe('输入名称');
  });

  it('returns error for malformed YAML', () => {
    const result = parseYamlTemplate('not: valid: yaml: [[[');
    expect(result.validation.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.template).toBeUndefined();
  });

  it('returns error for empty input', () => {
    const result = parseYamlTemplate('');
    expect(result.validation.valid).toBe(false);
  });

  it('returns error for missing required fields', () => {
    const result = parseYamlTemplate('name: "no-version"');
    expect(result.validation.valid).toBe(false);
    expect(result.error).toContain('Missing required field');
  });

  it('handles YAML with optional fields', () => {
    const yaml = `
version: "0.1"
name: "Full"
description: "Full template"
category: "编码/解码"
params: []
flow:
  steps:
    - id: s1
      module: input
`.trim();
    const result = parseYamlTemplate(yaml);
    expect(result.validation.valid).toBe(true);
    expect(result.template).toBeDefined();
  });
});

describe('parseJsonTemplate', () => {
  const validJson = JSON.stringify({
    version: '0.1',
    name: 'JSON Template',
    description: 'From JSON',
    category: '工具',
    params: [{ id: 'x', label: 'X', type: 'string' }],
    flow: { steps: [{ id: 's1', module: 'input', config: { val: '$param.x' } }] },
  });

  it('parses valid JSON template', () => {
    const result = parseJsonTemplate(validJson);
    expect(result.validation.valid).toBe(true);
    expect(result.template!.name).toBe('JSON Template');
  });

  it('returns error for malformed JSON', () => {
    const result = parseJsonTemplate('{invalid json');
    expect(result.validation.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('normalizes params correctly from JSON', () => {
    const result = parseJsonTemplate(validJson);
    expect(result.template!.params[0].id).toBe('x');
    expect(result.template!.params[0].type).toBe('string');
  });
});
