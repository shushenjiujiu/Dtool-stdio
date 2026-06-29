/**
 * I/O modules — input and output
 *
 * These are dtool Studio-specific modules not found in the old dtool.
 * They handle data entry and display in the frontend.
 */

import type { ModuleDef, ModuleHandler } from '../types/index.js';

// ── input ──

const inputDef: ModuleDef = {
  id: 'input',
  name: '输入',
  category: 'io',
  description: '接收外部输入数据，作为管道的起点',
  inputs: [],
  outputs: [{ id: 'output', label: '输出', type: 'string' }],
  configFields: [
    { key: 'text', label: '输入文本', type: 'string', required: true, placeholder: '输入数据' },
  ],
};

const inputHandler: ModuleHandler = async (ctx) => {
  // Prefer ctx.inputs.input (populated from _input by executeModule),
  // fall back to config.text for backward compat
  const value = ctx.inputs.input ?? ctx.config.text ?? '';
  return { output: String(value) };
};

// ── output ──

const outputDef: ModuleDef = {
  id: 'output',
  name: '输出',
  category: 'io',
  description: '展示管道最终结果',
  inputs: [{ id: 'source', label: '数据源', type: 'string', required: true }],
  outputs: [{ id: 'output', label: '输出', type: 'string' }],
  configFields: [
    { key: 'source', label: '数据源', type: 'string', required: false, placeholder: '$steps.xxx' },
  ],
};

const outputHandler: ModuleHandler = async (ctx) => {
  const value = ctx.inputs.source ?? ctx.config.source ?? '';
  return { output: String(value) };
};

// ── url_decode (not in old dtool but needed) ──

const urlDecodeDef: ModuleDef = {
  id: 'url_decode',
  name: 'URL 解码',
  category: 'encoding',
  description: '对 URL 百分号编码的字符串进行解码',
  inputs: [{ id: 'input', label: '输入', type: 'string', required: true }],
  outputs: [{ id: 'output', label: '输出', type: 'string' }],
  configFields: [
    {
      key: 'mode',
      label: '解码模式',
      type: 'select',
      default: 'component',
      options: [
        { label: 'decodeURIComponent', value: 'component' },
        { label: 'decodeURI', value: 'uri' },
      ],
    },
  ],
};

const urlDecodeHandler: ModuleHandler = async (ctx) => {
  const input = String(ctx.inputs.input ?? '');
  const mode = String(ctx.config.mode ?? 'component');
  try {
    const result = mode === 'uri' ? decodeURI(input) : decodeURIComponent(input);
    return { output: result };
  } catch {
    return { output: input };
  }
};

// ── Exports ──

export const ioModules: Array<{ definition: ModuleDef; handler: ModuleHandler }> = [
  { definition: inputDef, handler: inputHandler },
  { definition: outputDef, handler: outputHandler },
  { definition: urlDecodeDef, handler: urlDecodeHandler },
];
