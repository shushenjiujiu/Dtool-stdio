/**
 * Validator — two-layer template validation.
 *
 * Layer 1 — Structure validation (JSON Schema):
 *   Checks field types, required fields, enum values.
 *   Runs synchronously, suitable for frontend real-time feedback.
 *
 * Layer 2 — Semantic validation (cross-field logic):
 *   Checks `$param` existence, step id uniqueness, loop completeness,
 *   module existence, reference validity.
 *   Requires access to the module registry; runs on the backend.
 */

import type {
  TemplateDef,
  ParamDef,
  StepDef,
  ValidationError,
  ValidationResult,
  ValidationCode,
  ValidationSeverity,
} from '../types/index.js';

// ── Layer 1: Structure validation ──────────────────────────────────────────

// Minimal JSON Schema validation without ajv dependency for Phase 1.
// We check the critical structural fields directly; full JSON Schema
// enforcement can use ajv when the schema file is finalized.

interface SchemaValidationRule {
  field: string;
  type?: string;
  required?: boolean;
  enum?: string[];
  pattern?: RegExp;
  minLength?: number;
  maxLength?: number;
}

const TOP_LEVEL_RULES: SchemaValidationRule[] = [
  { field: 'version', type: 'string', required: true, pattern: /^\d+\.\d+$/ },
  { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 64 },
  { field: 'description', type: 'string', required: true, maxLength: 256 },
  { field: 'category', type: 'string', required: true },
  { field: 'params', type: 'array', required: true },
  { field: 'flow', type: 'object', required: true },
];

const VALID_CATEGORIES = new Set([
  '编码/解码', '格式转换', '合并/拆分', '循环/批量', '安全检测', '工具', '自定义',
]);

const VALID_PARAM_TYPES = new Set([
  'string', 'number', 'select', 'boolean', 'textarea',
]);

/**
 * Layer 1: Structural validation.
 * Fast, synchronous, no external dependencies.
 */
export function validateStructure(template: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (template === null || typeof template !== 'object') {
    return errorResult([{
      code: 'struct/invalid-type',
      message: 'Template must be a valid object',
      severity: 'error',
    }]);
  }

  const obj = template as Record<string, unknown>;

  // Check top-level required fields
  for (const rule of TOP_LEVEL_RULES) {
    if (rule.required && !(rule.field in obj)) {
      errors.push({
        code: 'struct/missing-required-field',
        message: `Missing required field: "${rule.field}"`,
        severity: 'error',
        path: `/${rule.field}`,
      });
      continue;
    }

    const value = obj[rule.field];

    if (rule.type === 'array' && !Array.isArray(value)) {
      errors.push({
        code: 'struct/invalid-type',
        message: `"${rule.field}" must be an array`,
        severity: 'error',
        path: `/${rule.field}`,
      });
    } else if (value !== undefined && typeof value !== rule.type) {
      errors.push({
        code: 'struct/invalid-type',
        message: `"${rule.field}" must be of type ${rule.type}`,
        severity: 'error',
        path: `/${rule.field}`,
      });
    }
  }

  // Check category validity
  if (typeof obj.category === 'string' && !VALID_CATEGORIES.has(obj.category)) {
    errors.push({
      code: 'struct/invalid-enum-value',
      message: `Invalid category "${obj.category}". Valid: ${[...VALID_CATEGORIES].join(', ')}`,
      severity: 'error',
      path: '/category',
    });
  }

  // Check version format
  if (typeof obj.version === 'string' && !/^\d+\.\d+$/.test(obj.version)) {
    errors.push({
      code: 'struct/invalid-enum-value',
      message: `Invalid version "${obj.version}". Must be "major.minor" format, e.g. "0.1"`,
      severity: 'error',
      path: '/version',
    });
  }

  // Validate params array structure
  if (Array.isArray(obj.params)) {
    (obj.params as unknown[]).forEach((param, i) => {
      validateParam(param, i, errors);
    });
  }

  // Validate flow structure
  if (obj.flow && typeof obj.flow === 'object') {
    const flow = obj.flow as Record<string, unknown>;
    if (!Array.isArray(flow.steps)) {
      errors.push({
        code: 'struct/missing-required-field',
        message: 'flow must contain a "steps" array',
        severity: 'error',
        path: '/flow/steps',
      });
    }
  }

  return toResult(errors);
}

