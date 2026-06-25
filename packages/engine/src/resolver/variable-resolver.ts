/**
 * VariableResolver — resolves `$param.xxx` and `$steps.xxx` references.
 *
 * Two-phase design:
 *
 * Phase 1 — `resolveTemplate()`: Template load time.
 *   Replaces all `$param.xxx` references with the user-provided parameter
 *   values. `$steps.xxx` references are preserved as literal strings;
 *   they will be resolved at runtime.
 *
 * Phase 2 — `resolveStepConfig()`: Execution time.
 *   Called by the runner for each step before execution. Takes the step's
 *   config (which may still contain `$steps.xxx` strings) and replaces
 *   them using the current StepOutputs from the scope chain.
 *
 * Supports:
 *   - `$param.xxx`         → exact replacement from params dict
 *   - `$steps.xxx`         → exact replacement from step outputs
 *   - `$steps.xxx.output`  → same as `$steps.xxx` (`.output` stripped)
 *   - `"pre-$param.x-suf"` → inline substring replacement
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

// ── Phase 1: Resolve $param references ─────────────────────────────────────

/**
 * Resolve all `$param` references in a template definition.
 *
 * `$steps` references are preserved as literal strings; they will be
 * resolved at runtime in Phase 2.
 */
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

// ── Phase 2: Resolve $steps references at runtime ─────────────────────────

/**
 * Resolve all `$steps` references in a single step's config at runtime.
 *
 * Called by the runner before each step, using the current scope chain's
 * accumulated step outputs.
 */
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

// ── Resolution context ─────────────────────────────────────────────────────

interface ResolveCtx {
  /** User-provided parameter values keyed by param id */
  params: Record<string, unknown>;

  /** Accumulated step outputs from already-executed steps */
  stepOutputs: StepOutputs;

  /**
   * If true, resolve `$steps.xxx` references.
   * If false, leave them as-is (they'll be resolved at runtime).
   */
  resolveSteps: boolean;
}

// ── Step-level resolution ──────────────────────────────────────────────────

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

// ── Value resolution (recursive) ───────────────────────────────────────────

function resolveConfigValue(value: unknown, ctx: ResolveCtx): unknown {
  if (typeof value === 'string') {
    return resolveString(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveConfigValue(item, ctx));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveConfigValue(v, ctx);
    }
    return out;
  }
  return value; // number, boolean, null — pass through
}

// ── String resolution ──────────────────────────────────────────────────────

function resolveString(value: string, ctx: ResolveCtx): string {
  // 1. Escape $$ → placeholder
  const unescaped = value.replace(/\$\$/g, '\0ESC');

  // 2. Find and replace all references
  let lastIndex = 0;
  const parts: string[] = [];
  let match: RegExpExecArray | null;

  REF_REGEX.lastIndex = 0;

  while ((match = REF_REGEX.exec(unescaped)) !== null) {
    const [fullMatch, scope, key, tail] = match;
    const refIndex = match.index;

    // Append text before this match
    parts.push(unescaped.slice(lastIndex, refIndex));

    // Resolve this reference
    const resolved = resolveReference(scope, key, ctx);
    if (resolved === RESOLVE_LATER) {
      // $steps reference in Phase 1 — preserve the original string
      parts.push(fullMatch);
    } else if (resolved === undefined) {
      throw new ResolutionError('UNRESOLVED_REFERENCE', fullMatch);
    } else {
      parts.push(String(resolved));
    }

    lastIndex = refIndex + fullMatch.length;

    // If this was $steps.xxx.output, the REF_REGEX already consumed ".output"
    // as group[3], so lastIndex is correctly past it. No special handling needed.
  }

  // Append remaining text after last match
  parts.push(unescaped.slice(lastIndex));

  // 3. Check for dangling $-prefixed segments not caught by regex
  const combined = parts.join('');
  const dangling = combined.match(/(?<!\0ESC)\$[a-zA-Z_]\w*/);
  if (dangling) {
    throw new ResolutionError(
      'UNRESOLVED_REFERENCE',
      `Dangling variable-like token: "${dangling[0]}"`,
    );
  }

  // 4. Restore escaped dollar signs
  return combined.replace(/\0ESC/g, '$');
}

// ── Reference lookup ───────────────────────────────────────────────────────

/**
 * Sentinel value: signals that a `$steps` reference should be preserved
 * as-is because we're in Phase 1 (param resolution only).
 */
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
      // Phase 1: preserve $steps reference for runtime
      return RESOLVE_LATER;
    }
    // Phase 2: look up in step outputs
    return ctx.stepOutputs.get(key);
  }

  return undefined;
}

// ── Resolution error ───────────────────────────────────────────────────────

export class ResolutionError extends Error {
  readonly code: string;
  readonly reference: string;

  constructor(code: string, reference: string) {
    const message = code === 'UNRESOLVED_REFERENCE'
      ? `Unresolved variable reference: "${reference}"`
      : `Resolution error (${code}): ${reference}`;
    super(message);
    this.name = 'ResolutionError';
    this.code = code;
    this.reference = reference;
  }
}
