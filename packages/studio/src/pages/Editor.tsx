import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor,
  PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, DragOverlay,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { fetchTemplates, saveTemplate } from '../api.js';
import { ATOMIC_MODULES, getCategoryColor, getModuleByID, type ModuleCatalogItem } from '../modules.js';
import { StepCard, StepOverlay, type EditorStep } from './StepCard.js';
import { stepsToYaml, downloadYaml, parseYaml } from '../utils/yaml.js';

interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface LogEntry {
  stepId?: string;
  message: string;
  kind: 'start' | 'complete' | 'error' | 'log';
}

interface EditorContext {
  /** Module name at this level */
  moduleName: string;
  /** Steps at this level (will be restored when returning) */
  steps: EditorStep[];
  /** Which step in the PARENT context has these substeps */
  parentStepId: string;
  /** Display label for breadcrumb */
  parentLabel: string;
}

/** Recursively find a step by id in a nested steps array */
function findStepRecursive(steps: EditorStep[], id: string): EditorStep | undefined {
  for (const step of steps) {
    if (step.id === id) return step;
    if (step.substeps) {
      const found = findStepRecursive(step.substeps, id);
      if (found) return found;
    }
  }
  return undefined;
}

const CATEGORY_ORDER = ['io', 'encoding', 'injection', 'transformation', 'wrapping'];

let stepCounter = 0;
function nextStepId(): string {
  return `step_${++stepCounter}`;
}

// ── Sidebar draggable module item ──

