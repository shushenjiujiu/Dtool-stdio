/**
 * Validation types — structure and semantic check results.
 */

// ── Error severity ─────────────────────────────────────────────────────────

export type ValidationSeverity = 'error' | 'warning' | 'info';

// ── Error codes ────────────────────────────────────────────────────────────

/**
 * Error code string.
 *
 * Naming convention: `<area>/<specific>`
 * Examples: `struct/missing-required-field`, `semantic/param-undefined`,
 * `limit/loop-depth-exceeded`
 *
 * Using `string` instead of a precise union avoids maintenance burden
 * until there's actual switch-case logic consuming specific codes.
 */
export type ValidationCode = string;

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
