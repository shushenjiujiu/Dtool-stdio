/**
 * canvas-to-pipeline — Converts React Flow canvas state (nodes + edges)
 * into the engine's ResolvedPipeline + explicit wires format.
 *
 * Handles:
 *   - Atomic modules → ResolvedStepDef
 *   - Composite nodes → recursive expansion into substeps
 *   - Loop nodes → _loop module with substeps
 *   - Edges → Wire[]
 */

import type { Node, Edge } from '@xyflow/react';

// ── Engine types (defined locally to avoid cross-package dependency) ──

interface ResolvedStepDef {
  id: string;
  module: string;
  label?: string;
  config: Record<string, unknown>;
  substeps?: ResolvedStepDef[];
}

interface ResolvedPipeline {
  steps: ResolvedStepDef[];
}

interface Wire {
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

// ── Types from our canvas ──

interface CanvasPortDef {
  id: string;
  label: string;
  type: string;
}

interface CanvasModuleData {
  module?: { id: string };
  label?: string;
  inputs?: CanvasPortDef[];
  outputs?: CanvasPortDef[];
}

interface CanvasCompositeData extends CanvasModuleData {
  internalNodes: Node[];
  internalEdges: Edge[];
}

interface CanvasLoopData extends CanvasCompositeData {
  loopConfig: {
    mode: 'count' | 'foreach' | 'until';
    count?: number;
    foreachVar?: string;
    untilCondition?: string;
  };
}

/** Result of canvas → pipeline conversion */
export interface CanvasPipelineResult {
  pipeline: ResolvedPipeline;
  wires: Wire[];
  /** Maps canvas node ID → flat step ID */
  nodeToStep: Map<string, string>;
}

/**
 * Convert canvas nodes + edges → ResolvedPipeline + explicit wires.
 *
 * Composite and loop nodes are expanded recursively.
 * Edge wires are remapped to flat step IDs.
 */
export function canvasToPipeline(
  canvasNodes: Node[],
  canvasEdges: Edge[],
): CanvasPipelineResult {
  const steps: ResolvedStepDef[] = [];
  const wires: Wire[] = [];
  let stepCounter = 0;

  // Build node lookup
  const nodeMap = new Map<string, Node>();
  for (const n of canvasNodes) {
    nodeMap.set(n.id, n);
  }

  // Process all top-level nodes in topological-ish order
  // (Nodes with no incoming edges first, then dependents)
  const sortedIds = topoSort(canvasNodes, canvasEdges);

  // Map canvas node ID → flat step ID
  const idMap = new Map<string, string>();

  for (const nodeId of sortedIds) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    if (node.type === 'compositeNode') {
      const data = node.data as unknown as CanvasCompositeData;
      // Recursively expand composite
      const prefix = `s${++stepCounter}`;
      expandComposite(prefix, data, steps, wires, idMap, new Map<string, string>());
    } else if (node.type === 'loopNode') {
      const data = node.data as unknown as CanvasLoopData;
      const loopId = `s${++stepCounter}`;
      const loopSubsteps: ResolvedStepDef[] = [];
      const loopWires: Wire[] = [];
      const loopIdMap = new Map<string, string>();

      // Expand loop body
      for (const innerNode of data.internalNodes || []) {
        if (innerNode.type === 'compositeNode') {
          const innerData = innerNode.data as unknown as CanvasCompositeData;
          const prefix = `${loopId}_c${++stepCounter}`;
          expandComposite(prefix, innerData, loopSubsteps, loopWires, loopIdMap, new Map<string, string>());
        } else {
          const sid = `${loopId}_s${++stepCounter}`;
          const innerData = innerNode.data as unknown as CanvasModuleData;
          idMap.set(innerNode.id, sid);
          loopSubsteps.push({
            id: sid,
            module: innerData.module?.id || 'unknown',
            label: innerData.label,
            config: {},
          });

          // Add loop variable injection for first substep
          if (loopSubsteps.length === 1) {
            loopSubsteps[0].config = {
              ...loopSubsteps[0].config,
              _loop_index: '{{_loop_index}}',
              _loop_item: '{{_loop_item}}',
            };
          }
        }
      }

      // Map internal loop edges
      for (const e of data.internalEdges || []) {
        const srcSid = idMap.get(e.source);
        const tgtSid = idMap.get(e.target);
        if (srcSid && tgtSid) {
          loopWires.push({
            fromNode: srcSid,
            fromPort: e.sourceHandle || 'data',
            toNode: tgtSid,
            toPort: e.targetHandle || 'data',
          });
        }
      }

      steps.push({
        id: loopId,
        module: '_loop',
        label: data.label || '循环',
        config: {
          mode: data.loopConfig?.mode || 'count',
          count: data.loopConfig?.count ?? 3,
          foreachVar: data.loopConfig?.foreachVar,
          untilCondition: data.loopConfig?.untilCondition,
        },
        substeps: loopSubsteps.length > 0 ? loopSubsteps : undefined,
      });

      // Add loop internal wires
      if (loopWires.length > 0) {
        wires.push(...loopWires);
      }
    } else {
      // Atomic module
      const data = node.data as unknown as CanvasModuleData;
      const sid = `s${++stepCounter}`;
      idMap.set(nodeId, sid);

      const moduleId = data.module?.id || 'unknown';

      steps.push({
        id: sid,
        module: moduleId,
        label: data.label,
        config: {},
      });
    }
  }