function SidebarModule({ mod }: { mod: ModuleCatalogItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar-${mod.id}`,
    data: { moduleId: mod.id, type: 'sidebar-module' },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      onClick={() => {
        // Click-to-add still works (triggered via Editor callback)
      }}
      style={{
        padding: '8px 10px', borderRadius: 6, cursor: 'grab',
        marginBottom: 2, border: '1px solid transparent',
        fontSize: 12, opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#f5f5f5';
        e.currentTarget.style.borderColor = '#e0e0e0';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      <div style={{ fontWeight: 500, fontSize: 13 }}>{mod.name}</div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{mod.description}</div>
    </div>
  );
}

// ── Drop zone in the step list ──

function StepDropZone({ onDrop }: { onDrop: (moduleId: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'step-drop-zone', data: { type: 'step-zone' } });

  return (
    <div ref={setNodeRef} style={{
      minHeight: 40, borderRadius: 8,
      border: `2px dashed ${isOver ? '#1a1a2e' : '#e0e0e0'}`,
      background: isOver ? '#f0f0ff' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 12, color: '#ccc', marginTop: 4, transition: 'all 0.2s',
    }}>
      {isOver ? '放入以添加步骤' : '或将模块拖到这里'}
    </div>
  );
}

// ── Editor ──

export function Editor() {
  const [moduleName, setModuleName] = useState('未命名模块');
  const [steps, setSteps] = useState<EditorStep[]>([]);
  const [outputText, setOutputText] = useState<string | null>(null);

  // Expansion state: set of step IDs where substeps are visible
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Context stack for sub-editor navigation (composite module editing)
  const [contextStack, setContextStack] = useState<EditorContext[]>([]);
  const isSubEditor = contextStack.length > 0;

  // Wrap-as-module modal state
  const [wrapModal, setWrapModal] = useState<{
    open: boolean;
    name: string;
    description: string;
    category: string;
    saving: boolean;
    error: string | null;
  }>({
    open: false,
    name: '',
    description: '',
    category: '自定义',
    saving: false,
    error: null,
  });

  // ── Wrap as module ──

  const handleWrapAsModule = useCallback(async () => {
    if (steps.length === 0) return;

    setWrapModal((prev) => ({
      ...prev,
      saving: true,
      error: null,
    }));

    try {
      const yaml = stepsToYaml(wrapModal.name || moduleName, steps);
      // Override the category in the generated YAML
      const yamlWithCategory = yaml.replace(
        /^category:.*$/m,
        `category: "${wrapModal.category}"`,
      );

      const result = await saveTemplate(yamlWithCategory);

      if (!result.ok) {
        setWrapModal((prev) => ({
          ...prev,
          saving: false,
          error: result.error || '保存失败',
        }));
        return;
      }

      // Replace current steps with a single _composite module node
      const newStep: EditorStep = {
        id: nextStepId(),
        moduleId: result.id,
        config: {},
        label: wrapModal.name,
        substeps: structuredClone(steps),
      };

      setSteps([newStep]);
      setWrapModal({ open: false, name: '', description: '', category: '自定义', saving: false, error: null });
      setExpandedSteps(new Set());
      setOutputText(null);
      setLogs([]);

      // Refresh the template list
      fetchTemplates().then(setTemplates).catch(() => {});
    } catch (err) {
      setWrapModal((prev) => ({
        ...prev,
        saving: false,
        error: err instanceof Error ? err.message : '未知错误',
      }));
    }
  }, [steps, moduleName, wrapModal.name, wrapModal.category]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'atomic' | 'templates'>('atomic');
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);

  // Drag overlay state
  const [activeDragItem, setActiveDragItem] = useState<ModuleCatalogItem | null>(null);

  // Execution state
  const [running, setRunning] = useState(false);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);
  const [stepOutputs, setStepOutputs] = useState<Record<string, unknown>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // SVG pipe visualization
  const stepsContainerRef = useRef<HTMLDivElement>(null);
  const [wirePaths, setWirePaths] = useState<Array<{
    fromX: number; fromY: number; toX: number; toY: number;
  }>>([]);

  useEffect(() => {
    fetchTemplates().then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // ── DnD sensors ──
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5, delay: 100, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Step management ──

  const addStep = useCallback((moduleId: string) => {
    setSteps((prev) => [...prev, { id: nextStepId(), moduleId, config: {} }]);
  }, []);

  const removeStep = useCallback((id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const updateConfig = useCallback((id: string, key: string, value: unknown) => {
    setSteps((prev) => prev.map((s) =>
      s.id === id ? { ...s, config: { ...s.config, [key]: value } } : s,
    ));
  }, []);

  // ── Sortable drag end (reorder) ──

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragItem(null);

    const { active, over } = event;

    // Case 1: Sidebar module dropped into step list
    if (active.data.current?.type === 'sidebar-module') {
      const moduleId: string = active.data.current.moduleId;
      if (over && over.id === 'step-drop-zone') {
        addStep(moduleId);
      } else if (over) {
        // Dropped on a specific step — insert after it
        const overIndex = steps.findIndex((s) => s.id === over.id);
        if (overIndex >= 0) {
          setSteps((prev) => {
            const arr = [...prev];
            arr.splice(overIndex + 1, 0, { id: nextStepId(), moduleId, config: {} });
            return arr;
          });
        } else {
          addStep(moduleId);
        }
      }
      return;
    }

    // Case 2: Reorder existing steps
    if (!over || active.id === over.id) return;
    setSteps((prev) => {
      const oldIndex = prev.findIndex((s) => s.id === active.id);
      const newIndex = prev.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const arr = [...prev];
      const [removed] = arr.splice(oldIndex, 1);
      arr.splice(newIndex, 0, removed);
      return arr;
    });
  }, [steps, addStep]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (event.active.data.current?.type === 'sidebar-module') {
      const modId: string = event.active.data.current.moduleId;
      const mod = ATOMIC_MODULES.find((m) => m.id === modId) || null;
      setActiveDragItem(mod);
    }
  }, []);

  // ── Save pipeline ──

  const handleSave = useCallback(() => {
    if (steps.length === 0) return;
    const yaml = stepsToYaml(moduleName, steps);
    downloadYaml(`${moduleName}.yaml`, yaml);
  }, [moduleName, steps]);

  // ── Import pipeline ──

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const parsed = parseYaml(content);
      if (parsed) {
        setModuleName(parsed.name);
        setSteps(parsed.steps.map((s) => ({ ...s, id: nextStepId() })));
        setOutputText(null);
      } else {
        alert('无法解析文件：格式不受支持');
      }
    };
    reader.readAsText(file);

    // Reset so the same file can be re-selected
    e.target.value = '';
  }, []);

  // ── Load template ──

  // ── Recursive step mapping (preserves substeps from template) ──

  const mapTemplateSteps = useCallback((
    rawSteps: Array<Record<string, unknown>>,
  ): EditorStep[] => {
    return rawSteps
      .filter((s) => s.module !== 'input' && s.module !== 'output')
      .map((s) => ({
        id: nextStepId(),
        moduleId: String(s.module ?? ''),
        config: (s.config as Record<string, unknown>) ?? {},
        substeps: Array.isArray(s.substeps)
          ? mapTemplateSteps(s.substeps as Array<Record<string, unknown>>)
          : undefined,
      }));
  }, []);

  const loadTemplate = useCallback(async (templateId: string) => {
    try {
      const { fetchTemplate } = await import('../api.js');
      const t = await fetchTemplate(templateId);
      const flow = t.flow as { steps?: Array<Record<string, unknown>> } | undefined;
      if (flow?.steps) {
        setModuleName(t.name);
        setSteps(mapTemplateSteps(flow.steps));
        setOutputText(null);
        setExpandedSteps(new Set());
        setContextStack([]); // reset to root
      }
    } catch {
      // ignore
    }
  }, [mapTemplateSteps]);

  // ── Expand / collapse substeps ──

  const handleToggleExpand = useCallback((stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  // ── Sub-editor navigation (composite module editing) ──

  /** Enter sub-editor for a composite module's internal steps */
  const enterSubEdit = useCallback((stepId: string) => {
    const step = findStepRecursive(steps, stepId);
    if (!step?.substeps?.length) return;

    const mod = getModuleByID(step.moduleId);

    setContextStack((prev) => [
      ...prev,
      {
        moduleName,
        steps,
        parentStepId: stepId,
        parentLabel: step.label || mod?.name || step.moduleId,
      },
    ]);

    setModuleName(mod?.name || step.moduleId);
    setSteps(structuredClone(step.substeps));
    setExpandedSteps(new Set());
    setOutputText(null);
    setLogs([]);
  }, [moduleName, steps]);

  /** Navigate up to a specific depth in the context stack. 0 = root, 1 = first sub-level, etc. */
  const navigateToLevel = useCallback((targetDepth: number) => {
    if (targetDepth >= contextStack.length) return; // already at or below target

    // Save current steps upward through each level we're exiting
    let savedSteps = steps;
    let savedModuleName = moduleName;
    const stack = [...contextStack];

    while (stack.length > targetDepth) {
      const parent = stack[stack.length - 1];
      // Write current steps into the parent step's substeps
      savedSteps = parent.steps.map((s) =>
        s.id === parent.parentStepId
          ? { ...s, substeps: structuredClone(savedSteps) }
          : s,
      );
      savedModuleName = parent.moduleName;
      stack.pop();
    }

    setContextStack(stack.slice(0, targetDepth));
    setModuleName(savedModuleName);
    setSteps(savedSteps);
    setExpandedSteps(new Set());
    setOutputText(null);
    setLogs([]);
  }, [contextStack, steps, moduleName]);

  /** Breadcrumb path: root + each sub-level's label */
  const breadcrumbPath = [
    { label: '根', depth: 0 },
    ...contextStack.map((ctx, i) => ({
      label: ctx.parentLabel,
      depth: i + 1,
    })),
  ];
  const currentBreadcrumbLabel = breadcrumbPath[breadcrumbPath.length - 1].label;

  // ── SVG pipe computation ──

  const computeWirePaths = useCallback(() => {
    const container = stepsContainerRef.current;
    if (!container || steps.length < 2) {
      setWirePaths([]);
      return;
    }

    // Find step card DOM elements by their data-step-id attribute
    const paths: Array<{ fromX: number; fromY: number; toX: number; toY: number }> = [];
    const execSteps = steps.filter((s) => s.moduleId !== 'input' && s.moduleId !== 'output');

    for (let i = 0; i < execSteps.length - 1; i++) {
      const fromEl = container.querySelector(`[data-step-id="${execSteps[i].id}"]`);
      const toEl = container.querySelector(`[data-step-id="${execSteps[i + 1].id}"]`);

      if (!fromEl || !toEl) continue;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      const cRect = container.getBoundingClientRect();

      paths.push({
        fromX: fromRect.right - cRect.left,
        fromY: fromRect.top + fromRect.height / 2 - cRect.top,
        toX: toRect.left - cRect.left,
        toY: toRect.top + toRect.height / 2 - cRect.top,
      });
    }

    setWirePaths(paths);
  }, [steps]);

  // ── Execute ──

  const handleExecute = useCallback(() => {
    if (running) return;

    setLogs([]);
    setStepOutputs({});
    setCurrentStepId(null);
    setOutputText(null);
    setWirePaths([]);
    setRunning(true);

    const pipelineSteps = steps.map((s) => ({
      id: s.id, module: s.moduleId, config: { ...s.config },
    }));

    const template = {
      version: '0.1',
      name: moduleName,
      description: '',
      category: '自定义',
      params: [],
      flow: { steps: pipelineSteps },
    };

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: 'execute', template, params: {} }));

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'step-start':
          setCurrentStepId(msg.stepId);
          addLog({ kind: 'start', stepId: msg.stepId, message: `▶ ${msg.module}` });
          break;
        case 'step-complete':
          if (msg.stepId) setStepOutputs((p) => ({ ...p, [msg.stepId!]: msg.output }));
          addLog({ kind: 'complete', stepId: msg.stepId, message: `✔ ${msg.stepId}` });
          break;
        case 'step-error':
          addLog({ kind: 'error', stepId: msg.stepId, message: `✘ ${msg.error}` });
          break;
        case 'log':
          addLog({ kind: 'log', message: `[${msg.level}] ${msg.message}` });
          break;
        case 'complete': {
          const out = msg.outputs && steps.length > 0 ? msg.outputs[steps[steps.length - 1].id] : null;
          setOutputText(out ? (typeof out === 'object' ? JSON.stringify(out, null, 2) : String(out)) : null);
          addLog({ kind: 'log', message: msg.cancelled ? '⏹ 已取消' : '✅ 完成' });
          setCurrentStepId(null);
          setRunning(false);
          // Compute SVG pipe paths from step card positions
          computeWirePaths();
          break;
        }
        case 'error':
          addLog({ kind: 'error', message: `❌ ${msg.message}` });
          setRunning(false);
          break;
      }
    };

    ws.onerror = () => { addLog({ kind: 'error', message: '❌ 连接失败' }); setRunning(false); };
    ws.onclose = () => setRunning(false);

    function addLog(entry: LogEntry) { setLogs((p) => [...p, entry]); }
  }, [running, steps, moduleName]);

  const handleCancel = useCallback(() => wsRef.current?.send(JSON.stringify({ type: 'cancel' })), []);

  // ── Group modules ──
  const groupedAtomic = CATEGORY_ORDER
    .map((cat) => ({ category: cat, modules: ATOMIC_MODULES.filter((m) => m.category === cat) }))
    .filter((g) => g.modules.length > 0);

  // ── Render ──

  return (
    <div style={{ display: 'flex', gap: 0, height: 'calc(100vh - 100px)' }}>
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept=".yaml,.yml,.json"
        onChange={handleFileSelected} style={{ display: 'none' }} />

      {/* ── Workspace ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>

        {/* ── Input area (styled as input module card) ── */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: '14px 18px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)', flexShrink: 0,
          borderLeft: '3px solid #1a1a2e',
        }}>
          {/* Top row: module name + buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Back button in sub-editor mode */}
              {isSubEditor && (
                <button
                  onClick={() => navigateToLevel(contextStack.length - 1)}
                  style={{
                    background: '#6a4c93', color: '#fff', border: 'none',
                    borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                    fontSize: 13, fontWeight: 500,
                  }}
                  title="返回上一层"
                >
                  ← 返回
                </button>
              )}
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24, borderRadius: 12,
                background: isSubEditor ? '#6a4c93' : '#1a1a2e', color: '#fff',
                fontSize: 11, fontWeight: 600,
              }}>{isSubEditor ? '◈' : 'IN'}</span>
              <input
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                disabled={isSubEditor}
                style={{
                  fontSize: 18, fontWeight: 600, border: 'none',
                  borderBottom: `2px solid ${isSubEditor ? '#d0c8e0' : 'transparent'}`,
                  outline: 'none', padding: '4px 0', width: 280, background: 'transparent',
                  color: isSubEditor ? '#6a4c93' : 'inherit',
                }}
                title={isSubEditor ? '子模块名称（不可编辑）' : '管道名称'}
              />
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#e3f2fd', color: '#555' }}>
                io
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleSave} disabled={steps.length === 0}
                style={{ padding: '8px 16px', background: '#fff', color: '#1a1a2e', border: '1px solid #1a1a2e', borderRadius: 8, fontSize: 13, cursor: steps.length === 0 ? 'not-allowed' : 'pointer' }}>
                💾 保存{isSubEditor ? '子模块' : ''}
              </button>
              <button onClick={handleExecute} disabled={running || isSubEditor}
                style={{ padding: '8px 22px', background: (running || isSubEditor) ? '#ccc' : '#1a1a2e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: (running || isSubEditor) ? 'not-allowed' : 'pointer' }}
                title={isSubEditor ? '请返回根管道后运行' : undefined}
              >
                {running ? '⏳ 执行中...' : '▶ 运行'}
              </button>
              {running && (
                <button onClick={handleCancel}
                  style={{ padding: '8px 16px', background: '#c62828', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
                  ⏹ 取消
                </button>
              )}
            </div>
          </div>

          {/* Input hint — data comes from the 输入 module, not a textarea */}
          <div style={{
            padding: '8px 12px', borderRadius: 8,
            background: '#f8f6fc', fontSize: 12, color: '#6a4c93',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>💡</span>
            <span>
              {steps.some((s) => s.moduleId === 'input')
                ? '输入数据由「输入」模块提供，点击该模块的 ▼ 配置来填写数据'
                : '从左侧拖入「输入」模块到画布，在其配置中填写数据'}
            </span>
          </div>
        </div>

        {/* ── Processing steps ── */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: '14px 18px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)', flex: 1,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8, fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>处理步骤 {steps.length > 0 ? `(${steps.length})` : ''}</span>
            {/* ── Breadcrumb navigation ── */}
            {isSubEditor && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                {breadcrumbPath.map((crumb, i) => (
                  <span key={crumb.depth} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <span style={{ color: '#ccc' }}>›</span>}
                    <button
                      onClick={() => navigateToLevel(crumb.depth)}
                      style={{
                        background: crumb.depth === breadcrumbPath.length - 1 ? '#6a4c93' : 'transparent',
                        color: crumb.depth === breadcrumbPath.length - 1 ? '#fff' : '#6a4c93',
                        border: crumb.depth === breadcrumbPath.length - 1 ? 'none' : '1px solid #d0c8e0',
                        borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                        fontWeight: crumb.depth === breadcrumbPath.length - 1 ? 600 : 400,
                      }}
                      title={crumb.depth < breadcrumbPath.length - 1 ? `返回 ${crumb.label}` : undefined}
                    >
                      {crumb.label}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {steps.length === 0 ? (
              <StepDropZone onDrop={addStep} />
            ) : (
              <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <div ref={stepsContainerRef} style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, paddingRight: 4, position: 'relative' }}>
                  {/* ── SVG pipe overlay ── */}
                  {wirePaths.length > 0 && (
                    <svg style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%',
                      pointerEvents: 'none', zIndex: 5, overflow: 'visible',
                    }}>
                      {wirePaths.map((p, i) => {
                        const dx = p.toX - p.fromX;
                        const cp = Math.max(Math.abs(dx) * 0.4, 30);
                        return (
                          <path
                            key={i}
                            d={`M ${p.fromX} ${p.fromY} C ${p.fromX + cp} ${p.fromY}, ${p.toX - cp} ${p.toY}, ${p.toX} ${p.toY}`}
                            stroke="#6a4c93"
                            strokeWidth={2}
                            fill="none"
                            opacity={0.5}
                            strokeDasharray="6 3"
                          />
                        );
                      })}
                    </svg>
                  )}
                  {steps.map((step, i) => (
                    <div key={step.id} data-step-id={step.id}>
                    <StepCard
                      key={step.id}
                      step={step}
                      index={i}
                      isRunning={running}
                      isCurrent={currentStepId === step.id}
                      output={stepOutputs[step.id]}
                      draggable={!isSubEditor}
                      removable={!isSubEditor}
                      expanded={expandedSteps.has(step.id)}
                      onToggleExpand={() => handleToggleExpand(step.id)}
                      onRemove={() => removeStep(step.id)}
                      onConfigChange={(key, value) => updateConfig(step.id, key, value)}
                      onEditSubsteps={step.substeps?.length ? () => enterSubEdit(step.id) : undefined}
                    />
                    </div>
                  ))}
                  <StepDropZone onDrop={addStep} />
                </div>
              </SortableContext>
            )}

            {/* Drag overlay */}
            <DragOverlay>
              {activeDragItem && <StepOverlay step={{ id: 'overlay', moduleId: activeDragItem.id, config: {} }} />}
            </DragOverlay>
          </DndContext>
        </div>

        {/* ── Output area ── */}
        <div style={{
          background: '#fff', borderRadius: 12, padding: '12px 18px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)', flexShrink: 0,
          borderLeft: '3px solid #43a047',
        }}>
          <div style={{ fontSize: 12, color: '#888', fontWeight: 500, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 12,
              background: '#43a047', color: '#fff', fontSize: 11, fontWeight: 600,
            }}>OUT</span>
            输出
          </div>
          <div style={{
            minHeight: 40, padding: 8, borderRadius: 6,
            background: '#f9f9f9', fontSize: 13, fontFamily: 'monospace',
            color: outputText ? '#333' : '#ccc', wordBreak: 'break-all',
            whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto',
          }}>
            {outputText || '运行后显示结果'}
          </div>
        </div>

        {/* ── Log output ── */}
        {logs.length > 0 && (
          <div style={{
            background: '#1a1a2e', borderRadius: 8, padding: 10, maxHeight: 100,
            overflowY: 'auto', fontFamily: 'monospace', fontSize: 11, lineHeight: 1.5,
            flexShrink: 0,
          }}>
            {logs.map((entry, i) => (
              <div key={i} style={{ color: entry.kind === 'error' ? '#ef5350' : entry.kind === 'start' ? '#42a5f5' : entry.kind === 'complete' ? '#66bb6a' : '#e0e0e0' }}>
                {entry.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* ── Sidebar ── */}
      <div style={{
        width: sidebarOpen ? 270 : 0, overflow: 'hidden',
        transition: 'width 0.2s', marginLeft: 16, flexShrink: 0,
      }}>
        <div style={{
          background: '#fff', borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          height: '100%', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            padding: '12px 14px', borderBottom: '1px solid #f0f0f0',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', gap: 4, flex: 1 }}>
              <button onClick={() => setSidebarTab('atomic')} style={tabStyle(sidebarTab === 'atomic')}>模块</button>
              <button onClick={() => setSidebarTab('templates')} style={tabStyle(sidebarTab === 'templates')}>模板</button>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={handleImportClick}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#666', padding: '2px 4px' }}
                title="导入 YAML">
                📂
              </button>
              <button onClick={() => setSidebarOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: '2px 4px' }}>
                ✕
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {sidebarTab === 'atomic' && groupedAtomic.map((group) => (
              <div key={group.category} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#999', marginBottom: 4, padding: '0 4px', textTransform: 'uppercase' }}>
                  {group.category}
                </div>
                {group.modules.map((mod) => (
                  <div key={mod.id} onClick={() => addStep(mod.id)}>
                    <SidebarModule mod={mod} />
                  </div>
                ))}
              </div>
            ))}

            {sidebarTab === 'templates' && (
              <>
                {templates.length === 0 && (
                  <p style={{ fontSize: 12, color: '#bbb', textAlign: 'center', padding: 24 }}>暂无可用模板</p>
                )}
                {templates.map((t) => (
                  <div key={t.id} onClick={() => loadTemplate(t.id)}
                    style={{
                      padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                      marginBottom: 4, border: '1px solid transparent',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; e.currentTarget.style.borderColor = '#e0e0e0'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</div>
                    <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                      <span style={{ backgroundColor: getCategoryColor(t.category || ''), padding: '1px 6px', borderRadius: 4, fontSize: 10, marginRight: 6 }}>
                        {t.category}
                      </span>
                      {t.description}
                    </div>
                  </div>
                ))}
                {/* ── Wrap-as-module button ── */}
                {steps.length > 0 && !isSubEditor && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
                    <button
                      onClick={() => setWrapModal((prev) => ({
                        ...prev,
                        open: true,
                        name: moduleName !== '未命名模块' ? moduleName : '',
                        description: '',
                        category: '自定义',
                        error: null,
                      }))}
                      style={{
                        width: '100%', padding: '10px',
                        background: '#6a4c93', color: '#fff',
                        border: 'none', borderRadius: 8,
                        cursor: 'pointer', fontSize: 13, fontWeight: 600,
                      }}
                    >
                      📦 封装为模块
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar toggle */}
      {!sidebarOpen && (
        <button onClick={() => setSidebarOpen(true)}
          style={{
            position: 'fixed', right: 16, top: '50%', transform: 'translateY(-50%)',
            background: '#1a1a2e', color: '#fff', border: 'none',
            borderRadius: '8px 0 0 8px', padding: '12px 8px', cursor: 'pointer', zIndex: 10,
          }}>
          📦
        </button>
      )}

      {/* ── Wrap-as-module modal ── */}
      {wrapModal.open && (
        <div
          onClick={() => !wrapModal.saving && setWrapModal((p) => ({ ...p, open: false }))}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, padding: '24px 28px',
              width: 420, maxWidth: '90vw',
              boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 18, color: '#1a1a2e' }}>
              📦 封装为模块
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Name */}
              <div>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                  模块名称
                </label>
                <input
                  type="text"
                  value={wrapModal.name}
                  onChange={(e) => setWrapModal((p) => ({ ...p, name: e.target.value }))}
                  placeholder="例如：我的编码管道"
                  disabled={wrapModal.saving}
                  style={modalInputStyle}
                  autoFocus
                />
              </div>

              {/* Description */}
              <div>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                  描述
                </label>
                <input
                  type="text"
                  value={wrapModal.description}
                  onChange={(e) => setWrapModal((p) => ({ ...p, description: e.target.value }))}
                  placeholder="简短的用途说明"
                  disabled={wrapModal.saving}
                  style={modalInputStyle}
                />
              </div>

              {/* Category */}
              <div>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                  分类
                </label>
                <select
                  value={wrapModal.category}
                  onChange={(e) => setWrapModal((p) => ({ ...p, category: e.target.value }))}
                  disabled={wrapModal.saving}
                  style={{ ...modalInputStyle, cursor: 'pointer' }}
                >
                  <option value="自定义">自定义</option>
                  <option value="encoding">编码/解码</option>
                  <option value="transform">转换</option>
                  <option value="security">安全</option>
                  <option value="combine">组合</option>
                  <option value="tools">工具</option>
                  <option value="wrapping">包裹</option>
                  <option value="injection">注入</option>
                </select>
              </div>

              {/* Steps summary */}
              <div style={{
                background: '#f8f6fc', borderRadius: 6, padding: '8px 12px',
                fontSize: 12, color: '#6a4c93',
              }}>
                {steps.length} 个步骤将被封装为复合模块
              </div>

              {/* Error */}
              {wrapModal.error && (
                <div style={{
                  background: '#ffebee', borderRadius: 6, padding: '8px 12px',
                  fontSize: 12, color: '#c62828',
                }}>
                  {wrapModal.error}
                </div>
              )}
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setWrapModal((p) => ({ ...p, open: false }))}
                disabled={wrapModal.saving}
                style={{
                  padding: '8px 20px', background: '#fff', color: '#666',
                  border: '1px solid #ddd', borderRadius: 8, cursor: wrapModal.saving ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                }}
              >
                取消
              </button>
              <button
                onClick={handleWrapAsModule}
                disabled={wrapModal.saving || !wrapModal.name.trim()}
                style={{
                  padding: '8px 20px',
                  background: (wrapModal.saving || !wrapModal.name.trim()) ? '#ccc' : '#6a4c93',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: (wrapModal.saving || !wrapModal.name.trim()) ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 600,
                }}
              >
                {wrapModal.saving ? '保存中...' : '确认封装'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#1a1a2e' : 'transparent',
    color: active ? '#fff' : '#666',
    border: 'none', borderRadius: 4, padding: '4px 10px',
    cursor: 'pointer', fontSize: 12,
  };
}

const modalInputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 6,
  border: '1px solid #ddd', fontSize: 13,
  boxSizing: 'border-box',
};
