/**
 * Validation types — structure and semantic check results.
 */

// ── Error severity ─────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info';

// ── Error codes ────────────────────────────────────────────────────────────

/**
 * Categorised error codes for programmatic handling.
 *
 * Naming convention: `<area>/<specific>`
 */
export type ValidationCode =
  // ── Structure errors (JSON Schema level) ──
  | 'struct/missing-required-field'
  | 'struct/invalid-type'
  | 'struct/invalid-enum-value'

  // ── Semantic errors (cross-field checks) ──
  | 'semantic/param-undefined'           // $param.xxx references non-existent param
  | 'semantic/steps-undefined'           // $steps.xxx references non-existent step
  | 'semantic/steps-out-of-scope'        // $steps references step in child scope (not allowed)
  | 'semantic/duplicate-step-id'         // Two steps share the same id
  | 'semantic/loop-missing-count'        // loop module without config.count
  | 'semantic/loop-missing-substeps'     // loop module without substeps
  | 'semantic/loop-count-exceeds-limit'  // loop count > MAX_LOOP_ITERATIONS
  | 'semantic/loop-self-ref-loop'        // substep references $steps of itself (circular)
  | 'semantic/branch-not-implemented'    // module: "branch" is reserved, not yet usable
  | 'semantic/module-not-registered'     // module string not found in registry
  | 'semantic/dynamic-module-not-in-options' // $param-based module value not in registered modules
  | 'semantic/unresolved-reference'      // dangling $ reference after all replacements
  | 'semantic/param-circular-default'    // param default references itself via $param

  // ── Runtime limits ──
  | 'limit/loop-depth-exceeded'          // nested loop depth > 3
  | 'limit/pipeline-size-exceeded'       // total steps > limit
;

// ── Validation result ──────────────────────────────────────────────────────

export interface ValidationError {
  /** Error code for programmatic handling */
  code: ValidationCode;

  /** Human-readable description */
  message: string;

  /** Severity — errors block execution, warnings are informational */
  severity: ValidationSeverity;

  /** JSON Pointer path to the offending field, e.g. "/flow/steps/2/config/count" */
  path?: string;

  /** Step id where the error occurred (if applicable) */
  stepId?: string;
}

export interface ValidationResult {
  /** true if no errors (warnings/info are allowed) */
  valid: boolean;

  /** All validation issues found */
  errors: ValidationError[];

  /** Convenience: only errors (excludes warnings/info) */
  get blocking(): ValidationError[];

  /** Convenience: only warnings */
  get warnings(): ValidationError[];
}