function validateParam(param: unknown, index: number, errors: ValidationError[]): void {
  if (param === null || typeof param !== 'object') {
    errors.push({
      code: 'struct/invalid-type',
      message: `params[${index}] must be an object`,
      severity: 'error',
      path: `/params/${index}`,
    });
    return;
  }

  const p = param as Record<string, unknown>;

  if (typeof p.id !== 'string') {
    errors.push({
      code: 'struct/missing-required-field',
      message: `params[${index}] missing required field "id"`,
      severity: 'error',
      path: `/params/${index}/id`,
    });
  }
  if (typeof p.label !== 'string') {
    errors.push({
      code: 'struct/missing-required-field',
      message: `params[${index}] missing required field "label"`,
      severity: 'error',
      path: `/params/${index}/label`,
    });
  }
  if (typeof p.type !== 'string' || !VALID_PARAM_TYPES.has(p.type)) {
    errors.push({
      code: 'struct/invalid-enum-value',
      message: `params[${index}] "type" must be one of: ${[...VALID_PARAM_TYPES].join(', ')}`,
      severity: 'error',
      path: `/params/${index}/type`,
    });
  }
  if (p.type === 'select' && !Array.isArray(p.options)) {
    errors.push({
      code: 'struct/missing-required-field',
      message: `params[${index}] type "select" requires "options" array`,
      severity: 'error',
      path: `/params/${index}/options`,
    });
  }
}

// ── Layer 2: Semantic validation ───────────────────────────────────────────

export interface SemanticValidatorOptions {
  /** Map of registered module IDs (for module existence check) */
  registeredModules?: Set<string>;

  /** Maximum allowed loop iterations */
  maxLoopIterations?: number;

  /** Maximum nested loop depth */
  maxLoopDepth?: number;
}

const DEFAULT_OPTIONS: Required<SemanticValidatorOptions> = {
  registeredModules: new Set(),
  maxLoopIterations: 10000,
  maxLoopDepth: 3,
};

/**
 * Layer 2: Semantic validation.
 * Checks cross-field constraints that JSON Schema cannot express.
 *
 * Requires parsed TemplateDef (not raw object).
 */
export function validateSemantics(
  template: TemplateDef,
  options?: SemanticValidatorOptions,
): ValidationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: ValidationError[] = [];

  // Collect all param ids for reference checking
  const paramIds = new Set(template.params.map((p) => p.id));

  // Collect all step ids from the entire pipeline (top-level + nested)
  const allStepIds = collectStepIds(template.flow.steps);

  // 1. Check step id uniqueness
  const seenIds = new Set<string>();
  checkDuplicateIds(template.flow.steps, seenIds, errors, '/flow/steps');

  // 2. Validate loop modules
  checkLoops(template.flow.steps, errors, opts, '/flow/steps', 1);

  // 3. Check $param references
  checkParamRefs(template.flow.steps, paramIds, errors, '/flow/steps');

  // 4. Check $steps references
  checkStepsRefs(template.flow.steps, allStepIds, errors, '/flow/steps');

  // 5. Check module existence (non-dynamic modules only)
  checkModulesExist(template.flow.steps, opts.registeredModules, errors, '/flow/steps');

  return toResult(errors);
}

// ── Semantic checks ─────────────────────────────────────────────────────────

/**
 * Collect all step ids from the step tree (recursive).
 */
function collectStepIds(steps: StepDef[]): Set<string> {
  const ids = new Set<string>();
  for (const step of steps) {
    ids.add(step.id);
    if (step.substeps) {
      const childIds = collectStepIds(step.substeps);
      childIds.forEach((id) => ids.add(id));
    }
  }
  return ids;
}

