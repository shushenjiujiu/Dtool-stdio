import React, { useEffect, useRef, useState } from 'react';
import { fetchTemplate } from '../api.js';

interface Props {
  templateId: string;
  onBack: () => void;
}

// ── WebSocket message types ──

interface StepStartMsg {
  type: 'step-start';
  stepId: string;
  module: string;
}

interface StepCompleteMsg {
  type: 'step-complete';
  stepId: string;
  output: unknown;
}

interface StepErrorMsg {
  type: 'step-error';
  stepId: string;
  error: string;
}

interface ProgressMsg {
  type: 'progress';
  percent: number;
}

interface CompleteMsg {
  type: 'complete';
  outputs: Record<string, unknown>;
  cancelled?: boolean;
}

interface ErrorMsg {
  type: 'error';
  message: string;
}

interface LogMsg {
  type: 'log';
  level: string;
  message: string;
  meta?: unknown;
}

type WsMessage = StepStartMsg | StepCompleteMsg | StepErrorMsg | ProgressMsg | CompleteMsg | ErrorMsg | LogMsg;

interface LogEntry {
  kind: 'step-start' | 'step-complete' | 'step-error' | 'log' | 'error';
  stepId?: string;
  message: string;
  timestamp: number;
}

interface ParamValue {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  description?: string;
  options?: Array<{ label: string; value: string }>;
  min?: number;
  max?: number;
}

// ── Component ──

