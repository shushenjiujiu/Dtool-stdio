/**
 * Transformation modules
 *
 * Ported from old dtool with ModuleHandler adapter pattern.
 */

import type { ModuleDef, ModuleHandler } from '../types/index.js';

type ModulePair = { definition: ModuleDef; handler: ModuleHandler };

function createDef(id: string, name: string, description: string, configFields?: ModuleDef['configFields']): ModuleDef {
  return {
    id, name, category: 'transformation', description,
    inputs: [{ id: 'input', label: '输入', type: 'string', required: true }],
    outputs: [{ id: 'output', label: '输出', type: 'string' }],
    configFields: configFields ?? [],
  };
}

// ── case_convert ──

const caseConvert: ModulePair = {
  definition: createDef('case_convert', '大小写转换', '转换字符串大小写', [
    {
      key: 'mode', label: '模式', type: 'select', default: 'upper',
      options: [
        { label: '全部大写', value: 'upper' },
        { label: '全部小写', value: 'lower' },
        { label: '交替大小写', value: 'alternate' },
        { label: '随机大小写', value: 'random' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const mode = String(ctx.config.mode ?? 'upper');
    switch (mode) {
      case 'upper': return { output: input.toUpperCase() };
      case 'lower': return { output: input.toLowerCase() };
      case 'alternate': return { output: input.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join('') };
      case 'random': return { output: input.split('').map((c) => Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()).join('') };
      default: return { output: input };
    }
  },
};

// ── string_reverse ──

const stringReverse: ModulePair = {
  definition: createDef('string_reverse', '字符串反转', '反转输入字符串'),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    return { output: input.split('').reverse().join('') };
  },
};

// ── trim_whitespace ──

const trimWhitespace: ModulePair = {
  definition: createDef('trim_whitespace', '清除空白', '清除输入中的多余空白字符', [
    {
      key: 'mode', label: '模式', type: 'select', default: 'trim',
      options: [
        { label: '去首尾空白', value: 'trim' },
        { label: '合并连续空白', value: 'collapse' },
        { label: '删除所有空白', value: 'strip' },
        { label: '去除空行', value: 'empty_lines' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const mode = String(ctx.config.mode ?? 'trim');
    switch (mode) {
      case 'collapse': return { output: input.replace(/\s+/g, ' ').trim() };
      case 'strip': return { output: input.replace(/\s+/g, '') };
      case 'empty_lines': return { output: input.split('\n').filter((l) => l.trim()).join('\n') };
      case 'trim':
      default: return { output: input.trim() };
    }
  },
};

// ── repeat_pad ──

const repeatPad: ModulePair = {
  definition: createDef('repeat_pad', '重复填充', '重复字符串或填充到指定长度', [
    {
      key: 'action', label: '操作', type: 'select', default: 'repeat_suffix',
      options: [
        { label: '重复拼接在尾部', value: 'repeat_suffix' },
        { label: '重复拼接在头部', value: 'repeat_prefix' },
        { label: '填充到指定长度（前补）', value: 'pad_start' },
        { label: '填充到指定长度（后补）', value: 'pad_end' },
      ],
    },
    { key: 'count', label: '次数/目标长度', type: 'number', default: 3 },
    { key: 'char', label: '填充字符（pad 模式）', type: 'string', default: 'A' },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const action = String(ctx.config.action ?? 'repeat_suffix');
    const count = Number(ctx.config.count) || 3;
    const char = String(ctx.config.char ?? 'A');

    switch (action) {
      case 'repeat_suffix': return { output: input + input.repeat(Math.max(0, count - 1)) };
      case 'repeat_prefix': return { output: input.repeat(Math.max(0, count - 1)) + input };
      case 'pad_start': return { output: input.length >= count ? input : input.padStart(count, char[0] || 'A') };
      case 'pad_end': return { output: input.length >= count ? input : input.padEnd(count, char[0] || 'A') };
      default: return { output: input };
    }
  },
};

// ── jwt_decode ──

const jwtDecode: ModulePair = {
  definition: createDef('jwt_decode', 'JWT 解码', '解码 JWT Token 的 Payload（不验证签名）', [
    { key: 'showHeader', label: '显示 Header', type: 'boolean', default: false },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '').trim();
    const parts = input.split('.');
    if (parts.length !== 3) return { output: '错误：无效的 JWT（需要 3 段）' };

    const decode = (b64: string): unknown => {
      const r = b64.replace(/-/g, '+').replace(/_/g, '/');
      const p = r.padEnd(r.length + ((4 - (r.length % 4)) % 4), '=');
      const raw = atob(p);
      return JSON.parse(raw);
    };

    const payload = decode(parts[1]);
    const result: Record<string, unknown> = { payload };
    if (ctx.config.showHeader) result.header = decode(parts[0]);
    return { output: JSON.stringify(result, null, 2) };
  },
};

// ── combine ──

const combine: ModulePair = {
  definition: {
    id: 'combine', name: '组合', category: 'transformation',
    description: '按模板拼接多个输入源',
    inputs: [
      { id: 'input', label: '输入', type: 'string', required: true },
      { id: 'var_a', label: '变量 A', type: 'string' },
    ],
    outputs: [{ id: 'output', label: '输出', type: 'string' }],
    configFields: [
      { key: 'template', label: '模板', type: 'string', default: '{{input}}', placeholder: '{{input}} + {{var_a}}' },
    ],
  },
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const template = String(ctx.config.template ?? '{{input}}');
    const varA = String(ctx.inputs.var_a ?? '');
    const result = template
      .replace(/\{\{input\}\}/g, input)
      .replace(/\{\{var_a\}\}/g, varA);
    return { output: result };
  },
};

// ── constant ──

const constant: ModulePair = {
  definition: createDef('constant', '常量', '输出指定的常量值', [
    { key: 'value', label: '常量值', type: 'string', default: '', placeholder: '输入常量值' },
  ]),
  handler: async (ctx) => {
    return { output: String(ctx.config.value ?? '') };
  },
};

// ── Export ──

export const transformModules: ModulePair[] = [
  caseConvert, stringReverse,
  trimWhitespace, repeatPad,
  jwtDecode, combine, constant,
];