  // Convert canvas edges → wires
  for (const e of canvasEdges) {
    const srcSid = idMap.get(e.source);
    const tgtSid = idMap.get(e.target);
    if (srcSid && tgtSid) {
      wires.push({
        fromNode: srcSid,
        fromPort: e.sourceHandle || 'data',
        toNode: tgtSid,
        toPort: e.targetHandle || 'data',
      });
    }
  }

  return { pipeline: { steps }, wires, nodeToStep: idMap };
}

/**
 * Expand a composite node's internal graph into flat steps + wires.
 */
function expandComposite(
  prefix: string,
  data: CanvasCompositeData,
  steps: ResolvedStepDef[],
  wires: Wire[],
  globalIdMap: Map<string, string>,
  localIdMap: Map<string, string>,
): void {
  let subCounter = 0;

  for (const innerNode of data.internalNodes || []) {
    if (innerNode.type === 'compositeNode') {
      const innerData = innerNode.data as unknown as CanvasCompositeData;
      expandComposite(`${prefix}_c${++subCounter}`, innerData, steps, wires, globalIdMap, localIdMap);
    } else if (innerNode.type === 'loopNode') {
      const innerData = innerNode.data as unknown as CanvasLoopData;
      const loopId = `${prefix}_l${++subCounter}`;
      const loopSubsteps: ResolvedStepDef[] = [];
      const loopWires: Wire[] = [];
      const loopIdMap = new Map<string, string>();

      for (const ln of innerData.internalNodes || []) {
        const sid = `${loopId}_s${++subCounter}`;
        const lnData = ln.data as unknown as CanvasModuleData;
        localIdMap.set(ln.id, sid);
        loopSubsteps.push({
          id: sid,
          module: lnData.module?.id || 'unknown',
          label: lnData.label,
          config: {},
        });
      }

      for (const le of innerData.internalEdges || []) {
        const srcSid = localIdMap.get(le.source);
        const tgtSid = localIdMap.get(le.target);
        if (srcSid && tgtSid) {
          loopWires.push({
            fromNode: srcSid,
            fromPort: le.sourceHandle || 'data',
            toNode: tgtSid,
            toPort: le.targetHandle || 'data',
          });
        }
      }

      steps.push({
        id: loopId,
        module: '_loop',
        label: innerData.label || '循环',
        config: {
          mode: innerData.loopConfig?.mode || 'count',
          count: innerData.loopConfig?.count ?? 3,
          foreachVar: innerData.loopConfig?.foreachVar,
          untilCondition: innerData.loopConfig?.untilCondition,
        },
        substeps: loopSubsteps.length > 0 ? loopSubsteps : undefined,
      });

      if (loopWires.length > 0) wires.push(...loopWires);
    } else {
      const sid = `${prefix}_s${++subCounter}`;
      const innerNodeData = innerNode.data as unknown as CanvasModuleData;
      localIdMap.set(innerNode.id, sid);
      globalIdMap.set(innerNode.id, sid);

      steps.push({
        id: sid,
        module: innerNodeData.module?.id || 'unknown',
        label: innerNodeData.label,
        config: {},
      });
    }
  }

  // Map internal edges → wires
  for (const e of data.internalEdges || []) {
    const srcSid = localIdMap.get(e.source) || globalIdMap.get(e.source);
    const tgtSid = localIdMap.get(e.target) || globalIdMap.get(e.target);
    if (srcSid && tgtSid) {
      wires.push({
        fromNode: srcSid,
        fromPort: e.sourceHandle || 'data',
        toNode: tgtSid,
        toPort: e.targetHandle || 'data',
      });
    }
  }
}

/**
 * Simple topological sort: nodes with no incoming edges first.
 */
function topoSort(nodes: Node[], edges: Edge[]): string[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }

  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      const deg = (inDegree.get(e.target) || 0) + 1;
      inDegree.set(e.target, deg);
      adj.get(e.source)?.push(e.target);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adj.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  // Any remaining nodes (cycles) — just append them
  for (const [id, deg] of inDegree) {
    if (deg > 0 && !sorted.includes(id)) {
      sorted.push(id);
    }
  }

  return sorted;
}