/**
 * Check that no two sibling steps share the same id.
 * (Shadowing across scopes is allowed, but within the same scope it's not.)
 */
function checkDuplicateIds(
  steps: StepDef[],
  seenIds: Set<string>,
  errors: ValidationError[],
  basePath: string,
): void {
  for (let i = 0; i < steps.length; i++) {
    if (seenIds.has(steps[i].id)) {
      errors.push({
        code: 'semantic/duplicate-step-id',
        message: `Duplicate step id "${steps[i].id}" in the same scope`,
        severity: 'error',
        path: `${basePath}/${i}/id`,
        stepId: steps[i].id,
      });
    }
    seenIds.add(steps[i].id);

    // Recursively check substeps (they have their own scope, new seenIds)
    if (steps[i].substeps) {
      const childSeen = new Set<string>();
      checkDuplicateIds(steps[i].substeps!, childSeen, errors, `${basePath}/${i}/substeps`);
    }
  }
}

/**
 * Check loop modules for required fields and constraints.
 */
function checkLoops(
  steps: StepDef[],
  errors: ValidationError[],
  opts: Required<SemanticValidatorOptions>,
  basePath: string,
  depth: number,
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.module === 'branch') {
      errors.push({
        code: 'semantic/branch-not-implemented',
        message: 'Branch module is reserved but not yet implemented',
        severity: 'error',
        path: `${basePath}/${i}/module`,
        stepId: step.id,
      });
    }

    if (step.module === 'loop') {
      // Check count
      if (!step.config || !('count' in step.config)) {
        errors.push({
          code: 'semantic/loop-missing-count',
          message: `Loop "${step.id}" must have a "count" in config`,
          severity: 'error',
          path: `${basePath}/${i}/config/count`,
          stepId: step.id,
        });
      }

      // Check substeps
      if (!step.substeps || step.substeps.length === 0) {
        errors.push({
          code: 'semantic/loop-missing-substeps',
          message: `Loop "${step.id}" must have at least one substep`,
          severity: 'error',
          path: `${basePath}/${i}/substeps`,
          stepId: step.id,
        });
      }

      // Check loop depth
      if (depth > opts.maxLoopDepth) {
        errors.push({
          code: 'limit/loop-depth-exceeded',
          message: `Nested loop depth exceeds maximum of ${opts.maxLoopDepth}`,
          severity: 'error',
          path: `${basePath}/${i}`,
          stepId: step.id,
        });
      }

      // Check count within limit
      if (step.config && step.config.count !== undefined) {
        const count = Number(step.config.count);
        if (!isNaN(count) && count > opts.maxLoopIterations) {
          errors.push({
            code: 'semantic/loop-count-exceeds-limit',
            message: `Loop count ${count} exceeds maximum of ${opts.maxLoopIterations}`,
            severity: 'error',
            path: `${basePath}/${i}/config/count`,
            stepId: step.id,
          });
        }
      }

      // Recursively validate substeps
      if (step.substeps) {
        checkLoops(step.substeps, errors, opts, `${basePath}/${i}/substeps`, depth + 1);
      }
    }

    // Recurse for non-loop modules that may have substeps (branch placeholder etc.)
    if (step.substeps && step.module !== 'loop') {
      checkLoops(step.substeps, errors, opts, `${basePath}/${i}/substeps`, depth + 1);
    }
  }
}

/**
 * Verify all `$param.xxx` references in config values correspond to
 * declared params.
 */
