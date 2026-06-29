import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getModuleByID, getCategoryColor } from '../modules.js';

export interface EditorStep {
  id: string;
  moduleId: string;
  config: Record<string, unknown>;
  label?: string;
  /** Nested sub-steps (composite module body, loop body) */
  substeps?: EditorStep[];
}

/**
 * Minimal step preview for drag overlay.
 */
export function StepOverlay({ step }: { step: EditorStep }) {
  const mod = getModuleByID(step.moduleId);
  return (
    <div style={{
      padding: '8px 14px', background: '#1a1a2e', color: '#fff',
      borderRadius: 8, fontSize: 13, fontWeight: 500,
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      display: 'flex', alignItems: 'center', gap: 8,
      maxWidth: 280,
    }}>
      <span>⬡</span>
      {mod?.name || step.moduleId}
    </div>
  );
}

interface Props {
  step: EditorStep;
  index: number;
  depth?: number;
  isRunning: boolean;
  isCurrent: boolean;
  output: unknown;
  draggable?: boolean;
  removable?: boolean;
  onRemove?: () => void;
  onConfigChange: (key: string, value: unknown) => void;
  /** Called on double-click to toggle substeps expansion */
  onToggleExpand?: () => void;
  /** Expanded state (controlled from parent) */
  expanded?: boolean;
  /** Called when user clicks 'edit' on a composite module (enter sub-editor) */
  onEditSubsteps?: () => void;
}

