/**
 * ModuleNode — React Flow custom node representing a module on the 2D canvas.
 *
 * Visual: rounded rectangle with category color strip, name, description,
 * input handle (left) and output handle (right).
 */

import React, { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
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

// ── Component ──────────────────────────────────────────────────────────────

type ModuleNodeType = Node<ModuleNodeData>;

export const ModuleNode = memo(({ data, selected }: NodeProps<ModuleNodeType>) => {
  const nodeData = data;
  const mod = nodeData.module;
  const colors = CAT_COLORS[mod.category] || DEFAULT_COLORS;
  const execStatus = nodeData.execStatus as string | undefined;

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
        minWidth: 160,
        maxWidth: 200,
        fontSize: 12,
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
    >
      {/* ── Header ── */}
      <div style={{
        padding: '6px 10px 4px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {/* IO badge */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: 9,
          background: colors.strip, color: '#fff',
          fontSize: 9, fontWeight: 700,
        }}>
          {mod.category === 'io' ? (mod.id === 'input' ? 'IN' : 'OUT')
            : mod.category.slice(0, 1).toUpperCase()}
        </span>
        <span style={{ fontWeight: 600, color: '#333', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {nodeData.label || mod.name}
        </span>
        {execStatus === 'running' && (
          <span style={{
            width: 8, height: 8, borderRadius: 4,
            background: '#f59e0b', animation: 'pulse 1s infinite',
          }} />
        )}
        {execStatus === 'completed' && <span style={{ fontSize: 10, color: '#66bb6a' }}>✓</span>}
        {execStatus === 'error' && <span style={{ fontSize: 10, color: '#ef5350' }}>✗</span>}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: `1px solid ${colors.border}30`, margin: '0 4px' }} />

      {/* ── Ports row ── */}
      <div style={{
        padding: '4px 10px 6px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        position: 'relative',
      }}>
        {/* Input side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nodeData.inputs.map((port, i) => (
            <div key={port.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Handle
                type="target"
                position={Position.Left}
                id={port.id}
                style={{
                  position: 'relative',
                  left: 0, transform: 'none',
                  width: 8, height: 8,
                  background: '#fff',
                  border: `2px solid ${colors.strip}`,
                  borderRadius: 4,
                }}
              />
              <span style={{ fontSize: 10, color: '#888' }}>{port.label}</span>
            </div>
          ))}
          {nodeData.inputs.length === 0 && (
            <span style={{ fontSize: 10, color: '#ccc' }}>—</span>
          )}
        </div>

        {/* Output side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
          {nodeData.outputs.map((port, i) => (
            <div key={port.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: '#888' }}>{port.label}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                style={{
                  position: 'relative',
                  right: 0, transform: 'none',
                  width: 8, height: 8,
                  background: colors.strip,
                  border: `2px solid ${colors.strip}`,
                  borderRadius: 4,
                }}
              />
            </div>
          ))}
          {nodeData.outputs.length === 0 && (
            <span style={{ fontSize: 10, color: '#ccc' }}>—</span>
          )}
        </div>
      </div>

      {/* ── Description (collapsed) ── */}
      <div style={{
        padding: '0 10px 6px',
        fontSize: 10, color: '#bbb',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {mod.description}
      </div>
    </div>
  );
});

ModuleNode.displayName = 'ModuleNode';
