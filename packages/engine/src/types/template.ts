/**
 * Template Schema types — aligned with dtool Studio Schema v0.1
 *
 * These represent the raw template format as loaded from YAML/JSON,
 * before any variable resolution ($param / $steps references are still present).
 */

// ── ParamDef ────────────────────────────────────────────────────────────────

export type ParamType = 'string' | 'number' | 'select' | 'boolean' | 'textarea';

export interface SelectOption {
  label: string;
  value: string;
}

export interface ParamDef {
  id: string;
  label: string;
  type: ParamType;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  description?: string;

  // select 专属
  options?: SelectOption[];

  // number 专属
  min?: number;
  max?: number;
}

// ── StepDef ────────────────────────────────────────────────────────────────

/**
 * A single step in the pipeline.
 *
 * - `module`: Module ID string, or `"loop"` / `"branch"` for special modules.
 * - `config`: Module configuration. Values may contain `$param.xxx` or
 *   `$steps.xxx` variable references.
 * - `substeps`: Only valid when `module` is `"loop"` or `"branch"`.
 *   Contains the inner steps of the loop/branch body.
 * - `export`: Names this step's output so it can be referenced by a readable
 *   label. This is metadata only; the variable system uses `$steps.<id>`
 *   as the canonical reference.
 */
export interface StepDef {
  id: string;
  module: string;
  label?: string;
  config?: Record<string, unknown>;
  export?: string;

  /** Inner sub-steps (loop body, branch body). Only valid for loop/branch. */
  substeps?: StepDef[];
}

// ── TemplateDef ────────────────────────────────────────────────────────────

export interface FlowDef {
  steps: StepDef[];
}

export interface TemplateDef {
  version: string;
  name: string;
  description: string;
  category: string;

  tags?: string[];
  author?: string;
  created?: string;

  params: ParamDef[];
  flow: FlowDef;
}
