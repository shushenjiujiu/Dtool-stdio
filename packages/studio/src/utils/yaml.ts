/**
 * YAML serialization for dtool Studio pipeline save/load.
 *
 * Save: Serialize EditorSteps to YAML string → download .yaml
 * Load: Parse YAML string → EditorSteps
 */

import type { EditorStep } from '../pages/StepCard.js';

// ── Save ──

export function stepsToYaml(name: string, steps: EditorStep[]): string {
  const lines: string[] = [];
  lines.push('version: "0.1"');
  lines.push(`name: "${esc(name)}"`);
  lines.push('description: ""');
  lines.push('category: "自定义"');
  lines.push('params: []');
  lines.push('flow:');
  emitSteps(lines, steps, 2);
  return lines.join('\n') + '\n';
}

function emitSteps(lines: string[], steps: EditorStep[], indent: number, key: 'steps' | 'substeps' = 'steps'): void {
  const pad = ' '.repeat(indent);
  lines.push(`${pad}${key}:`);
  for (const step of steps) {
    const sp = ' '.repeat(indent + 2);
    lines.push(`${sp}- id: "${step.id}"`);
    lines.push(`${sp}  module: "${step.moduleId}"`);
    if (step.label) {
      lines.push(`${sp}  label: "${esc(step.label)}"`);
    }
    if (step.config && Object.keys(step.config).length > 0) {
      lines.push(`${sp}  config:`);
      for (const [key, value] of Object.entries(step.config)) {
        lines.push(`${sp}    ${key}: "${esc(String(value))}"`);
      }
    }
    if (step.substeps && step.substeps.length > 0) {
      emitSteps(lines, step.substeps, indent + 4, 'substeps');
    }
  }
}

// ── Download ──

export function downloadYaml(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/x-yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.yaml') ? filename : `${filename}.yaml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Parse ──

export function parseYaml(yaml: string): { name: string; steps: EditorStep[] } | null {
  try {
    const lines = yaml.split('\n');
    const result = parseLines(lines);
    if (!result) return null;

    const name = typeof result.name === 'string' ? result.name : '导入的模块';
    const flow = result.flow as Record<string, unknown> | undefined;
    const steps = parseSteps(flow?.steps);
    if (!steps) return null;

    return { name, steps };
  } catch {
    return null;
  }
}

function parseSteps(raw: unknown): EditorStep[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((s: unknown) => {
    const obj = s as Record<string, unknown>;
    const config: Record<string, unknown> = {};
    if (obj.config && typeof obj.config === 'object') {
      for (const [k, v] of Object.entries(obj.config as Record<string, unknown>)) {
        if (k.startsWith('_')) continue;
        config[k] = v;
      }
    }
    return {
      id: String(obj.id ?? ''),
      moduleId: String(obj.module ?? ''),
      config,
      label: obj.label ? String(obj.label) : undefined,
      substeps: Array.isArray(obj.substeps) ? parseSteps(obj.substeps) ?? undefined : undefined,
    };
  });
}

function esc(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ── Minimal YAML parser ──

function parseLines(lines: string[]): Record<string, unknown> | null {
  const fullText = lines.join('\n');
  // Try js-yaml if available
  try {
    // Dynamic require won't work in browser; fallback to simple parser
  } catch {}
  return simpleYamlParse(lines);
}

function simpleYamlParse(lines: string[]): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  const flowSteps: unknown[] = [];
  let inFlow = false;

  // Stack-based substep handling
  type StepObj = Record<string, unknown>;
  interface Ctx { target: unknown[]; indent: number }
  const stack: Ctx[] = [];

  function currentTarget(): unknown[] {
    return stack.length > 0 ? stack[stack.length - 1].target : flowSteps;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    // Pop stack when we leave a substep scope
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    // Top-level keys (indent 0)
    if (indent === 0) {
      if (content === 'flow:' || content === 'flow: {}') {
        inFlow = true;
        result.flow = {};
        continue;
      }
      const kv = content.match(/^([\w-]+):\s*(.+)$/);
      if (kv) {
        result[kv[1]] = kv[2].replace(/^["']|["']$/g, '').replace(/\\"/g, '"');
      }
      continue;
    }

    if (!inFlow) continue;

    // Flow level
    if (content === 'steps:') continue;
    if (content === 'params:') continue;

    // Step entry: "- id: \"xxx\""
    const stepMatch = content.match(/^- id:\s*"([^"]*)"\s*$/);
    if (stepMatch) {
      const step: StepObj = { id: stepMatch[1] };
      currentTarget().push(step);
      continue;
    }

    const arr = currentTarget();
    if (arr.length === 0) continue;
    const step = arr[arr.length - 1] as StepObj;

    if (content.startsWith('module:')) {
      const m = content.match(/module:\s*"?([^"]*)"?\s*$/);
      if (m) step.module = m[1];
    } else if (content.startsWith('label:')) {
      const m = content.match(/label:\s*(.+)$/);
      if (m) step.label = m[1].replace(/^["']|["']$/g, '').replace(/\\"/g, '"');
    } else if (content === 'config:') {
      step.config = {};
    } else if (content === 'substeps:') {
      step.substeps = [];
      stack.push({ target: step.substeps as unknown[], indent });
    } else if (content.includes(':') && !content.startsWith('-')) {
      const cfg = step.config as Record<string, unknown> | undefined;
      if (cfg) {
        const kv = content.match(/([\w-]+):\s*"([^"]*)"\s*$/);
        if (kv) { cfg[kv[1]] = kv[2].replace(/\\"/g, '"'); }
        else {
          const plain = content.match(/([\w-]+):\s*(.+)$/);
          if (plain && !plain[1].startsWith('-')) {
            cfg[plain[1]] = plain[2].replace(/^["']|["']$/g, '').replace(/\\"/g, '"');
          }
        }
      }
    }
  }

  if (!result.flow) result.flow = {};
  if (typeof result.flow === 'object') {
    (result.flow as Record<string, unknown>).steps = flowSteps;
  }

  return (!result.flow || !(result.flow as Record<string, unknown>).hasOwnProperty('steps')) ? null : result;
}
