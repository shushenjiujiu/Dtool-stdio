/**
 * CompositeNode — React Flow custom node for composite/pipeline modules.
 *
 * Shows a folder-like block with derived ports. Double-click to enter sub-editor.
 * Visually distinct from ModuleNode: teal color scheme, 📁 icon.
 */

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CompositeNodeData } from './CanvasEditor.js';

const COLORS = {
  bg: '#e0f2f1',
  border: '#80cbc4',
  strip: '#00897b',
};

export const CompositeNode = memo(({ data, selected }: NodeProps) => {
  const nodeData = data as CompositeNodeData;
  const stepCount = nodeData.internalNodes?.length ?? 0;
  const execStatus = (nodeData as any).execStatus as string | undefined;

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 8,
        border: `1.5px solid ${
          execStatus === 'running' ? '#f59e0b'
          : execStatus === 'completed' ? '#66bb6a'
          : execStatus === 'error' ? '#ef5350'
          : selected ? '#6a4c93' : COLORS.border
        }`,
        borderTop: `3px solid ${COLORS.strip}`,
        boxShadow: selected
          ? '0 4px 16px rgba(106,76,147,0.25)'
          : '0 1px 3px rgba(0,0,0,0.08)',
        minWidth: 160,
        maxWidth: 220,
        fontSize: 12,
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '6px 10px 4px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 18, height: 18, borderRadius: 9,
          background: COLORS.strip, color: '#fff',
          fontSize: 9, fontWeight: 700,
        }}>
          📁
        </span>
        <span style={{
          fontWeight: 600, color: '#333', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {nodeData.label}
        </span>
        {execStatus === 'running' && (
          <span style={{ width: 8, height: 8, borderRadius: 4, background: '#f59e0b' }} />
        )}
        {execStatus === 'completed' && <span style={{ fontSize: 10, color: '#66bb6a' }}>✓</span>}
        {execStatus === 'error' && <span style={{ fontSize: 10, color: '#ef5350' }}>✗</span>}
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${COLORS.border}30`, margin: '0 4px' }} />

      {/* Sub-step count */}
      <div style={{
        padding: '2px 10px',
        fontSize: 10, color: COLORS.strip,
      }}>
        {stepCount} 个内部节点
      </div>

      {/* Ports row */}
      <div style={{
        padding: '4px 10px 6px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        position: 'relative',
      }}>
        {/* Input ports */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nodeData.inputs.map((port) => (
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
                  border: `2px solid ${COLORS.strip}`,
                  borderRadius: 4,
                }}
              />
              <span style={{ fontSize: 9, color: '#888', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {port.label}
              </span>
            </div>
          ))}
          {nodeData.inputs.length === 0 && (
            <span style={{ fontSize: 10, color: '#ccc' }}>—</span>
          )}
        </div>

        {/* Output ports */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
          {nodeData.outputs.map((port) => (
            <div key={port.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 9, color: '#888', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {port.label}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                style={{
                  position: 'relative',
                  right: 0, transform: 'none',
                  width: 8, height: 8,
                  background: COLORS.strip,
                  border: `2px solid ${COLORS.strip}`,
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
    </div>
  );
});

CompositeNode.displayName = 'CompositeNode';