export function TemplateRun({ templateId, onBack }: Props) {
  const [template, setTemplate] = useState<{
    name: string;
    description: string;
    params: ParamValue[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Param form state
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(0);
  const [finished, setFinished] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Load template
  useEffect(() => {
    fetchTemplate(templateId)
      .then((t) => {
        setTemplate({
          name: t.name,
          description: t.description,
          params: t.params as ParamValue[],
        });
        // Set default values
        const defaults: Record<string, unknown> = {};
        for (const p of t.params as ParamValue[]) {
          defaults[p.id] = p.default ?? (p.type === 'string' ? '' : p.type === 'number' ? 1 : '');
        }
        setParamValues(defaults);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [templateId]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── Execute ──

  const handleExecute = () => {
    if (running) return;
    setLogs([]);
    setProgress(0);
    setFinished(false);
    setRunning(true);

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'execute',
        template: { /* rough shape — backend will parse what it needs */ },
        params: paramValues,
      }));
    };

    ws.onmessage = (event) => {
      const msg: WsMessage = JSON.parse(event.data);

      switch (msg.type) {
        case 'step-start':
          addLog('step-start', msg.stepId, `▶ ${msg.module}`);
          break;
        case 'step-complete':
          addLog('step-complete', msg.stepId, `✔ ${msg.stepId}`);
          break;
        case 'step-error':
          addLog('step-error', msg.stepId, `✘ ${msg.error}`);
          break;
        case 'progress':
          setProgress(msg.percent);
          break;
        case 'log':
          addLog('log', undefined, `[${msg.level}] ${msg.message}`);
          break;
        case 'complete':
          addLog('step-complete', undefined, msg.cancelled ? '⏹ 已取消' : '✅ 执行完成');
          setProgress(100);
          setFinished(true);
          setRunning(false);
          break;
        case 'error':
          addLog('error', undefined, `❌ ${msg.message}`);
          setRunning(false);
          break;
      }
    };

    ws.onerror = () => {
      addLog('error', undefined, '❌ WebSocket 连接失败');
      setRunning(false);
    };

    ws.onclose = () => {
      setRunning(false);
    };

    function addLog(kind: LogEntry['kind'], stepId?: string, message?: string) {
      setLogs((prev) => [...prev, {
        kind,
        stepId,
        message: message || '',
        timestamp: Date.now(),
      }]);
    }
  };

  const handleCancel = () => {
    wsRef.current?.send(JSON.stringify({ type: 'cancel' }));
  };

  // ── Loading / Error ──

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 48, color: '#888' }}>⏳ 加载模板...</div>;
  }

  if (error || !template) {
    return (
      <div>
        <button onClick={onBack} style={backBtnStyle}>← 返回</button>
        <div style={{ textAlign: 'center', padding: 48, color: '#c62828' }}>
          ❌ {error || '模板加载失败'}
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} style={backBtnStyle}>← 返回模板列表</button>

      <div style={{ background: '#fff', borderRadius: 12, padding: 24, marginTop: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <h2 style={{ margin: '0 0 4px' }}>{template.name}</h2>
        <p style={{ color: '#666', fontSize: 14, margin: '0 0 20px' }}>{template.description}</p>

        {/* Param form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {template.params.map((param) => (
            <div key={param.id}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#333' }}>
                {param.label}
                {param.required && <span style={{ color: '#c62828', marginLeft: 2 }}>*</span>}
              </label>
              {param.description && (
                <p style={{ fontSize: 11, color: '#999', margin: '0 0 4px' }}>{param.description}</p>
              )}
              {param.type === 'textarea' ? (
                <textarea
                  value={String(paramValues[param.id] || '')}
                  onChange={(e) => setParamValues((v) => ({ ...v, [param.id]: e.target.value }))}
                  placeholder={param.placeholder}
                  rows={4}
                  style={inputStyle}
                />
              ) : param.type === 'select' ? (
                <select
                  value={String(paramValues[param.id] || '')}
                  onChange={(e) => setParamValues((v) => ({ ...v, [param.id]: e.target.value }))}
                  style={inputStyle}
                >
                  {param.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : param.type === 'number' ? (
                <input
                  type="number"
                  value={Number(paramValues[param.id]) || 0}
                  onChange={(e) => setParamValues((v) => ({ ...v, [param.id]: Number(e.target.value) }))}
                  min={param.min}
                  max={param.max}
                  style={inputStyle}
                />
              ) : (
                <input
                  type="text"
                  value={String(paramValues[param.id] || '')}
                  onChange={(e) => setParamValues((v) => ({ ...v, [param.id]: e.target.value }))}
                  placeholder={param.placeholder}
                  style={inputStyle}
                />
              )}
            </div>
          ))}
        </div>

        {/* Execute button */}
        <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
          <button
            onClick={handleExecute}
            disabled={running}
            style={{
              padding: '10px 28px',
              backgroundColor: running ? '#ccc' : '#1a1a2e',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 15,
              cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            {running ? '⏳ 执行中...' : '▶ 执行'}
          </button>
          {running && (
            <button
              onClick={handleCancel}
              style={{
                padding: '10px 20px',
                backgroundColor: '#c62828',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              ⏹ 取消
            </button>
          )}
        </div>

        {/* Progress bar */}
        {running || finished ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>进度: {progress}%</div>
            <div style={{ height: 6, backgroundColor: '#e0e0e0', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                backgroundColor: progress === 100 ? '#43a047' : '#1976d2',
                borderRadius: 3,
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        ) : null}

        {/* Log output */}
        {logs.length > 0 && (
          <div style={{
            marginTop: 20,
            backgroundColor: '#1a1a2e',
            borderRadius: 8,
            padding: 16,
            maxHeight: 400,
            overflowY: 'auto',
            fontFamily: 'monospace',
            fontSize: 12,
            lineHeight: 1.6,
          }}>
            {logs.map((entry, i) => (
              <div key={i} style={{
                color: entry.kind === 'step-error' || entry.kind === 'error'
                  ? '#ef5350'
                  : entry.kind === 'step-start'
                  ? '#42a5f5'
                  : entry.kind === 'step-complete'
                  ? '#66bb6a'
                  : '#e0e0e0',
              }}>
                {entry.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}

const backBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#1a1a2e',
  cursor: 'pointer',
  fontSize: 14,
  padding: '4px 0',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #ddd',
  fontSize: 14,
  boxSizing: 'border-box',
};