function checkParamRefs(
  steps: StepDef[],
  paramIds: Set<string>,
  errors: ValidationError[],
  basePath: string,
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.config) {
      const refs = extractParamRefs(step.config);
      for (const ref of refs) {
        if (!paramIds.has(ref)) {
          errors.push({
            code: 'semantic/param-undefined',
            message: `$param.${ref} references undefined parameter "${ref}"`,
            severity: 'error',
            path: `${basePath}/${i}/config`,
            stepId: step.id,
          });
        }
      }
    }

    // Dynamic module selection via $param
    if (step.module.startsWith('$param.')) {
      const paramKey = step.module.slice(7); // "$param." → key
      if (!paramIds.has(paramKey)) {
        errors.push({
          code: 'semantic/param-undefined',
          message: `Module selection references undefined parameter "${paramKey}"`,
          severity: 'error',
          path: `${basePath}/${i}/module`,
          stepId: step.id,
        });
      }
    }

    // Recurse into substeps
    if (step.substeps) {
      checkParamRefs(step.substeps, paramIds, errors, `${basePath}/${i}/substeps`);
    }
  }
}

/**
 * Extract all `$param.xxx` keys referenced in a config object (recursive).
 */
function extractParamRefs(config: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const PARAM_REF = /\$param\.(\w+)/g;

  function walk(value: unknown): void {
    if (typeof value === 'string') {
      let m: RegExpExecArray | null;
      PARAM_REF.lastIndex = 0;
      while ((m = PARAM_REF.exec(value)) !== null) {
        refs.push(m[1]);
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) {
        walk(v);
      }
    }
  }

  walk(config);
  return [...new Set(refs)]; // deduplicate
}

/**
 * Verify all `$steps.xxx` references point to existing step ids within
 * the same scope or parent scopes.
 *
 * Simplified: for now, checks global step id existence.
 * Full scope-chain-aware checking is a future enhancement.
 */
function checkStepsRefs(
  steps: StepDef[],
  allStepIds: Set<string>,
  errors: ValidationError[],
  basePath: string,
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.config) {
      const refs = extractStepsRefs(step.config);
      for (const ref of refs) {
        if (!allStepIds.has(ref)) {
          errors.push({
            code: 'semantic/steps-undefined',
            message: `$steps.${ref} references undefined step "${ref}"`,
            severity: 'error',
            path: `${basePath}/${i}/config`,
            stepId: step.id,
          });
        }
      }
    }

    if (step.substeps) {
      checkStepsRefs(step.substeps, allStepIds, errors, `${basePath}/${i}/substeps`);
    }
  }
}

/**
 * Extract all `$steps.xxx` keys referenced in a config object.
 */
function extractStepsRefs(config: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const STEPS_REF = /\$steps\.(\w+)(?:\.\w+)?/g;

  function walk(value: unknown): void {
    if (typeof value === 'string') {
      let m: RegExpExecArray | null;
      STEPS_REF.lastIndex = 0;
      while ((m = STEPS_REF.exec(value)) !== null) {
        refs.push(m[1]);
      }
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) {
        walk(v);
      }
    }
  }

  walk(config);
  return [...new Set(refs)];
}

/**
 * Verify that non-dynamic module references exist in the registry.
 */
function checkModulesExist(
  steps: StepDef[],
  registeredModules: Set<string>,
  errors: ValidationError[],
  basePath: string,
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Only check non-dynamic modules (those that don't start with $)
    if (!step.module.startsWith('$') && registeredModules.size > 0) {
      if (step.module !== 'loop' && step.module !== 'branch' && !registeredModules.has(step.module)) {
        errors.push({
          code: 'semantic/module-not-registered',
          message: `Module "${step.module}" is not registered`,
          severity: 'error',
          path: `${basePath}/${i}/module`,
          stepId: step.id,
        });
      }
    }

    if (step.substeps) {
      checkModulesExist(step.substeps, registeredModules, errors, `${basePath}/${i}/substeps`);
    }
  }
}

// ── Result helpers ─────────────────────────────────────────────────────────

function errorResult(errors: ValidationError[]): ValidationResult {
  return toResult(errors);
}

function toResult(errors: ValidationError[]): ValidationResult {
  const blocking = errors.filter((e) => e.severity === 'error');
  const warnings = errors.filter((e) => e.severity === 'warning');
  return {
    valid: blocking.length === 0,
    errors,
    get blocking(): ValidationError[] { return blocking; },
    get warnings(): ValidationError[] { return warnings; },
  };
}
