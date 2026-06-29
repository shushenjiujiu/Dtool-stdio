/**
 * Encoding/decoding modules
 *
 * Ported from old dtool with ModuleHandler adapter pattern.
 */

import type { ModuleDef, ModuleHandler } from '../types/index.js';

type ModulePair = { definition: ModuleDef; handler: ModuleHandler };

// ── Helper ──

function createDef(id: string, name: string, description: string, configFields?: ModuleDef['configFields']): ModuleDef {
  return {
    id,
    name,
    category: 'encoding',
    description,
    inputs: [{ id: 'input', label: '输入', type: 'string', required: true }],
    outputs: [{ id: 'output', label: '输出', type: 'string' }],
    configFields: configFields ?? [],
  };
}

// ── base64_encode ──

const base64Encode: ModulePair = {
  definition: createDef('base64_encode', 'Base64 编码', '将字符串编码为 Base64（支持 UTF-8）', [
    {
      key: 'mode', label: '变体', type: 'select', default: 'standard',
      options: [
        { label: '标准 (+/)', value: 'standard' },
        { label: 'URL 安全 (-_)', value: 'urlsafe' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const encoded = btoa(new TextEncoder().encode(input).reduce(
      (acc, byte) => acc + String.fromCharCode(byte), '',
    ));
    if (ctx.config.mode === 'urlsafe') {
      return { output: encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
    }
    return { output: encoded };
  },
};

// ── base64_decode ──

const base64Decode: ModulePair = {
  definition: createDef('base64_decode', 'Base64 解码', '将 Base64 字符串解码为原始文本'),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const restored = input.replace(/-/g, '+').replace(/_/g, '/');
    const binaryStr = atob(restored);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return { output: new TextDecoder().decode(bytes) };
  },
};

// ── url_encode ──

const urlEncode: ModulePair = {
  definition: createDef('url_encode', 'URL 编码', '对字符串进行 URL 百分号编码', [
    {
      key: 'mode', label: '编码模式', type: 'select', default: 'component',
      options: [
        { label: '完整编码 (encodeURIComponent)', value: 'component' },
        { label: '仅保留 ASCII (encodeURI)', value: 'uri' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    return { output: ctx.config.mode === 'uri' ? encodeURI(input) : encodeURIComponent(input) };
  },
};

// ── hex_encode ──

const hexEncode: ModulePair = {
  definition: createDef('hex_encode', 'Hex 编码', '将字符串编码为十六进制字符串', [
    {
      key: 'separator', label: '分隔符', type: 'select', default: 'none',
      options: [
        { label: '无分隔符', value: 'none' },
        { label: '空格', value: ' ' },
        { label: '\\x 前缀', value: '\\x' },
        { label: '0x 前缀', value: '0x' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const bytes = new TextEncoder().encode(input);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0'));
    switch (ctx.config.separator) {
      case ' ': return { output: hex.join(' ') };
      case '\\x': return { output: hex.map((h) => `\\x${h}`).join('') };
      case '0x': return { output: hex.map((h) => `0x${h}`).join(', ') };
      default: return { output: hex.join('') };
    }
  },
};

// ── hex_decode ──

const hexDecode: ModulePair = {
  definition: createDef('hex_decode', 'Hex 解码', '将十六进制字符串解码为原始文本'),
  handler: async (ctx) => {
    let cleaned = String(ctx.inputs.input ?? '');
    cleaned = cleaned.replace(/\s+/g, '').replace(/\\x/gi, '').replace(/0x/gi, '').replace(/,/g, '');
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < cleaned.length; i += 2) {
      bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16);
    }
    return { output: new TextDecoder().decode(bytes) };
  },
};

// ── hex_escape ──

const hexEscape: ModulePair = {
  definition: createDef('hex_escape', 'Hex 转义', '将字符串转为各种 Hex 转义格式', [
    {
      key: 'format', label: '格式', type: 'select', default: '0x',
      options: [
        { label: '0x... (MySQL hex)', value: '0x' },
        { label: '\\x... (C/Python)', value: 'backslash_x' },
        { label: '&#x... (HTML entity)', value: 'html_hex' },
        { label: '%xx (URL编码)', value: 'url' },
        { label: '\\u00xx (Unicode)', value: 'unicode' },
      ],
    },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const format = String(ctx.config.format ?? '0x');
    const bytes = new TextEncoder().encode(input);
    switch (format) {
      case '0x':
        return { output: '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('') };
      case 'backslash_x':
        return { output: Array.from(bytes).map((b) => '\\x' + b.toString(16).padStart(2, '0')).join('') };
      case 'html_hex':
        return { output: input.split('').map((c) => '&#x' + c.charCodeAt(0).toString(16) + ';').join('') };
      case 'url':
        return { output: Array.from(bytes).map((b) => '%' + b.toString(16).padStart(2, '0').toUpperCase()).join('') };
      case 'unicode':
        return { output: input.split('').map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('') };
      default:
        return { output: input };
    }
  },
};

// ── charcode_encode ──

const charcodeEncode: ModulePair = {
  definition: createDef('charcode_encode', '字符编码转换', '将字符串转为字符代码序列', [
    {
      key: 'base', label: '进制', type: 'select', default: 'dec',
      options: [
        { label: '十进制 (65)', value: 'dec' },
        { label: '十六进制 (0x41)', value: 'hex' },
        { label: 'SQL CHAR(65)', value: 'sql_char' },
        { label: 'JS String.fromCharCode()', value: 'js' },
      ],
    },
    { key: 'separator', label: '分隔符', type: 'string', default: ',' },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const base = String(ctx.config.base ?? 'dec');
    const sep = String(ctx.config.separator ?? ',');
    const codes = input.split('').map((c) => c.charCodeAt(0));
    switch (base) {
      case 'dec': return { output: codes.join(sep) };
      case 'hex': return { output: codes.map((c) => '0x' + c.toString(16).toUpperCase()).join(sep) };
      case 'sql_char': return { output: 'CHAR(' + codes.join(') + CHAR(') + ')' };
      case 'js': return { output: 'String.fromCharCode(' + codes.join(sep) + ')' };
      default: return { output: codes.join(sep) };
    }
  },
};

// ── html_entity_encode ──

const htmlEntityEncode: ModulePair = {
  definition: createDef('html_entity_encode', 'HTML 实体编码', '将特殊字符编码为 HTML/XML 实体'),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    return {
      output: input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    };
  },
};

// ── html_entity_decode (Node.js compatible, no DOM) ──

const htmlEntityDecode: ModulePair = {
  definition: createDef('html_entity_decode', 'HTML 实体解码', '将 HTML 实体解码回原始字符'),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    return {
      output: input
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10))),
    };
  },
};

// ── unicode_escape ──

const unicodeEscape: ModulePair = {
  definition: createDef('unicode_escape', 'Unicode 转义', '将非 ASCII 字符转为 \\uXXXX 转义序列', [
    {
      key: 'prefix', label: '前缀格式', type: 'select', default: '\\u',
      options: [
        { label: '\\u (JavaScript)', value: '\\u' },
        { label: '%u (URI 风格)', value: '%u' },
        { label: 'U+ (标准)', value: 'U+' },
      ],
    },
    { key: 'encodeAscii', label: '编码 ASCII 字符', type: 'boolean', default: false },
  ]),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    const prefix = String(ctx.config.prefix ?? '\\u');
    const encodeAll = ctx.config.encodeAscii === true;
    return {
      output: input.split('').map((char) => {
        const code = char.charCodeAt(0);
        if (!encodeAll && code < 128) return char;
        return `${prefix}${code.toString(16).padStart(4, '0')}`;
      }).join(''),
    };
  },
};

// ── unicode_unescape ──

const unicodeUnescape: ModulePair = {
  definition: createDef('unicode_unescape', 'Unicode 反转义', '将 \\uXXXX/%uXXXX/U+XXXX 还原为字符'),
  handler: async (ctx) => {
    const input = String(ctx.inputs.input ?? '');
    return {
      output: input.replace(
        /(?:\\u|%u|U\+)([0-9a-fA-F]{4})/g,
        (_, hex) => String.fromCharCode(parseInt(hex, 16)),
      ),
    };
  },
};

// ── Export all ──

export const encodeModules: ModulePair[] = [
  base64Encode, base64Decode,
  urlEncode,
  hexEncode, hexDecode, hexEscape,
  charcodeEncode,
  htmlEntityEncode, htmlEntityDecode,
  unicodeEscape, unicodeUnescape,
];
