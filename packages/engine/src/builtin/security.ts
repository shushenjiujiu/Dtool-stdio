/**
 * Security/injection modules
 *
 * Ported from old dtool with ModuleHandler adapter pattern.
 */

import type { ModuleDef, ModuleHandler } from '../types/index.js';

type ModulePair = { definition: ModuleDef; handler: ModuleHandler };

function createDef(id: string, name: string, description: string, configFields?: ModuleDef['configFields']): ModuleDef {
  return {
    id, name, category: 'injection', description,
    inputs: [{ id: 'input', label: '输入', type: 'string', required: true }],
    outputs: [{ id: 'output', label: '输出', type: 'string' }],
    configFields: configFields ?? [],
  };
}

// ── sql_comment ──

const sqlComment: ModulePair = {
  definition: createDef('sql_comment', 'SQL 注释注入', '在 SQL 关键字之间插入注释绕过简单过滤', [
    {
      key: 'comment', label: '注释符号', type: 'select', default: '/**/',
      options: [
        { label: '/**/ (多行注释)', value: '/**/' },
        { label: '-- (行注释)', value: ' -- ' },
        { label: '# (MySQL 行注释)', value: '#' },
      ],
    },
    {
      key: 'keywords', label: '关键关键字（逗号分隔）', type: 'string',
      default: 'SELECT,FROM,WHERE,AND,OR,UNION,INSERT,UPDATE,DELETE',
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const comment = String(ctx.config.comment ?? '/**/');
    const keywords = String(ctx.config.keywords ?? 'SELECT,FROM,WHERE,AND,OR,UNION')
      .split(',').map((k: string) => k.trim()).filter(Boolean);

    let result = input;
    for (const kw of keywords) {
      const regex = new RegExp(`(${kw.slice(0, 1)})(${kw.slice(1)})`, 'gi');
      result = result.replace(regex, `$1${comment}$2`);
    }
    return { output: result };
  },
};

// ── sql_comment_block ──

const sqlCommentBlock: ModulePair = {
  definition: createDef('sql_comment_block', 'SQL 全部注释化', '在每个字符之间插入注释符号', [
    {
      key: 'comment', label: '注释符号', type: 'select', default: '/**/',
      options: [
        { label: '/**/ (多行注释)', value: '/**/' },
        { label: '-- (行注释)', value: ' -- ' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const comment = String(ctx.config.comment ?? '/**/');
    return { output: input.split('').join(comment) };
  },
};

// ── space_bypass ──

const spaceBypass: ModulePair = {
  definition: createDef('space_bypass', '空格绕过', '替换空格为其他字符以绕过基于空格的输入过滤', [
    {
      key: 'replacement', label: '替换字符', type: 'select', default: '+',
      options: [
        { label: '+ (URL 编码空格)', value: '+' },
        { label: '/**/ (SQL 注释)', value: '/**/' },
        { label: '\\t (制表符)', value: '\t' },
        { label: '%20 (URL 编码)', value: '%20' },
        { label: '%09 (URL 编码制表符)', value: '%09' },
        { label: '0x00 (空字节)', value: '\0' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const replacement = String(ctx.config.replacement ?? '+');
    return { output: input.replace(/\s+/g, replacement) };
  },
};

// ── case_obfuscate ──

const caseObfuscate: ModulePair = {
  definition: createDef('case_obfuscate', '大小写混淆', '随机改变字母大小写绕过简单 WAF', [
    {
      key: 'mode', label: '混淆模式', type: 'select', default: 'alternating',
      options: [
        { label: '交替大小写', value: 'alternating' },
        { label: '随机大小写', value: 'random' },
        { label: '全大写', value: 'upper' },
        { label: '全小写', value: 'lower' },
        { label: '首字母大写', value: 'capitalize' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const mode = String(ctx.config.mode ?? 'alternating');
    switch (mode) {
      case 'upper': return { output: input.toUpperCase() };
      case 'lower': return { output: input.toLowerCase() };
      case 'capitalize': return { output: input.replace(/\b\w/g, (c) => c.toUpperCase()) };
      case 'random': return { output: input.split('').map((c) => Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()).join('') };
      case 'alternating':
      default: return { output: input.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join('') };
    }
  },
};

// ── null_byte_inject ──

const nullByteInject: ModulePair = {
  definition: createDef('null_byte_inject', '空字节注入', '在字符串中注入空字节 (%00)', [
    {
      key: 'position', label: '插入位置', type: 'select', default: 'suffix',
      options: [
        { label: '尾部', value: 'suffix' },
        { label: '头部', value: 'prefix' },
        { label: '每字符后', value: 'after_each' },
        { label: '中间位置', value: 'middle' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const position = String(ctx.config.position ?? 'suffix');
    switch (position) {
      case 'suffix': return { output: input + '\0' };
      case 'prefix': return { output: '\0' + input };
      case 'after_each': return { output: input.split('').join('\0') + '\0' };
      case 'middle': return { output: input.slice(0, Math.floor(input.length / 2)) + '\0' + input.slice(Math.floor(input.length / 2)) };
      default: return { output: input };
    }
  },
};

// ── Export ──

export const securityModules: ModulePair[] = [
  sqlComment, sqlCommentBlock,
  spaceBypass, caseObfuscate,
  nullByteInject,
];
