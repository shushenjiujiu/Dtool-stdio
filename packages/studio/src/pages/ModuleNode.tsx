/**
 * ModuleNode — React Flow custom node representing a module on the 2D canvas.
 *
 * Visual: rounded rectangle with category color strip, name, description,
 * conditional input handle (left) and output handle (right) based on I/O type.
 *
 * I/O types:
 *   noInput    → hides input handles (data-generating nodes)
 *   multiInput → shows multiple input handles + add button
 *   noOutput   → hides output handles (terminal nodes)
 */

import React, { memo } from 'react';
import { Handle, Position, NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import type { ModuleCatalogItem } from '../modules.js';

// ── Port definition ────────────────────────────────────────────────────────

export interface PortDef {
  id: string;
  label: string;
  type: string;
}

export interface ModuleNodeData extends Record<string, unknown> {
  module: ModuleCatalogItem;
  label: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /** Converted pipeline config values (key → value) */
  params?: Record<string, unknown>;
  /** Callback: request adding a new input port (for multi-input nodes) */
  onAddInput?: (nodeId: string) => void;
}

// ── Category colors ────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, { bg: string; border: string; strip: string }> = {
  io:          { bg: '#e3f2fd', border: '#90caf9', strip: '#42a5f5' },
  encoding:    { bg: '#e8f5e9', border: '#a5d6a7', strip: '#66bb6a' },
  injection:   { bg: '#ffebee', border: '#ef9a9a', strip: '#ef5350' },
  transformation: { bg: '#fff3e0', border: '#ffcc80', strip: '#ff9800' },
  wrapping:    { bg: '#f3e5f5', border: '#ce93d8', strip: '#ab47bc' },
};

const DEFAULT_COLORS = { bg: '#f5f5f5', border: '#ccc', strip: '#999' };

// ── Handle style helpers ───────────────────────────────────────────────────

const sourceHandleStyle = (color: string): React.CSSProperties => ({
  width: 10, height: 10,
  background: color,
  border: `2px solid ${color}`,
  borderRadius: 5,
});

const targetHandleStyle = (color: string): React.CSSProperties => ({
  width: 10, height: 10,
  background: '#fff',
  border: `2px solid ${color}`,
  borderRadius: 5,
});

const disabledHandleStyle: React.CSSProperties = {
  width: 6, height: 6,
  background: '#ddd',
  border: '1px solid #ccc',
  borderRadius: 3,
  cursor: 'not-allowed',
};

// ── Component ──────────────────────────────────────────────────────────────

type ModuleNodeType = Node<ModuleNodeData>;

export const ModuleNode = memo(({ id, data, selected }: NodeProps<ModuleNodeType>) => {
  const nodeData = data;
  const mod = nodeData.module;
  const colors = CAT_COLORS[mod.category] || DEFAULT_COLORS;
  const execStatus = nodeData.execStatus as string | undefined;
  const hasInputs = !mod.noInput;
  const hasOutputs = !mod.noOutput;
  const isMultiInput = !!mod.multiInput;

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 8,
        border: `1.5px solid ${
          execStatus === 'running' ? '#f59e0b'
          : execStatus === 'completed' ? '#66bb6a'
          : execStatus === 'error' ? '#ef5350'
          : selected ? '#6a4c93' : colors.border
        }`,
        borderTop: `3px solid ${colors.strip}`,
        boxShadow: selected
          ? '0 4px 16px rgba(106,76,147,0.25)'
          : '0 1px 3px rgba(0,0,0,0.08)',
        minWidth: 140,
        fontSize: 12,
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
    >
      <NodeResizer
        minWidth={120}
        minHeight={50}
        isVisible={selected}
        lineStyle={{ borderColor: '#6a4c93' }}
        handleStyle={{ width: 8, height: 8, background: '#6a4c93', border: '2px solid #fff' }}
      />

      {/* ── Header ── */}
      <div style={{
        padding: '6px 10px 4px',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        {/* IO badge */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 16, height: 16, borderRadius: 8,
          background: colors.strip, color: '#fff',
          fontSize: 8, fontWeight: 700,
          flexShrink: 0,
        }}>
          {mod.noInput ? 'S' : mod.noOutput ? 'T' : mod.multiInput ? 'M' : mod.category.slice(0, 1).toUpperCase()}
        </span>
        <span style={{
          fontWeight: 600, color: '#333', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          fontSize: 11,
        }}>
          {nodeData.label || mod.name}
        </span>
        {mod.noInput && <span style={{ fontSize: 9, color: colors.strip, fontWeight: 500 }}>源</span>}
        {mod.noOutput && <span style={{ fontSize: 9, color: '#999', fontWeight: 500 }}>终</span>}
        {mod.multiInput && <span style={{ fontSize: 9, color: '#ff9800', fontWeight: 500 }}>多入</span>}
        {execStatus === 'running' && (
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#f59e0b', animation: 'pulse 1s infinite' }} />
        )}
        {execStatus === 'completed' && <span style={{ fontSize: 10, color: '#66bb6a' }}>✓</span>}
        {execStatus === 'error' && <span style={{ fontSize: 10, color: '#ef5350' }}>✗</span>}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: `1px solid ${colors.border}30`, margin: '0 4px' }} />

      {/* ── Ports row ── */}
      <div style={{
        padding: '4px 10px 6px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'stretch',
        position: 'relative', minHeight: 20,
      }}>
        {/* Input side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}>
          {!hasInputs && (
            <span style={{ fontSize: 9, color: '#ddd', fontStyle: 'italic' }}>自生成</span>
          )}
          {hasInputs && nodeData.inputs.map((port, i) => (
            <div key={port.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Handle
                type="target"
                position={Position.Left}
                id={port.id}
                style={targetHandleStyle(colors.strip)}
              />
              {nodeData.inputs.length > 1 && (
                <span style={{ fontSize: 9, color: '#888' }}>{port.label}</span>
              )}
            </div>
          ))}
          {isMultiInput && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                nodeData.onAddInput?.(id);
              }}
              title="添加输入端口"
              style={{
                width: 20, height: 20, borderRadius: 10,
                border: '1px dashed #ff9800', background: '#fff8e1',
                cursor: 'pointer', fontSize: 14, lineHeight: '18px',
                color: '#ff9800', padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              +
            </button>
          )}
        </div>

        {/* Output side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center', alignItems: 'flex-end' }}>
          {!hasOutputs && (
            <span style={{ fontSize: 9, color: '#ddd', fontStyle: 'italic' }}>终端</span>
          )}
          {hasOutputs && nodeData.outputs.map((port, i) => (
            <div key={port.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {nodeData.outputs.length > 1 && (
                <span style={{ fontSize: 9, color: '#888' }}>{port.label}</span>
              )}
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                style={sourceHandleStyle(colors.strip)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Description (collapsed) ── */}
      <div style={{
        padding: '0 10px 6px',
        fontSize: 9, color: '#bbb',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {mod.description}
      </div>
    </div>
  );
});

ModuleNode.displayName = 'ModuleNode';
