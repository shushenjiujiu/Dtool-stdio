/**
 * Resolved Pipeline types — post-variable-resolution format.
 *
 * After `VariableResolver` replaces all `$param.xxx` and `$steps.xxx`
 * references with concrete values, the template becomes a ResolvedPipeline.
 *
 * This is the format the execution engine actually runs.
 */

/**
 * A single resolved step ready for execution.
 *
 * All variable references (`$param`, `$steps`) in `config` have been replaced
 * with concrete values. `substeps` (if present) are also fully resolved.
 */
export interface ResolvedStepDef {
  id: string;
  module: string;
  label?: string;
  config: Record<string, unknown>;
  substeps?: ResolvedStepDef[];
}

/**
 * A fully resolved pipeline — ready to hand off to the DAG scheduler.
 */
export interface ResolvedPipeline {
  steps: ResolvedStepDef[];
}

/**
 * Intermediate step outputs collected during execution.
 *
 * Keyed by step id. For loop modules, the value is the output of the
 * last iteration.
 *
 * Used internally by the engine to resolve `$steps.xxx` references
 * that point to already-executed steps.
 */
export type StepOutputs = Map<string, unknown>;