export function StepCard({
  step, index, depth = 0, isRunning, isCurrent, output,
  draggable = true, removable = true,
  onRemove, onConfigChange, onToggleExpand, expanded = false,
  onEditSubsteps,
}: Props) {
  const [configOpen, setConfigOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const mod = getModuleByID(step.moduleId);
  const hasSubsteps = !!step.substeps && step.substeps.length > 0;

  // Sortable (dnd-kit) — only for top-level draggable
  const sortable = useSortable({ id: step.id, disabled: !draggable || depth > 0 });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const borderColor = isCurrent ? '#1976d2' : isRunning ? '#e0e0e0' : hasSubsteps ? '#d0c8e0' : '#eee';
  const bgColor = isCurrent ? '#e3f2fd' : hasSubsteps ? '#f8f6fc' : '#fff';

  return (
    <div ref={setNodeRef} style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{
        background: bgColor,
        borderRadius: 10,
        border: `2px solid ${borderColor}`,
        padding: '10px 14px',
        transition: 'border-color 0.3s, background 0.3s',
        marginLeft: depth * 20,
        position: 'relative',
      }}>
        {/* Hover edit button for composite modules */}
        {hasSubsteps && onEditSubsteps && hovered && !isRunning && (
          <button
            onClick={(e) => { e.stopPropagation(); onEditSubsteps(); }}
            style={{
              position: 'absolute', top: 8, right: 8,
              background: '#6a4c93', color: '#fff', border: 'none',
              borderRadius: 4, padding: '3px 8px', cursor: 'pointer',
              fontSize: 11, fontWeight: 500, zIndex: 2,
            }}
            title="编辑内部子步骤"
          >
            ✎ 编辑
          </button>
        )}
        {/* Header row */}
        <div {...attributes} {...listeners} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: draggable && depth === 0 ? 'grab' : 'default',
          userSelect: 'none', touchAction: 'none',
        }}
          onDoubleClick={(e) => {
            if (hasSubsteps && onEditSubsteps && !isRunning) {
              e.stopPropagation();
              onEditSubsteps();
            }
          }}
        >
          {/* Drag icon — only top-level */}
          {draggable && depth === 0 && (
            <span style={{ fontSize: 18, color: '#bbb', flexShrink: 0, lineHeight: 1 }}>
              ⋮⋮
            </span>
          )}

          {/* Expand/collapse for composite modules */}
          {hasSubsteps ? (
            <button onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, padding: '2px 4px', color: '#666',
              }}
              title={expanded ? '收拢' : '展开内部'}
            >
              {expanded ? '▼' : '▶'}
            </button>
          ) : (
            <span style={{ width: 20 }} />
          )}

          {/* Step number */}
          <div style={{
            width: 24, height: 24, borderRadius: 12,
            background: hasSubsteps ? '#6a4c93' : '#1a1a2e',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 600, flexShrink: 0,
          }}>
            {index + 1}
          </div>

          {/* Module info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 500, fontSize: 14 }}>
                {mod?.name || step.moduleId}
              </span>
              {mod?.category && (
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 4,
                  backgroundColor: getCategoryColor(mod.category),
                  color: '#555',
                }}>
                  {mod.category}
                </span>
              )}
              {hasSubsteps && (
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#e8e0f0', color: '#6a4c93' }}>
                  复合
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {step.moduleId}{hasSubsteps ? ` • ${step.substeps!.length} 个子步骤` : ''}
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
            {(mod?.configFields?.length ?? 0) > 0 && (
              <button onClick={() => setConfigOpen(!configOpen)}
                style={btnStyle} title="配置">
                {configOpen ? '▲' : '▼'} 配置
              </button>
            )}
            {hasSubsteps && (
              <button onClick={() => onToggleExpand?.()}
                style={btnStyle} title={expanded ? '收拢' : '展开'}>
                {expanded ? '△' : '▽'} {step.substeps!.length}
              </button>
            )}
            {removable && onRemove && (
              <button onClick={onRemove}
                style={{ ...btnStyle, color: '#c62828' }} title="删除">
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Expandable config panel */}
        {configOpen && mod?.configFields && mod.configFields.length > 0 && (
          <div style={{
            marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0',
            display: 'flex', flexDirection: 'column', gap: 8, cursor: 'default',
          }} onClick={(e) => e.stopPropagation()}>
            {mod.configFields.map((field) => (
              <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 12, color: '#666', minWidth: 80, flexShrink: 0 }}>
                  {field.label}
                </label>
                {field.type === 'select' && field.options ? (
                  <select
                    value={String(step.config[field.key] ?? field.default ?? '')}
                    onChange={(e) => onConfigChange(field.key, e.target.value)}
                    style={fieldInputStyle}
                  >
                    {field.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : field.type === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(step.config[field.key] ?? field.default ?? false)}
                    onChange={(e) => onConfigChange(field.key, e.target.checked)}
                  />
                ) : (
                  <input
                    type="text"
                    value={String(step.config[field.key] ?? field.default ?? '')}
                    onChange={(e) => onConfigChange(field.key, e.target.value)}
                    placeholder={field.key}
                    style={fieldInputStyle}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Expanded substeps */}
        {expanded && hasSubsteps && (
          <div style={{
            marginTop: 10, paddingTop: 10, borderTop: '2px dashed #d0c8e0',
            marginLeft: -14, marginRight: -14, paddingLeft: 14, paddingRight: 14,
          }}>
            <div style={{ fontSize: 11, color: '#999', marginBottom: 6, paddingLeft: 4 }}>
              内部子步骤
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {step.substeps!.map((sub, i) => (
                <StepCard
                  key={sub.id}
                  step={sub}
                  index={i}
                  depth={depth + 1}
                  isRunning={isRunning}
                  isCurrent={isCurrent}
                  output={undefined}
                  draggable={false}
                  removable={false}
                  onConfigChange={() => {}}
                  onToggleExpand={() => {}}
                  expanded={false}
                />
              ))}
            </div>
          </div>
        )}

        {/* Execution output */}
        {output !== undefined && (
          <div style={{
            marginTop: 8, padding: 8, background: '#f5f5f5',
            borderRadius: 6, fontSize: 11, color: '#333',
            fontFamily: 'monospace', maxHeight: 80, overflow: 'auto',
            wordBreak: 'break-all',
          }}>
            <div style={{ fontSize: 10, color: '#999', marginBottom: 2 }}>▶ 输出</div>
            {typeof output === 'object'
              ? JSON.stringify(output, null, 2).slice(0, 200)
              : String(output).slice(0, 200)}
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid #e0e0e0', borderRadius: 4,
  cursor: 'pointer', fontSize: 11, padding: '3px 8px', color: '#555',
};

const fieldInputStyle: React.CSSProperties = {
  flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid #ddd',
  fontSize: 12,
};
