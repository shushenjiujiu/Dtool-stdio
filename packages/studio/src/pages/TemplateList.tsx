import React, { useEffect, useState } from 'react';
import { fetchTemplates } from '../api.js';

interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  tags?: string[];
  author?: string;
  created?: string;
}

interface Props {
  onSelect: (id: string) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  '编码/解码': '#e3f2fd',
  '格式转换': '#f3e5f5',
  '合并/拆分': '#e8f5e9',
  '循环/批量': '#fff3e0',
  '安全检测': '#ffebee',
  '工具': '#e0f2f1',
  '自定义': '#f5f5f5',
};

export function TemplateList({ onSelect }: Props) {
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  useEffect(() => {
    fetchTemplates()
      .then(setTemplates)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = templates.filter((t) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: '#888' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
        正在加载模板列表...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: '#c62828' }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>❌</div>
        <p>无法加载模板：{error}</p>
        <p style={{ fontSize: 12, color: '#999' }}>
          请确认后端服务已启动（默认 http://localhost:3001）
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>模板库 ({templates.length})</h2>
        <input
          type="text"
          placeholder="搜索模板..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #ddd',
            fontSize: 14,
            width: 250,
          }}
        />
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 48, color: '#999' }}>
          {filter ? '没有匹配的模板' : '模板库为空，请先添加模板文件'}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {filtered.map((t) => (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              cursor: 'pointer',
              border: '1px solid #eee',
              transition: 'box-shadow 0.2s, transform 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <strong style={{ fontSize: 16 }}>{t.name}</strong>
              <span style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 10,
                backgroundColor: CATEGORY_COLORS[t.category] || '#f5f5f5',
                color: '#555',
                whiteSpace: 'nowrap',
              }}>
                {t.category}
              </span>
            </div>
            <p style={{ fontSize: 13, color: '#666', margin: '4px 0 8px', lineHeight: 1.5 }}>
              {t.description}
            </p>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#999' }}>
              {t.author && <span>👤 {t.author}</span>}
              {t.tags && t.tags.slice(0, 3).map((tag) => (
                <span key={tag} style={{ backgroundColor: '#f0f0f0', padding: '1px 6px', borderRadius: 4 }}>
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
