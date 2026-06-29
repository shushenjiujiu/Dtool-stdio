import React, { useState } from 'react';
import { TemplateList } from './pages/TemplateList.js';
import { TemplateRun } from './pages/TemplateRun.js';
import { Editor } from './pages/Editor.js';
import { CanvasEditor } from './pages/CanvasEditor.js';

type Page = 'templates' | 'run' | 'editor' | 'canvas';

interface NavState {
  page: Page;
  templateId?: string;
}

export function App() {
  // Default page is now 'editor' — empty module is the starting point
  const [nav, setNav] = useState<NavState>({ page: 'editor' });

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
      {/* Nav bar */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '12px 24px',
        backgroundColor: '#1a1a2e',
        color: '#fff',
        fontSize: 14,
      }}>
        <strong style={{ fontSize: 18, marginRight: 8 }}>dtool Studio</strong>
        <button
          onClick={() => setNav({ page: 'editor' })}
          style={navBtnStyle(nav.page === 'editor')}
        >
          📋 管道
        </button>
        <button
          onClick={() => setNav({ page: 'canvas' })}
          style={navBtnStyle(nav.page === 'canvas')}
        >
          🎨 画布
        </button>
        <button
          onClick={() => setNav({ page: 'templates' })}
          style={navBtnStyle(nav.page === 'templates')}
        >
          📋 模板库
        </button>

        <div style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.6 }}>
          v0.1
        </div>
      </nav>

      {/* Page content */}
      <div style={{ padding: 24 }}>
        {nav.page === 'editor' && <Editor />}
        {nav.page === 'canvas' && <CanvasEditor />}
        {nav.page === 'templates' && (
          <TemplateList
            onSelect={(id) => setNav({ page: 'run', templateId: id })}
          />
        )}
        {nav.page === 'run' && nav.templateId && (
          <TemplateRun
            templateId={nav.templateId}
            onBack={() => setNav({ page: 'templates' })}
          />
        )}
      </div>
    </div>
  );
}

function navBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
    border: 'none',
    color: '#fff',
    padding: '6px 14px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
  };
}
