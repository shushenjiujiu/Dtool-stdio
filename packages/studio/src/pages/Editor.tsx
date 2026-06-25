import React from 'react';

/**
 * Editor placeholder — Phase 2 implementation.
 *
 * This will be a DAG-based visual pipeline editor using React Flow.
 * For now, just a placeholder that acknowledges the feature is coming.
 */
export function Editor() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 80,
      color: '#999',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>✏️</div>
      <h3 style={{ color: '#555', margin: '0 0 8px' }}>可视化编辑器</h3>
      <p style={{ margin: 0, maxWidth: 400, lineHeight: 1.6, fontSize: 14 }}>
        dtool Studio 的可视化 DAG 编辑器正在开发中。
        <br />
        当前版本支持从模板列表选择模板 → 填写参数 → 执行。
      </p>
      <div style={{
        marginTop: 24,
        padding: '12px 24px',
        backgroundColor: '#f0f0f0',
        borderRadius: 8,
        fontSize: 12,
        color: '#888',
      }}>
        Phase 2 — 预计在下一轮迭代中
      </div>
    </div>
  );
}
