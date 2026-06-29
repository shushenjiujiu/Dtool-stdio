/**
 * Wrapping modules
 *
 * Ported from old dtool with ModuleHandler adapter pattern.
 */

import type { ModuleDef, ModuleHandler } from '../types/index.js';

type ModulePair = { definition: ModuleDef; handler: ModuleHandler };

function createDef(id: string, name: string, description: string, configFields?: ModuleDef['configFields']): ModuleDef {
  return {
    id, name, category: 'wrapping', description,
    inputs: [{ id: 'input', label: '输入', type: 'string', required: true }],
    outputs: [{ id: 'output', label: '输出', type: 'string' }],
    configFields: configFields ?? [],
  };
}

// ── backtick_wrap ──

const backtickWrap: ModulePair = {
  definition: createDef('backtick_wrap', '反引号包裹', '用反引号包裹输入', [
    {
      key: 'wrap', label: '包裹方式', type: 'select', default: 'inline',
      options: [
        { label: '内联 `code`', value: 'inline' },
        { label: '代码块 ```', value: 'block' },
        { label: 'Shell 反引号', value: 'shell' },
      ],
    },
    { key: 'lang', label: '代码语言（代码块模式）', type: 'string', default: '', placeholder: 'javascript, python, sql...' },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const wrap = String(ctx.config.wrap ?? 'inline');
    const lang = String(ctx.config.lang ?? '');
    switch (wrap) {
      case 'block': return { output: '```' + lang + '\n' + input + '\n```' };
      case 'shell': return { output: '`' + input + '`' };
      case 'inline':
      default: return { output: '`' + input + '`' };
    }
  },
};

// ── form_url_encode ──

const formUrlEncode: ModulePair = {
  definition: createDef('form_url_encode', '表单 URL 编码', '将 key:value 格式编码为 application/x-www-form-urlencoded'),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    return {
      output: input.split('\n')
        .filter((l) => l.includes(':'))
        .map((l) => {
          const [key, ...rest] = l.split(':');
          return `${encodeURIComponent(key.trim())}=${encodeURIComponent(rest.join(':').trim())}`;
        })
        .join('&'),
    };
  },
};

// ── json_to_querystring ──

const jsonToQueryString: ModulePair = {
  definition: createDef('json_to_querystring', 'JSON → 查询字符串', '将 JSON 对象转换为 URL 查询字符串', [
    { key: 'encodeValues', label: 'URL 编码值', type: 'boolean', default: true },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    try {
      const obj = JSON.parse(input) as Record<string, unknown>;
      const parts: string[] = [];
      const encode = ctx.config.encodeValues !== false;
      for (const [key, value] of Object.entries(obj)) {
        const strVal = String(value);
        parts.push(`${encodeURIComponent(key)}=${encode ? encodeURIComponent(strVal) : strVal}`);
      }
      return { output: parts.join('&') };
    } catch {
      return { output: '错误：输入不是有效的 JSON' };
    }
  },
};

// ── querystring_to_json ──

const queryStringToJson: ModulePair = {
  definition: createDef('querystring_to_json', '查询字符串 → JSON', '将 URL 查询字符串解析为 JSON 对象', [
    { key: 'pretty', label: '格式化', type: 'boolean', default: true },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const sp = new URLSearchParams(input);
    const obj: Record<string, string> = {};
    for (const [key, value] of sp.entries()) {
      obj[key] = value;
    }
    const pretty = ctx.config.pretty !== false;
    return { output: pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj) };
  },
};

// ── wrap_jsonrpc ──

const wrapJsonRpc: ModulePair = {
  definition: createDef('wrap_jsonrpc', 'JSON-RPC 封装', '将输入包裹为 JSON-RPC 2.0 请求体', [
    { key: 'method', label: '方法名', type: 'string', default: 'call', placeholder: 'rpc.methodName' },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const method = String(ctx.config.method ?? 'call');
    const body = { jsonrpc: '2.0', method, params: [input], id: 1 };
    return { output: JSON.stringify(body, null, 2) };
  },
};

// ── Export ──

export const wrapModules: ModulePair[] = [
  backtickWrap, formUrlEncode,
  jsonToQueryString, queryStringToJson,
  wrapJsonRpc,
];
