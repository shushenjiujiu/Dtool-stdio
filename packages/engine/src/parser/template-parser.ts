/**
 * TemplateParser — loads YAML/JSON templates and converts them to TemplateDef.
 *
 * Pipeline:
 *   Raw YAML/JSON string
 *       ↓ js-yaml / JSON.parse
 *   Unvalidated object
 *       ↓ validateStructure() (Layer 1)
 *   Structurally-valid object
 *       ↓ normalize()
 *   TemplateDef (typed)
 *       ↓ validateSemantics() (Layer 2, optional)
 *   Validated TemplateDef
 */

import { load as parseYaml } from 'js-yaml';
import type { TemplateDef, ValidationResult } from '../types/index.js';
import { validateStructure } from '../validator/validator.js';

export interface ParseResult {
  /** The parsed template, if successful */
  template?: TemplateDef;

  /** Validation result (errors if parsing failed) */
  validation: ValidationResult;

  /** Human-friendly error message (if any) */
  error?: string;
}

/**
 * Parse a YAML string into a TemplateDef.
 *
 * @param yaml — Raw YAML string
 * @returns ParseResult — success or error with validation details
 */
export function parseYamlTemplate(yaml: string): ParseResult {
  let raw: unknown;

  // Step 1: Parse YAML
  try {
    raw = parseYaml(yaml, { filename: 'template.yaml' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      validation: {
        valid: false,
        errors: [{
          code: 'struct/invalid-type',
          message: `YAML parse error: ${message}`,
          severity: 'error',
        }],
        get blocking() { return this.errors; },
        get warnings() { return []; },
      },
      error: message,
    };
  }

  // Step 2: Validate structure
  const structResult = validateStructure(raw);
  if (!structResult.valid) {
    return {
      validation: structResult,
      error: structResult.errors[0]?.message ?? 'Structure validation failed',
    };
  }

  // Step 3: Normalize to typed TemplateDef
  try {
    const template = normalizeTemplate(raw as Record<string, unknown>);
    return { template, validation: structResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      validation: {
        valid: false,
        errors: [{
          code: 'struct/invalid-type',
          message: `Normalization error: ${message}`,
          severity: 'error',
        }],
        get blocking() { return this.errors; },
        get warnings() { return []; },
      },
      error: message,
    };
  }
}

/**
 * Parse a JSON string into a TemplateDef.
 *
 * @param json — Raw JSON string
 * @returns ParseResult
 */
export function parseJsonTemplate(json: string): ParseResult {
  let raw: unknown;

  try {
    raw = JSON.parse(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      validation: {
        valid: false,
        errors: [{
          code: 'struct/invalid-type',
          message: `JSON parse error: ${message}`,
          severity: 'error',
        }],
        get blocking() { return this.errors; },
        get warnings() { return []; },
      },
      error: message,
    };
  }

  const structResult = validateStructure(raw);
  if (!structResult.valid) {
    return {
      validation: structResult,
      error: structResult.errors[0]?.message ?? 'Structure validation failed',
    };
  }

  try {
    const template = normalizeTemplate(raw as Record<string, unknown>);
    return { template, validation: structResult };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      validation: {
        valid: false,
        errors: [{
          code: 'struct/invalid-type',
          message: `Normalization error: ${message}`,
          severity: 'error',
        }],
        get blocking() { return this.errors; },
        get warnings() { return []; },
      },
      error: message,
    };
  }
}

// ── Normalization ──────────────────────────────────────────────────────────

function normalizeTemplate(raw: Record<string, unknown>): TemplateDef {
  const flow = raw.flow as Record<string, unknown> | undefined;

  return {
    version: String(raw.version),
    name: String(raw.name),
    description: String(raw.description),
    category: String(raw.category),
    tags: raw.tags ? (raw.tags as string[]) : undefined,
    author: raw.author ? String(raw.author) : undefined,
    created: raw.created ? String(raw.created) : undefined,
    params: normalizeParams(raw.params),
    flow: {
      steps: normalizeSteps(flow?.steps as unknown[] ?? []),
    },
  };
}

function normalizeParams(raw: unknown): TemplateDef['params'] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p, i) => normalizeParam(p, i));
}

function normalizeParam(raw: unknown, _index: number): TemplateDef['params'][number] {
  const p = raw as Record<string, unknown>;
  return {
    id: String(p.id),
    label: String(p.label),
    type: String(p.type) as TemplateDef['params'][number]['type'],
    required: p.required === true,
    default: p.default,
    placeholder: p.placeholder ? String(p.placeholder) : undefined,
    description: p.description ? String(p.description) : undefined,
    options: Array.isArray(p.options)
      ? (p.options as Array<{ label: string; value: string }>)
      : undefined,
    min: typeof p.min === 'number' ? p.min : undefined,
    max: typeof p.max === 'number' ? p.max : undefined,
  };
}

function normalizeSteps(raw: unknown[]): TemplateDef['flow']['steps'] {
  return raw.map((s, i) => normalizeStep(s, i));
}

function normalizeStep(raw: unknown, _index: number): TemplateDef['flow']['steps'][number] {
  const s = raw as Record<string, unknown>;
  const step: TemplateDef['flow']['steps'][number] = {
    id: String(s.id),
    module: String(s.module),
    label: s.label ? String(s.label) : undefined,
    config: s.config ? (s.config as Record<string, unknown>) : undefined,
    export: s.export ? String(s.export) : undefined,
    substeps: Array.isArray(s.substeps)
      ? (s.substeps as unknown[]).map((sub, j) => normalizeStep(sub, j))
      : undefined,
  };
  return step;
}
