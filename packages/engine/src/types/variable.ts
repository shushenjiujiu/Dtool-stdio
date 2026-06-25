/**
 * Variable resolver types — for the $param / $steps reference resolution system.
 *
 * Design decisions:
 *
 * 1. `.output` suffix support
 *    Both `$steps.xxx` and `$steps.xxx.output` are accepted as valid references
 *    to a step's full output. The resolver strips the `.output` suffix before
 *    lookup. This keeps examples consistent without breaking anything.
 *
 * 2. No expression evaluation
 *    Variable references are pure dictionary key lookups. No arithmetic,
 *    string concatenation of references, or function calls are supported.
 *    (Inline string replacement like `"prefix-$param.host-suffix"` IS supported.)
 *
 * 3. $$ escaping
 *    `$$` in a config value is replaced with a literal `$` before any
 *    variable substitution is attempted.
 */

/**
 * The context needed by the VariableResolver to resolve references.
 */
export interface ResolutionContext {
  /** User-provided parameter values (keyed by param id) */
  params: Record<string, unknown>;

  /**
   * Step outputs from already-executed steps.
   * Populated incrementally during pipeline execution.
   * Keyed by step id.
   */
  stepOutputs: Map<string, unknown>;

  /**
   * Maximum depth for nested loop resolution.
   * Prevents infinite recursion on malformed templates.
   */
  maxLoopDepth?: number;
}

/**
 * Result of resolving a single template step's config.
 */
export interface ResolvedConfig {
  /** The resolved config object (all references replaced) */
  config: Record<string, unknown>;

  /** Any warnings encountered during resolution (e.g. deprecated syntax) */
  warnings: string[];
}

/**
 * A single reference found during config scanning.
 */
export interface VariableReference {
  /** Full reference string, e.g. "$param.encode_type" or "$steps.read_input" */
  raw: string;

  /** Reference scope: "param" or "steps" */
  scope: 'param' | 'steps';

  /** The key being referenced, e.g. "encode_type" in "$param.encode_type" */
  key: string;

  /**
   * Whether this reference uses the explicit `.output` suffix.
   * Both `$steps.xxx` and `$steps.xxx.output` are valid.
   */
  hasExplicitOutput: boolean;

  /** Character offset in the source string (for error reporting) */
  offset: number;
}

// ── Resolution errors ──────────────────────────────────────────────────────

export interface ResolutionError {
  code: 'UNRESOLVED_PARAM' | 'UNRESOLVED_STEPS' | 'CIRCULAR_REFERENCE' | 'MAX_DEPTH_EXCEEDED';
  message: string;
  reference?: VariableReference;
  stepId?: string;
}
