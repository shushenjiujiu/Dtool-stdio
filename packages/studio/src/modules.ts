/**
 * Built-in module catalog for the editor sidebar.
 *
 * In production, this would come from GET /api/modules.
 * For now, hardcoded to match engine/src/builtin/ module registry.
 */

export interface ModuleCatalogItem {
  id: string;
  name: string;
  category: string;
  description: string;
  configFields?: Array<{
    key: string;
    label: string;
    type: string;
    default?: unknown;
    options?: Array<{ label: string; value: string }>;
  }>;
}

export const ATOMIC_MODULES: ModuleCatalogItem[] = [
  // ── I/O ──
  { id: 'input', name: '输入', category: 'io', description: '接收外部输入数据，作为管道的起点',
    configFields: [{ key: 'text', label: '输入文本', type: 'string' }] },
  { id: 'output', name: '输出', category: 'io', description: '展示管道最终结果',
    configFields: [{ key: 'source', label: '数据源', type: 'string' }] },

  // ── Encoding ──
  { id: 'base64_encode', name: 'Base64 编码', category: 'encoding', description: '将字符串编码为 Base64',
    configFields: [{ key: 'mode', label: '变体', type: 'select', default: 'standard', options: [
      { label: '标准 (+/)', value: 'standard' }, { label: 'URL 安全 (-_)', value: 'urlsafe' },
    ]}]},
  { id: 'base64_decode', name: 'Base64 解码', category: 'encoding', description: '将 Base64 解码为原始文本' },
  { id: 'url_encode', name: 'URL 编码', category: 'encoding', description: 'URL 百分号编码',
    configFields: [{ key: 'mode', label: '模式', type: 'select', default: 'component', options: [
      { label: '完整编码', value: 'component' }, { label: '仅保留 ASCII', value: 'uri' },
    ]}]},
  { id: 'url_decode', name: 'URL 解码', category: 'encoding', description: 'URL 百分号解码',
    configFields: [{ key: 'mode', label: '模式', type: 'select', default: 'component', options: [
      { label: 'decodeURIComponent', value: 'component' }, { label: 'decodeURI', value: 'uri' },
    ]}]},
  { id: 'hex_encode', name: 'Hex 编码', category: 'encoding', description: '编码为十六进制',
    configFields: [{ key: 'separator', label: '分隔符', type: 'select', default: 'none', options: [
      { label: '无', value: 'none' }, { label: '空格', value: ' ' }, { label: '\\x 前缀', value: '\\x' },
    ]}]},
  { id: 'hex_decode', name: 'Hex 解码', category: 'encoding', description: '十六进制解码为文本' },
  { id: 'html_entity_encode', name: 'HTML 实体编码', category: 'encoding', description: '特殊字符 → HTML 实体' },
  { id: 'html_entity_decode', name: 'HTML 实体解码', category: 'encoding', description: 'HTML 实体 → 原始字符' },

  // ── Security/Injection ──
  { id: 'sql_comment', name: 'SQL 注释注入', category: 'injection', description: '关键字间插入注释绕过过滤',
    configFields: [{ key: 'comment', label: '注释符号', type: 'select', default: '/**/', options: [
      { label: '/**/', value: '/**/' }, { label: '--', value: ' -- ' }, { label: '#', value: '#' },
    ]}]},
  { id: 'space_bypass', name: '空格绕过', category: 'injection', description: '替换空格绕过过滤',
    configFields: [{ key: 'replacement', label: '替换字符', type: 'select', default: '+', options: [
      { label: '+', value: '+' }, { label: '/**/', value: '/**/' }, { label: '%20', value: '%20' },
    ]}]},
  { id: 'null_byte_inject', name: '空字节注入', category: 'injection', description: '注入空字节 %00',
    configFields: [{ key: 'position', label: '位置', type: 'select', default: 'suffix', options: [
      { label: '尾部', value: 'suffix' }, { label: '头部', value: 'prefix' },
    ]}]},

  // ── Transformation ──
  { id: 'case_convert', name: '大小写转换', category: 'transformation', description: '字符串大小写转换',
    configFields: [{ key: 'mode', label: '模式', type: 'select', default: 'upper', options: [
      { label: '全大写', value: 'upper' }, { label: '全小写', value: 'lower' },
      { label: '交替', value: 'alternate' }, { label: '随机', value: 'random' },
    ]}]},
  { id: 'string_reverse', name: '字符串反转', category: 'transformation', description: '反转输入字符串' },
  { id: 'trim_whitespace', name: '清除空白', category: 'transformation', description: '清除多余空白',
    configFields: [{ key: 'mode', label: '模式', type: 'select', default: 'trim', options: [
      { label: '去首尾', value: 'trim' }, { label: '合并连续', value: 'collapse' },
      { label: '删除全部', value: 'strip' },
    ]}]},
  { id: 'jwt_decode', name: 'JWT 解码', category: 'transformation', description: '解码 JWT Payload（不验签）',
    configFields: [{ key: 'showHeader', label: '显示 Header', type: 'boolean', default: false }]},
  { id: 'combine', name: '组合', category: 'transformation', description: '按模板拼接多个输入',
    configFields: [{ key: 'template', label: '模板', type: 'string', default: '{{input}}' }]},
  { id: 'constant', name: '常量', category: 'transformation', description: '输出指定的常量值',
    configFields: [{ key: 'value', label: '常量值', type: 'string' }]},

  // ── Wrapping ──
  { id: 'backtick_wrap', name: '反引号包裹', category: 'wrapping', description: '用反引号包裹',
    configFields: [{ key: 'wrap', label: '方式', type: 'select', default: 'inline', options: [
      { label: '内联', value: 'inline' }, { label: '代码块', value: 'block' },
    ]}]},
  { id: 'json_to_querystring', name: 'JSON → 查询字符串', category: 'wrapping', description: 'JSON 转 URL 查询参数' },
  { id: 'querystring_to_json', name: '查询字符串 → JSON', category: 'wrapping', description: 'URL 查询参数转 JSON' },
];

export function getModuleByID(id: string): ModuleCatalogItem | undefined {
  return ATOMIC_MODULES.find((m) => m.id === id);
}

export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    io: '#e3f2fd',
    encoding: '#e8f5e9',
    injection: '#ffebee',
    transformation: '#fff3e0',
    wrapping: '#f3e5f5',
  };
  return colors[category] || '#f5f5f5';
}
