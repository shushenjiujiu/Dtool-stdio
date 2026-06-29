/**
 * CanvasEditor — 2D node-graph canvas using React Flow.
 *
 * Phase 2: multi-select wrap, composite nodes, sub-editor, breadcrumbs.
 */

import React, { useCallback, useRef, useState, useMemo } from 'react';
import {
  ReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type OnSelectionChangeParams,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  MarkerType,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { ATOMIC_MODULES, type ModuleCatalogItem } from '../modules.js';
import { ModuleNode } from './ModuleNode.js';
import { CompositeNode } from './CompositeNode.js';
import { LoopNode } from './LoopNode.js';
import type { LoopNodeData } from './LoopNode.js';
import type { PortDef, ModuleNodeData } from './ModuleNode.js';
import { canvasToPipeline } from '../utils/canvas-to-pipeline.js';

// ── Composite node data type ────────────────────────────────────────────────

export interface CompositeNodeData extends Record<string, unknown> {
  label: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /** Internal sub-graph — shown when double-clicking */
  internalNodes: Node[];
  internalEdges: Edge[];
}

// ── Context stack for sub-editor ────────────────────────────────────────────

interface CanvasContext {
  label: string;
  nodes: Node[];
  edges: Edge[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

let nodeIdCounter = 0;
function nextId(): string {
  return `n${++nodeIdCounter}`;
}

const CATEGORY_ORDER = ['io', 'encoding', 'injection', 'transformation', 'wrapping'];

/** Find canvas node ID from step ID by reversing the mapping */
function findCanvasNodeByStepId(nodeToStep: Map<string, string>, stepId: string): string | null {
  for (const [canvasId, sid] of nodeToStep) {
    if (sid === stepId || stepId.startsWith(sid)) return canvasId;
  }
  return null;
}

// ── Port derivation (frontend version of port-derivation.ts) ───────────────

interface DerivedPorts {
  inputs: PortDef[];
  outputs: PortDef[];
  /** Maps composite port id → { internalNodeId, internalPortId } for wire remapping */
  inputMap: Map<string, { nodeId: string; portId: string }>;
  outputMap: Map<string, { nodeId: string; portId: string }>;
}

function derivePortsFromSelection(
  internalNodeIds: Set<string>,
  allNodes: Node[],
  allEdges: Edge[],
): DerivedPorts {
  const inputs: PortDef[] = [];
  const outputs: PortDef[] = [];
  const inputMap = new Map<string, { nodeId: string; portId: string }>();
  const outputMap = new Map<string, { nodeId: string; portId: string }>();

  const internalNodes = allNodes.filter((n) => internalNodeIds.has(n.id));

  // Edges where both ends are internal
  const internalEdges = allEdges.filter(
    (e) => internalNodeIds.has(e.source) && internalNodeIds.has(e.target),
  );

  for (const node of internalNodes) {
    const data = node.data as ModuleNodeData | CompositeNodeData;

    // Check each input port — if no internal edge targets it, it's exposed
    for (const port of data.inputs || []) {
      const hasIncoming = internalEdges.some(
        (e) => e.target === node.id && e.targetHandle === port.id,
      );
      if (!hasIncoming) {
        const extId = `${node.id}/${port.id}`;
        inputs.push({ id: extId, label: `${data.label} › ${port.label}`, type: port.type });
        inputMap.set(extId, { nodeId: node.id, portId: port.id });
      }
    }

    // Check each output port — if no internal edge sources from it, it's exposed
    for (const port of data.outputs || []) {
      const hasOutgoing = internalEdges.some(
        (e) => e.source === node.id && e.sourceHandle === port.id,
      );
      if (!hasOutgoing) {
        const extId = `${node.id}/${port.id}`;
        outputs.push({ id: extId, label: `${data.label} › ${port.label}`, type: port.type });
        outputMap.set(extId, { nodeId: node.id, portId: port.id });
      }
    }
  }

  return { inputs, outputs, inputMap, outputMap };
}

// ── Sidebar module item ────────────────────────────────────────────────────

function SidebarModuleItem({ mod, onDragStart }: {
  mod: ModuleCatalogItem;
  onDragStart: (e: React.DragEvent, mod: ModuleCatalogItem) => void;
}) {
  const catBorders: Record<string, string> = {
    io: '#90caf9', encoding: '#a5d6a7', injection: '#ef9a9a',
    transformation: '#ffcc80', wrapping: '#ce93d8',
  };
  const catColors: Record<string, string> = {
    io: '#e3f2fd', encoding: '#e8f5e9', injection: '#ffebee',
    transformation: '#fff3e0', wrapping: '#f3e5f5',
  };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, mod)}
      style={{
        padding: '8px 10px', borderRadius: 6, cursor: 'grab',
        marginBottom: 2, fontSize: 12,
        background: '#fff',
        border: `1px solid ${catBorders[mod.category] || '#e0e0e0'}`,
        borderLeft: `3px solid ${catBorders[mod.category] || '#999'}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = catColors[mod.category] || '#f5f5f5';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#fff';
      }}
    >
      <div style={{ fontWeight: 500, fontSize: 13 }}>{mod.name}</div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 1 }}>{mod.description}</div>
    </div>
  );
}

// ── CanvasEditor ────────────────────────────────────────────────────────────

export function CanvasEditor() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Edge interactions
  const defaultEdgeOptions = useMemo(() => ({
    type: 'smoothstep' as const,
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#6a4c93' },
    style: { stroke: '#6a4c93', strokeWidth: 2 },
    deletable: true,
  }), []);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    setSelectedEdgeIds([edge.id]);
    setSelectedNodeIds([]);
    setContextMenu(null);
  }, []);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Undo/Redo
  const undoStack = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const redoStack = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const pushUndo = useCallback(() => {
    undoStack.current.push({ nodes: [...nodes], edges: [...edges] });
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, [nodes, edges]);

  // Selection state
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

  // ── Delete handler (nodes + edges) — defined after pushUndo & selectedNodeIds ──
  const handleDeleteSelected = useCallback(() => {
    if (selectedEdgeIds.length > 0) {
      pushUndo();
      setEdges((eds) => eds.filter((e) => !selectedEdgeIds.includes(e.id)));
      setSelectedEdgeIds([]);
    } else if (selectedNodeIds.length > 0) {
      pushUndo();
      setNodes((nds) => nds.filter((n) => !selectedNodeIds.includes(n.id)));
      setEdges((eds) => eds.filter((e) =>
        !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target),
      ));
      setSelectedNodeIds([]);
    }
  }, [selectedEdgeIds, selectedNodeIds, setNodes, setEdges, pushUndo]);

  // Edge right-click → delete directly
  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
    event.preventDefault();
    pushUndo();
    setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    setSelectedEdgeIds([]);
  }, [setEdges, pushUndo]);

  // Enhanced edges with hover/select styling
  const displayEdges = useMemo(() => edges.map((e) => ({
    ...e,
    style: {
      ...e.style,
      stroke: selectedEdgeIds.includes(e.id) ? '#ef5350'
        : hoveredEdgeId === e.id ? '#ab47bc'
        : (e.style?.stroke || '#6a4c93'),
      strokeWidth: selectedEdgeIds.includes(e.id) || hoveredEdgeId === e.id ? 3
        : (e.style?.strokeWidth || 2),
    },
    markerEnd: {
      ...(e.markerEnd as any || {}),
      color: selectedEdgeIds.includes(e.id) ? '#ef5350'
        : hoveredEdgeId === e.id ? '#ab47bc'
        : '#6a4c93',
    },
  })), [edges, selectedEdgeIds, hoveredEdgeId]);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Sub-editor context stack
  const [contextStack, setContextStack] = useState<CanvasContext[]>([]);
  const isSubEditor = contextStack.length > 0;

  // Node search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  // Wrap-as-module modal
  const [wrapModal, setWrapModal] = useState<{ open: boolean; name: string }>({
    open: false, name: '',
  });

  // Loop dialog
  const [loopDialog, setLoopDialog] = useState<{ open: boolean; name: string; mode: 'count' | 'foreach' | 'until'; count: number; foreachVar: string; untilCondition: string }>({
    open: false, name: '', mode: 'count', count: 3, foreachVar: 'item', untilCondition: '',
  });

  // ── Execution state ──
  const [execStatus, setExecStatus] = useState<'idle' | 'running'>('idle');
  const [execLogs, setExecLogs] = useState<Array<{ message: string; kind: 'start' | 'complete' | 'error' | 'log' }>>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Track internal edges when wrapping (for remapping)
  const wrapDataRef = useRef<{
    internalNodeIds: Set<string>;
    internalNodes: Node[];
    internalEdges: Edge[];
    derived: DerivedPorts;
  } | null>(null);

  const nodeTypes: NodeTypes = useMemo(() => ({
    moduleNode: ModuleNode,
    compositeNode: CompositeNode,
    loopNode: LoopNode,
  }), []);

  const toolBtnStyle: React.CSSProperties = { background: 'none', border: '1px solid #ddd', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 14, color: '#666' };

  // ── Connection ──
  const onConnect = useCallback((connection: Connection) => {
    // Rule 1: One input port → one source only (prevent multi-input clash)
    const existingEdge = edges.find(
      (e) => e.target === connection.target && e.targetHandle === connection.targetHandle,
    );
    if (existingEdge) return;

    // Rule 2: Type check
    const srcNode = nodes.find((n) => n.id === connection.source);
    const tgtNode = nodes.find((n) => n.id === connection.target);
    if (srcNode && tgtNode) {
      const srcData = srcNode.data as any;
      const tgtData = tgtNode.data as any;
      const srcPorts = srcData.outputs || [];
      const tgtPorts = tgtData.inputs || [];
      const srcPort = srcPorts.find((p: any) => p.id === (connection.sourceHandle || 'data'));
      const tgtPort = tgtPorts.find((p: any) => p.id === (connection.targetHandle || 'data'));
      const srcType = srcPort?.type || 'string';
      const tgtType = tgtPort?.type || 'string';
      if (srcType !== 'any' && tgtType !== 'any' && srcType !== tgtType) return;
    }

    pushUndo();
    setEdges((eds) => addEdge({
      ...connection,
      type: 'smoothstep',
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#6a4c93' },
      style: { stroke: '#6a4c93', strokeWidth: 2 },
      deletable: true,
    }, eds));
    setSelectedEdgeIds([]);
  }, [nodes, edges, setEdges, pushUndo]);

  // ── Selection change ──
  const onSelectionChange = useCallback(({ nodes: selNodes, edges: selEdges }: OnSelectionChangeParams) => {
    setSelectedNodeIds(selNodes.map((n) => n.id));
    if (selEdges.length > 0) setSelectedEdgeIds(selEdges.map((e) => e.id));
  }, []);

  // ── Node context menu ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  React.useEffect(() => {
    if (contextMenu) {
      const h = () => setContextMenu(null);
      window.addEventListener('click', h);
      return () => window.removeEventListener('click', h);
    }
  }, [contextMenu]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    pushUndo();
    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setContextMenu(null);
  }, [setNodes, setEdges, pushUndo]);

  const handleDuplicateNode = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    pushUndo();
    setNodes((nds) => [...nds, { ...node, id: nextId(), position: { x: node.position.x + 40, y: node.position.y + 40 }, selected: false }]);
    setContextMenu(null);
  }, [nodes, setNodes, pushUndo]);

  // ── Drag from sidebar → create node ──
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();

    const moduleId = e.dataTransfer.getData('application/dtool-module');
    if (!moduleId || !rfInstance || !reactFlowWrapper.current) return;

    const mod = ATOMIC_MODULES.find((m) => m.id === moduleId);
    if (!mod) return;

    const bounds = reactFlowWrapper.current.getBoundingClientRect();
    const position = rfInstance.screenToFlowPosition({
      x: e.clientX - bounds.left,
      y: e.clientY - bounds.top,
    });

    const newNode: Node = {
      id: nextId(),
      type: 'moduleNode',
      position,
      data: {
        module: mod,
        label: mod.name,
        inputs: [{ id: 'data', label: 'data', type: 'string' }],
        outputs: [{ id: 'data', label: 'data', type: 'string' }],
      } satisfies ModuleNodeData,
    };

    pushUndo();
    setNodes((nds) => [...nds, newNode]);
  }, [rfInstance, setNodes, pushUndo]);

  // ── Sidebar drag start ──
  const onSidebarDragStart = useCallback((e: React.DragEvent, mod: ModuleCatalogItem) => {
    e.dataTransfer.setData('application/dtool-module', mod.id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  // ── Wrap selected nodes as composite module ──
  const handleWrapSelected = useCallback(() => {
    const selSet = new Set(selectedNodeIds);
    if (selSet.size < 2) return;

    // Collect internal nodes
    const internalNodes = nodes.filter((n) => selSet.has(n.id));
    // Internal edges = fully internal
    const internalEdges = edges.filter(
      (e) => selSet.has(e.source) && selSet.has(e.target),
    );

    const derived = derivePortsFromSelection(selSet, nodes, edges);
    const label = internalNodes.map((n) => (n.data as any).label || n.id).slice(0, 3).join(' + ');

    wrapDataRef.current = { internalNodeIds: selSet, internalNodes, internalEdges: [...internalEdges], derived };

    setWrapModal({ open: true, name: label.length > 40 ? label.slice(0, 37) + '...' : label });
  }, [selectedNodeIds, nodes, edges]);

  const confirmWrap = useCallback(() => {
    const d = wrapDataRef.current;
    if (!d) return;

    const name = wrapModal.name.trim() || '复合模块';

    // Build composite node
    const compositeId = nextId();
    const compositeNode: Node<CompositeNodeData> = {
      id: compositeId,
      type: 'compositeNode',
      position: d.internalNodes[0]?.position ?? { x: 0, y: 0 },
      data: {
        label: name,
        inputs: d.derived.inputs,
        outputs: d.derived.outputs,
        internalNodes: d.internalNodes.map((n) => ({
          ...n,
          position: {
            x: n.position.x - (d.internalNodes[0]?.position.x ?? 0),
            y: n.position.y - (d.internalNodes[0]?.position.y ?? 0),
          },
        })),
        internalEdges: d.internalEdges,
      },
    };

    // Remap external edges: edges that cross the boundary get rewritten
    const newEdges = edges.filter((e) => {
      const srcInside = d.internalNodeIds.has(e.source);
      const tgtInside = d.internalNodeIds.has(e.target);
      // Keep edges fully outside
      if (!srcInside && !tgtInside) return true;
      // Drop internal edges (they're stored in composite)
      if (srcInside && tgtInside) return false;
      // Cross-boundary edges get remapped
      return false; // handled below
    });

    const remappedEdges: Edge[] = [];
    for (const e of edges) {
      const srcInside = d.internalNodeIds.has(e.source);
      const tgtInside = d.internalNodeIds.has(e.target);

      if (srcInside && !tgtInside) {
        // Output: internal → external → remap to composite → external
        const extPortId = `${e.source}/${e.sourceHandle || 'data'}`;
        const portDef = d.derived.outputs.find((p) => p.id === extPortId);
        if (portDef) {
          remappedEdges.push({
            ...e,
            id: `${compositeId}-${e.target}-${e.targetHandle}`,
            source: compositeId,
            sourceHandle: portDef.id,
          });
        }
      } else if (!srcInside && tgtInside) {
        // Input: external → internal → remap to external → composite
        const extPortId = `${e.target}/${e.targetHandle || 'data'}`;
        const portDef = d.derived.inputs.find((p) => p.id === extPortId);
        if (portDef) {
          remappedEdges.push({
            ...e,
            id: `${e.source}-${compositeId}-${e.sourceHandle}`,
            target: compositeId,
            targetHandle: portDef.id,
          });
        }
      }
    }

    pushUndo();
    setNodes((nds) => [
      ...nds.filter((n) => !d.internalNodeIds.has(n.id)),
      compositeNode,
    ]);
    setEdges([...newEdges, ...remappedEdges]);
    setWrapModal({ open: false, name: '' });
    wrapDataRef.current = null;
  }, [wrapModal.name, edges, setNodes, setEdges, pushUndo]);

  // ── Add loop container ──
  const confirmAddLoop = useCallback(() => {
    const name = loopDialog.name.trim() || '循环';
    const position = { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 };

    const loopNode: Node<LoopNodeData> = {
      id: nextId(),
      type: 'loopNode',
      position,
      data: {
        label: name,
        inputs: [{ id: 'data', label: 'data', type: 'string' }],
        outputs: [{ id: 'data', label: 'data', type: 'string' }],
        internalNodes: [],
        internalEdges: [],
        loopConfig: {
          mode: loopDialog.mode,
          count: loopDialog.mode === 'count' ? loopDialog.count : undefined,
          foreachVar: loopDialog.mode === 'foreach' ? loopDialog.foreachVar : undefined,
          untilCondition: loopDialog.mode === 'until' ? loopDialog.untilCondition : undefined,
        },
      },
    };

    pushUndo();
    setNodes((nds) => [...nds, loopNode]);
    setLoopDialog({ open: false, name: '', mode: 'count', count: 3, foreachVar: 'item', untilCondition: '' });
  }, [loopDialog, setNodes, pushUndo]);

  // ── Execute canvas pipeline ──

  // Undo/Redo
  const handleUndo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) {
      redoStack.current.push({ nodes: [...nodes], edges: [...edges] });
      setNodes(prev.nodes);
      setEdges(prev.edges);
    }
  }, [nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next) {
      undoStack.current.push({ nodes: [...nodes], edges: [...edges] });
      setNodes(next.nodes);
      setEdges(next.edges);
    }
  }, [nodes, edges, setNodes, setEdges]);

  // Auto-layout with dagre
  const handleAutoLayout = useCallback(async () => {
    const dagre = await import('dagre');
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 40, marginy: 40 });

    for (const node of nodes) {
      const data = node.data as any;
      const w = data.internalNodes ? 200 : 170;
      const portCount = Math.max((data.inputs?.length || 1), (data.outputs?.length || 1));
      const h = 60 + portCount * 22;
      g.setNode(node.id, { width: w, height: h });
    }
    for (const edge of edges) {
      g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    pushUndo();
    setNodes((nds) => nds.map((n) => {
      const nodeWithPos = g.node(n.id);
      if (nodeWithPos) {
        const data = n.data as any;
        const portCount = Math.max((data.inputs?.length || 1), (data.outputs?.length || 1));
        const h = 60 + portCount * 22;
        return {
          ...n,
          position: {
            x: nodeWithPos.x - (data.internalNodes ? 100 : 85),
            y: nodeWithPos.y - h / 2,
          },
        };
      }
      return n;
    }));
  }, [nodes, edges, setNodes, pushUndo]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Delete / Backspace — remove selected nodes or edges
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEdgeIds.length > 0 || selectedNodeIds.length > 0) {
          e.preventDefault();
          handleDeleteSelected();
          return;
        }
      }

      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if (e.ctrlKey && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
      if (e.ctrlKey && e.key === 'a') {
        e.preventDefault();
        setSelectedNodeIds(nodes.map((n) => n.id));
      }
      if (e.ctrlKey && e.key === 'l') {
        e.preventDefault();
        handleAutoLayout();
      }
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        setSearchFocused(true);
        setTimeout(() => {
          const input = document.querySelector('input[placeholder*="搜索节点"]') as HTMLInputElement;
          input?.focus();
        }, 50);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo, handleAutoLayout, nodes, handleDeleteSelected, selectedEdgeIds, selectedNodeIds]);

  const updateNodeStatus = useCallback((nodeId: string, status: 'running' | 'completed' | 'error') => {
    setNodes((nds) => nds.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, execStatus: status } } : n,
    ));
  }, [setNodes]);

  const handleExecute = useCallback(() => {
    if (execStatus === 'running') return;

    // Filter out orphan nodes (no connections at all)
    const execNodes = nodes.filter((n) => n.type !== 'loopNode' || (n.data as any).internalNodes?.length > 0);
    if (execNodes.length === 0) return;

    const converted = canvasToPipeline(nodes, edges);
    if (converted.pipeline.steps.length === 0) return;

    setExecLogs([]);
    // Reset all node statuses
    setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, execStatus: undefined } })));
    setExecStatus('running');

    const template = {
      version: '0.1',
      name: 'canvas-pipeline',
      description: '',
      category: '自定义',
      params: [],
      flow: {
        steps: converted.pipeline.steps,
        wires: converted.wires,
      },
    };

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'execute', template, params: {} }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'step-start': {
          // Map step ID back to canvas node ID
          const canvasId = findCanvasNodeByStepId(converted.nodeToStep, msg.stepId);
          if (canvasId) {
            updateNodeStatus(canvasId, 'running');
          }
          addExecLog({ kind: 'start', message: `▶ ${msg.module || msg.stepId}` });
          break;
        }
        case 'step-complete': {
          const canvasId = findCanvasNodeByStepId(converted.nodeToStep, msg.stepId);
          if (canvasId) {
            updateNodeStatus(canvasId, 'completed');
          }
          addExecLog({ kind: 'complete', message: `✓ ${msg.stepId}` });
          break;
        }
        case 'step-error': {
          const canvasId = findCanvasNodeByStepId(converted.nodeToStep, msg.stepId);
          if (canvasId) {
            updateNodeStatus(canvasId, 'error');
          }
          addExecLog({ kind: 'error', message: `✗ ${msg.error}` });
          break;
        }
        case 'log':
          addExecLog({ kind: 'log', message: `[${msg.level}] ${msg.message}` });
          break;
        case 'complete':
          setExecStatus('idle');
          addExecLog({ kind: 'log', message: msg.cancelled ? '⏹ 已取消' : '✅ 执行完成' });
          break;
        case 'error':
          setExecStatus('idle');
          addExecLog({ kind: 'error', message: `❌ ${msg.message}` });
          break;
      }
    };

    ws.onerror = () => {
      addExecLog({ kind: 'error', message: '❌ WebSocket 连接失败' });
      setExecStatus('idle');
    };

    ws.onclose = () => {
      setExecStatus('idle');
    };

    function addExecLog(entry: { message: string; kind: 'start' | 'complete' | 'error' | 'log' }) {
      setExecLogs((prev) => [...prev, entry]);
    }
  }, [nodes, edges, execStatus]);

  const handleCancel = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: 'cancel' }));
    wsRef.current?.close();
    setExecStatus('idle');
  }, []);

  // Auto-scroll log
  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [execLogs]);

  // ── Sub-editor: double-click composite/loop → enter ──
  const handleNodeDoubleClick = useCallback((_event: React.MouseEvent, node: Node) => {
    if (node.type !== 'compositeNode' && node.type !== 'loopNode') return;
    const data = node.data as CompositeNodeData | LoopNodeData;
    if (!data.internalNodes || data.internalNodes.length === 0) return;

    // Push current state to context stack
    setContextStack((prev) => [
      ...prev,
      { label: data.label, nodes: [...nodes], edges: [...edges] },
    ]);

    // Replace canvas with internal nodes/edges
    setNodes(data.internalNodes.map((n) => ({ ...n })));
    setEdges(data.internalEdges.map((e) => ({ ...e })));
  }, [nodes, edges, setNodes, setEdges]);

  // ── Navigate back from sub-editor ──
  const navigateBack = useCallback(() => {
    setContextStack((prev) => {
      if (prev.length === 0) return prev;
      const ctx = prev[prev.length - 1];
      setNodes(ctx.nodes);
      setEdges(ctx.edges);
      return prev.slice(0, -1);
    });
  }, [setNodes, setEdges]);

  // ── Ungroup composite node ──
  const handleUngroup = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || (node.type !== 'compositeNode' && node.type !== 'loopNode')) return;
    const data = node.data as CompositeNodeData | LoopNodeData;

    // Reconstruct original positions
    const internalNodes = data.internalNodes.map((n) => ({
      ...n,
      position: {
        x: n.position.x + node.position.x,
        y: n.position.y + node.position.y,
      },
    }));

    // Remap external edges back
    const compositePortToInternal = new Map<string, { nodeId: string; portId: string }>();
    for (const p of data.inputs) {
      const parts = p.id.split('/');
      if (parts.length >= 2) {
        compositePortToInternal.set(p.id, { nodeId: parts[0], portId: parts[1] });
      }
    }
    for (const p of data.outputs) {
      const parts = p.id.split('/');
      if (parts.length >= 2) {
        compositePortToInternal.set(p.id, { nodeId: parts[0], portId: parts[1] });
      }
    }

    const ungroupedEdges = edges
      .filter((e) => e.source !== nodeId && e.target !== nodeId)
      .map((e) => {
        if (e.source === nodeId) {
          const mapping = compositePortToInternal.get(e.sourceHandle || '');
          if (mapping) return { ...e, source: mapping.nodeId, sourceHandle: mapping.portId };
        }
        if (e.target === nodeId) {
          const mapping = compositePortToInternal.get(e.targetHandle || '');
          if (mapping) return { ...e, target: mapping.nodeId, targetHandle: mapping.portId };
        }
        return e;
      });

    pushUndo();
    setNodes((nds) => [
      ...nds.filter((n) => n.id !== nodeId),
      ...internalNodes,
    ]);
    setEdges([...ungroupedEdges, ...data.internalEdges.map((e) => ({ ...e }))]);
  }, [nodes, edges, setNodes, setEdges, pushUndo]);

  // ── Group sidebar modules ──
  const groupedModules = CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      modules: ATOMIC_MODULES.filter((m) => m.category === cat),
    }))
    .filter((g) => g.modules.length > 0);

  // Breadcrumb
  const breadcrumbPath = [
    { label: '根画布', depth: 0 },
    ...contextStack.map((ctx, i) => ({
      label: ctx.label,
      depth: i + 1,
    })),
  ];

  // ── Render ──
  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 100px)', gap: 0 }}>
      {/* ── Sidebar ── */}
      {sidebarOpen && (
        <aside style={{
          width: 240, flexShrink: 0, background: '#fafafa',
          borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 12px', borderBottom: '1px solid #e0e0e0',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 12, fontWeight: 600, color: '#666',
          }}>
            <span>📦 模块库</span>
            <button
              onClick={() => setSidebarOpen(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 14 }}
            >
              ✕
            </button>
          </div>

          {/* Wrap-as-module button */}
          {selectedNodeIds.length >= 2 && !isSubEditor && (
            <div style={{ padding: '8px', borderBottom: '1px solid #e0e0e0' }}>
              <button
                onClick={handleWrapSelected}
                style={{
                  width: '100%', padding: '8px',
                  background: '#6a4c93', color: '#fff',
                  border: 'none', borderRadius: 8,
                  cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >
                📦 封装为模块 ({selectedNodeIds.length}节点)
              </button>
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
            {groupedModules.map((group) => (
              <div key={group.category} style={{ marginBottom: 12 }}>
                <div style={{
                  fontSize: 10, fontWeight: 600, color: '#aaa',
                  marginBottom: 4, padding: '0 4px', textTransform: 'uppercase',
                }}>
                  {group.category}
                </div>
                {group.modules.map((mod) => (
                  <SidebarModuleItem key={mod.id} mod={mod} onDragStart={onSidebarDragStart} />
                ))}
              </div>
            ))}

            {/* Add loop button */}
            {!isSubEditor && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e0e0e0' }}>
                <button
                  onClick={() => setLoopDialog({ open: true, name: '', mode: 'count', count: 3, foreachVar: 'item', untilCondition: '' })}
                  style={{
                    width: '100%', padding: '10px',
                    background: '#ede7f6', color: '#5e35b1',
                    border: '1px solid #b39ddb', borderRadius: 8,
                    cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  }}
                >
                  ⟳ 添加循环
                </button>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ── Canvas area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px', background: '#fff', borderBottom: '1px solid #e0e0e0',
          fontSize: 12, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Back button in sub-editor */}
            {isSubEditor && (
              <button
                onClick={navigateBack}
                style={{
                  background: '#6a4c93', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                  fontSize: 12, fontWeight: 500,
                }}
              >
                ← 返回
              </button>
            )}
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {breadcrumbPath.map((crumb, i) => (
                <span key={crumb.depth} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {i > 0 && <span style={{ color: '#ccc' }}>›</span>}
                  <span style={{
                    color: crumb.depth === breadcrumbPath.length - 1 ? '#6a4c93' : '#999',
                    fontWeight: crumb.depth === breadcrumbPath.length - 1 ? 600 : 400,
                  }}>
                    {crumb.label}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Search */}
            {(searchFocused || searchQuery) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg style={{ width: 12, height: 12, color: '#aaa' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => { if (!searchQuery) setSearchFocused(false); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setSearchQuery(''); setSearchFocused(false); }
                    if (e.key === 'Enter' && searchQuery && rfInstance) {
                      const q = searchQuery.toLowerCase();
                      const found = nodes.find((n) => {
                        const label = (n.data as any).label || '';
                        const mid = (n.data as any).module?.id || '';
                        return label.toLowerCase().includes(q) || mid.toLowerCase().includes(q);
                      });
                      if (found) {
                        rfInstance.setCenter(found.position.x, found.position.y, { zoom: 1.5, duration: 400 });
                        setSelectedNodeIds([found.id]);
                      }
                    }
                  }}
                  placeholder="搜索节点... (Ctrl+F)"
                  style={{
                    width: 160, padding: '4px 8px', borderRadius: 4,
                    border: '1px solid #ccc', fontSize: 12, outline: 'none',
                  }}
                />
              </div>
            )}
            {!searchFocused && !searchQuery && (
              <button
                onClick={() => setSearchFocused(true)}
                title="搜索节点 (Ctrl+F)"
                style={toolBtnStyle}
              >🔍</button>
            )}

            {/* Run / Cancel buttons */}
            {!isSubEditor && (
              <>
                <button
                  onClick={execStatus === 'running' ? handleCancel : handleExecute}
                  disabled={nodes.filter(n => n.type !== 'loopNode' || (n.data as any).internalNodes?.length > 0).length === 0}
                  style={{
                    padding: '5px 16px', borderRadius: 6,
                    background: execStatus === 'running' ? '#c62828' : '#1a1a2e',
                    color: '#fff', border: 'none',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  }}
                >
                  {execStatus === 'running' ? '■ 取消' : '▶ 运行'}
                </button>
                <div style={{ width: 1, height: 20, background: '#ddd' }} />
                <button
                  onClick={handleUndo}
                  disabled={undoStack.current.length === 0}
                  title="撤销 (Ctrl+Z)"
                  style={toolBtnStyle}
                >↩</button>
                <button
                  onClick={handleRedo}
                  disabled={redoStack.current.length === 0}
                  title="重做 (Ctrl+Shift+Z)"
                  style={toolBtnStyle}
                >↪</button>
                <button
                  onClick={handleAutoLayout}
                  disabled={nodes.length < 2}
                  title="自动布局 (Ctrl+L)"
                  style={toolBtnStyle}
                >⊞</button>
              </>
            )}
            <span style={{ color: '#aaa' }}>
              {nodes.length} 节点 · {edges.length} 连线
            </span>
            {selectedEdgeIds.length > 0 && (
              <span style={{ color: '#ef5350', fontSize: 11 }}>
                ⚡ 已选连线 (按 Delete 删除)
              </span>
            )}
            {selectedNodeIds.length > 0 && (
              <>
                <span style={{ color: '#6a4c93' }}>
                  已选 {selectedNodeIds.length}
                </span>
                {selectedNodeIds.length >= 2 && !isSubEditor && (
                  <button
                    onClick={handleWrapSelected}
                    style={{
                      background: '#6a4c93', color: '#fff', border: 'none',
                      borderRadius: 4, padding: '3px 10px', cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    封装
                  </button>
                )}
                {/* Ungroup button for selected composite */}
                {selectedNodeIds.length === 1 && (() => {
                  const selNode = nodes.find((n) => n.id === selectedNodeIds[0]);
                  if (selNode?.type === 'compositeNode' || selNode?.type === 'loopNode') {
                    return (
                      <button
                        onClick={() => handleUngroup(selectedNodeIds[0])}
                        style={{
                          background: '#fff', color: '#6a4c93', border: '1px solid #6a4c93',
                          borderRadius: 4, padding: '3px 10px', cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        取消分组
                      </button>
                    );
                  }
                  return null;
                })()}
              </>
            )}
          </div>
        </div>

        {/* React Flow canvas */}
        <div style={{ flex: 1, position: 'relative' }} ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={setRfInstance}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeClick={onEdgeClick}
            onEdgeContextMenu={onEdgeContextMenu}
            onEdgeMouseEnter={(_e, edge) => setHoveredEdgeId(edge.id)}
            onEdgeMouseLeave={() => setHoveredEdgeId(null)}
            onBeforeDelete={async () => { pushUndo(); return true; }}
            onSelectionChange={onSelectionChange}
            onPaneClick={() => { setSelectedEdgeIds([]); setContextMenu(null); }}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            deleteKeyCode={[]}
            snapToGrid
            snapGrid={[10, 10]}
            style={{ background: '#f8f9fa' }}
            selectNodesOnDrag={false}
            panOnDrag={[1, 2]}
            selectionOnDrag
            edgesFocusable
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e0e0e0" />
            <Controls />
            <MiniMap style={{ width: 150, height: 100 }} position="bottom-left" />
          </ReactFlow>

          {/* Sidebar toggle */}
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              style={{
                position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
                background: '#1a1a2e', color: '#fff', border: 'none',
                borderRadius: '0 8px 8px 0', padding: '12px 6px',
                cursor: 'pointer', zIndex: 10, fontSize: 14,
              }}
              title="打开模块库"
            >
              📦
            </button>
          )}
        </div>

        {/* ── Execution log ── */}
        {execLogs.length > 0 && (
          <div style={{
            maxHeight: 120, overflowY: 'auto',
            background: '#1a1a2e', padding: '8px 12px',
            fontFamily: 'monospace', fontSize: 11, lineHeight: 1.6,
            borderTop: '1px solid #333', flexShrink: 0,
          }}>
            {execLogs.map((entry, i) => (
              <div key={i} style={{
                color: entry.kind === 'error' ? '#ef5350'
                  : entry.kind === 'start' ? '#42a5f5'
                  : entry.kind === 'complete' ? '#66bb6a'
                  : '#e0e0e0',
              }}>
                {entry.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed', left: contextMenu.x, top: contextMenu.y,
            zIndex: 200, background: '#fff', borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            border: '1px solid #e0e0e0', minWidth: 140,
            overflow: 'hidden',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleDuplicateNode(contextMenu.nodeId)}
            style={{
              display: 'block', width: '100%', padding: '8px 16px',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, textAlign: 'left', borderBottom: '1px solid #f0f0f0',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#f0ecf7'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
          >
            📋 复制节点
          </button>
          <button
            onClick={() => handleDeleteNode(contextMenu.nodeId)}
            style={{
              display: 'block', width: '100%', padding: '8px 16px',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, textAlign: 'left', color: '#c62828',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = '#ffebee'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
          >
            🗑 删除节点
          </button>
        </div>
      )}

      {/* ── Wrap modal ── */}
      {wrapModal.open && (
        <div
          onClick={() => setWrapModal({ open: false, name: '' })}
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
              width: 400, maxWidth: '90vw',
              boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 18, color: '#1a1a2e' }}>
              📦 封装为复合模块
            </h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>
                模块名称
              </label>
              <input
                type="text"
                value={wrapModal.name}
                onChange={(e) => setWrapModal((p) => ({ ...p, name: e.target.value }))}
                placeholder="输入模块名称..."
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 6,
                  border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box',
                }}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && confirmWrap()}
              />
            </div>
            {wrapDataRef.current && (
              <div style={{
                background: '#f8f6fc', borderRadius: 6, padding: '8px 12px',
                fontSize: 12, color: '#6a4c93', marginBottom: 16,
              }}>
                {wrapDataRef.current.internalNodes.length} 节点 · {wrapDataRef.current.internalEdges.length} 内部连线
                <br />
                对外暴露 {wrapDataRef.current.derived.inputs.length} 输入 · {wrapDataRef.current.derived.outputs.length} 输出
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setWrapModal({ open: false, name: '' })}
                style={{
                  padding: '8px 20px', background: '#fff', color: '#666',
                  border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', fontSize: 14,
                }}
              >
                取消
              </button>
              <button
                onClick={confirmWrap}
                disabled={!wrapModal.name.trim()}
                style={{
                  padding: '8px 20px',
                  background: !wrapModal.name.trim() ? '#ccc' : '#6a4c93',
                  color: '#fff', border: 'none', borderRadius: 8,
                  cursor: !wrapModal.name.trim() ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 600,
                }}
              >
                确认封装
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Loop dialog ── */}
      {loopDialog.open && (
        <div
          onClick={() => setLoopDialog((p) => ({ ...p, open: false }))}
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
              width: 400, maxWidth: '90vw',
              boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 18, color: '#5e35b1' }}>
              ⟳ 添加循环容器
            </h3>

            {/* Name */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>名称</label>
              <input
                type="text"
                value={loopDialog.name}
                onChange={(e) => setLoopDialog((p) => ({ ...p, name: e.target.value }))}
                placeholder="循环名称..."
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 6,
                  border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box',
                }}
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && confirmAddLoop()}
              />
            </div>

            {/* Mode selector */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>循环模式</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['count', 'foreach', 'until'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setLoopDialog((p) => ({ ...p, mode: m }))}
                    style={{
                      flex: 1, padding: '6px 10px', borderRadius: 6,
                      border: `1px solid ${loopDialog.mode === m ? '#5e35b1' : '#ddd'}`,
                      background: loopDialog.mode === m ? '#ede7f6' : '#fff',
                      color: loopDialog.mode === m ? '#5e35b1' : '#666',
                      cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    {m === 'count' ? '固定次数' : m === 'foreach' ? '遍历列表' : '直到条件'}
                  </button>
                ))}
              </div>
            </div>

            {/* Config based on mode */}
            {loopDialog.mode === 'count' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>循环次数</label>
                <input
                  type="number"
                  min={1} max={1000}
                  value={loopDialog.count}
                  onChange={(e) => setLoopDialog((p) => ({ ...p, count: parseInt(e.target.value) || 1 }))}
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {loopDialog.mode === 'foreach' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>遍历变量名</label>
                <input
                  type="text"
                  value={loopDialog.foreachVar}
                  onChange={(e) => setLoopDialog((p) => ({ ...p, foreachVar: e.target.value }))}
                  placeholder="item"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            {loopDialog.mode === 'until' && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>停止匹配字符串</label>
                <input
                  type="text"
                  value={loopDialog.untilCondition}
                  onChange={(e) => setLoopDialog((p) => ({ ...p, untilCondition: e.target.value }))}
                  placeholder="success"
                  style={{
                    width: '100%', padding: '8px 12px', borderRadius: 6,
                    border: '1px solid #ddd', fontSize: 13, boxSizing: 'border-box',
                  }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setLoopDialog((p) => ({ ...p, open: false }))}
                style={{
                  padding: '8px 20px', background: '#fff', color: '#666',
                  border: '1px solid #ddd', borderRadius: 8, cursor: 'pointer', fontSize: 14,
                }}
              >
                取消
              </button>
              <button
                onClick={confirmAddLoop}
                style={{
                  padding: '8px 20px',
                  background: '#5e35b1', color: '#fff',
                  border: 'none', borderRadius: 8,
                  cursor: 'pointer', fontSize: 14, fontWeight: 600,
                }}
              >
                添加循环
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
