/**
 * VariableResolver — resolves `$param.xxx` and `$steps.xxx` references.
 *
 * Two-phase design:
 *
 * Phase 1 — `resolveTemplate()`: Template load time.
 *   Replaces all `$param.xxx` references with actual values.
 *   `$steps.xxx` references are preserved as literal strings for runtime.
 *
 * Phase 2 — `resolveStepConfig()`: Execution time.
 *   Replaces `$steps.xxx` references from the current StepOutputs scope.
 *
 * Supports:
 *   - `$param.xxx`         → exact replacement from params dict
 *   - `$steps.xxx`         → exact replacement from step outputs
 *   - `$steps.xxx.output`  → same as `$steps.xxx` (`.output` stripped)
 *   - `"pre-$param.x-suf"` → inline substring replacement (result as string)
 *   - `$$`                 → literal `$` (escape)
 *   - `module: "$param.x"` → dynamic module selection
 */

import type {
  TemplateDef,
  ResolvedPipeline,
  ResolvedStepDef,
  StepOutputs,
} from '../types/index.js';

// Match $param.xxx, $steps.xxx, or $steps.xxx.output
// Groups: [1]=scope, [2]=key, [3]=optional trailing (like "output")
const REF_REGEX = /\$(\w+)\.(\w+)(?:\.(\w+))?/g;

// ── Phase 1: Resolve $param references ──

export function resolveTemplate(
  template: TemplateDef,
  params: Record<string, unknown>,
): ResolvedPipeline {
  return {
    steps: template.flow.steps.map((step) =>
      resolveStep(step, { params, stepOutputs: new Map(), resolveSteps: false }),
    ),
  };
}

// ── Phase 2: Resolve $steps references at runtime ──

export function resolveStepConfig(
  rawConfig: Record<string, unknown>,
  stepOutputs: StepOutputs,
): Record<string, unknown> {
  return resolveConfigValue(rawConfig, {
    params: {},
    stepOutputs,
    resolveSteps: true,
  }) as Record<string, unknown>;
}

// ── Resolution context ──

interface ResolveCtx {
  params: Record<string, unknown>;
  stepOutputs: StepOutputs;
  resolveSteps: boolean;
}

// ── Step-level resolution ──

function resolveStep(
  step: TemplateDef['flow']['steps'][number],
  ctx: ResolveCtx,
): ResolvedStepDef {
  const config = step.config
    ? resolveConfigValue(step.config, ctx) as Record<string, unknown>
    : {};

  const module = step.module.startsWith('$')
    ? String(resolveConfigValue(step.module, ctx))
    : step.module;

  const substeps = step.substeps
    ? step.substeps.map((s) => resolveStep(s, ctx))
    : undefined;

  return { id: step.id, module, label: step.label, config, substeps };
}

// ── Value resolution (recursive) ──

function resolveConfigValue(value: unknown, ctx: ResolveCtx): unknown {
  if (typeof value === 'string') {
    return resolveStringValue(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveConfigValue(item, ctx));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      // Internal keys (_input, _stepIndex, etc.) bypass variable resolution
      out[k] = k.startsWith('_') ? v : resolveConfigValue(v, ctx);
    }
    return out;
  }
  return value; // number, boolean, null — pass through
}

// ── String resolution ──

interface RefMatch {
  fullMatch: string;
  scope: string;
  key: string;
  index: number;
  length: number;
}

function resolveStringValue(value: string, ctx: ResolveCtx): unknown {
  // 1. Unescape $$ → placeholder
  const unescaped = value.replace(/\$\$/g, '\0ESC');

  // 2. Collect all reference matches
  const refs: RefMatch[] = [];
  REF_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = REF_REGEX.exec(unescaped)) !== null) {
    refs.push({
      fullMatch: m[0],
      scope: m[1],
      key: m[2],
      index: m.index,
      length: m[0].length,
    });
  }

  if (refs.length === 0) {
    // No reference patterns found — check for dangling $ tokens
    const dangling = unescaped.match(/(?<!\0ESC)\$(?!(?:param|steps)\.)[a-zA-Z_]\w*/);
    if (dangling) {
      throw new ResolutionError(
        'UNRESOLVED_REFERENCE',
        `Dangling variable-like token: "${dangling[0]}"`,
      );
    }
    // Just restore $$ and return
    return unescaped.replace(/\0ESC/g, '$');
  }

  // 3. Check if the entire string is a single pure exact reference
  const isPureExactRef =
    refs.length === 1 &&
    refs[0].index === 0 &&
    refs[0].length === unescaped.length;

  // 4. Build parts by replacing each reference
  let lastIndex = 0;
  const parts: unknown[] = [];

  for (const ref of refs) {
    // Text before this reference
    if (ref.index > lastIndex) {
      parts.push(unescaped.slice(lastIndex, ref.index));
    }

    // Resolve this reference
    const resolved = resolveReference(ref.scope, ref.key, ctx);

    if (resolved === RESOLVE_LATER) {
      parts.push(ref.fullMatch);
    } else if (resolved === undefined) {
      throw new ResolutionError('UNRESOLVED_REFERENCE', `Unresolved reference: "${ref.fullMatch}"`);
    } else if (isPureExactRef) {
      // Pure exact match — return raw value (preserves type: object, number, etc.)
      // Don't push to parts; return immediately
      return resolved;
    } else {
      parts.push(resolved);
    }

    lastIndex = ref.index + ref.length;
  }

  // Remaining text after last match
  if (lastIndex < unescaped.length) {
    parts.push(unescaped.slice(lastIndex));
  }

  // 5. Dangling token check
  const combinedText = parts
    .map((p) => (typeof p === 'string' ? p : String(p)))
    .join('');
  const dangling = combinedText.match(/(?<!\0ESC)\$(?!(?:param|steps)\.)[a-zA-Z_]\w*/);
  if (dangling) {
    throw new ResolutionError(
      'UNRESOLVED_REFERENCE',
      `Dangling variable-like token: "${dangling[0]}"`,
    );
  }

  // 6. Restore $$ and join as string
  return parts
    .map((p) => (typeof p === 'string' ? p.replace(/\0ESC/g, '$') : String(p)))
    .join('');
}

// ── Reference lookup ──

const RESOLVE_LATER = Symbol('RESOLVE_LATER');

function resolveReference(
  scope: string,
  key: string,
  ctx: ResolveCtx,
): unknown | typeof RESOLVE_LATER | undefined {
  if (scope === 'param') {
    return ctx.params[key];
  }
  if (scope === 'steps') {
    if (!ctx.resolveSteps) {
      return RESOLVE_LATER;
    }
    return ctx.stepOutputs.get(key);
  }
  return undefined;
}

// ── Resolution error ──

export class ResolutionError extends Error {
  readonly code: string;
  readonly reference: string;

  constructor(code: string, reference: string) {
    const message = code === 'UNRESOLVED_REFERENCE'
      ? reference
      : `Resolution error (${code}): ${reference}`;
    super(message);
    this.name = 'ResolutionError';
    this.code = code;
    this.reference = reference;
  }
}
