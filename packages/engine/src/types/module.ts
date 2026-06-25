/**
 * Module types — module definition, handler signature, and execution context.
 *
 * These types define the contract between the execution engine and any
 * registered module. Modules are registered at engine initialisation time
 * and identified by a string ID (e.g. "encode/base64").
 *
 * A module = definition (metadata) + handler (execution logic).
 */

// ── Port definition ────────────────────────────────────────────────────────

export type PortDirection = 'input' | 'output';

export interface PortDef {
  id: string;
  label?: string;
  type?: string;          // optional type hint, e.g. "string", "number", "buffer"
  required?: boolean;
  description?: string;
}

// ── Config field ───────────────────────────────────────────────────────────

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'select' | 'code';

export interface ConfigFieldOption {
  label: string;
  value: string;
}

export interface ConfigFieldDef {
  key: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  description?: string;
  options?: ConfigFieldOption[];  // for 'select' type
  min?: number;                    // for 'number' type
  max?: number;                    // for 'number' type
}

// ── Module definition ──────────────────────────────────────────────────────

export type ModuleComplexity = 'basic' | 'advanced' | 'expert';

export interface ModuleDef {
  /** Unique module ID, e.g. "encode/base64" */
  id: string;

  /** Display name for the editor UI */
  name: string;

  /** Category for grouping in the module palette */
  category: string;

  /** Short description */
  description: string;

  /** Complexity tier — controls visibility in the editor's progressive UI */
  complexity: ModuleComplexity;

  /** Input ports */
  inputs: PortDef[];

  /** Output ports */
  outputs: PortDef[];

  /** Configurable fields (shown as form in the editor) */
  configFields: ConfigFieldDef[];
}

// ── Module execution context ───────────────────────────────────────────────

/**
 * Runtime context provided to every module handler.
 *
 * Modules should treat this as read-only (except log/progress which are
 * side-effect channels back to the user).
 */
export interface ModuleContext {
  /** Resolved input values keyed by port id */
  inputs: Record<string, unknown>;

  /** Resolved config values keyed by config field key */
  config: Record<string, unknown>;

  /**
   * Pipeline-level variables (user-defined, not step outputs).
   * Read-only during execution.
   */
  variables: Record<string, unknown>;

  /**
   * Log a message. Pushed to the frontend execution log in real-time.
   */
  log: (level: 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;

  /**
   * Abort signal — fires when the user or system cancels execution.
   * Modules should check `aborted` periodically in long operations.
   *
   * Minimal interface (avoids dependency on DOM/Node types).
   */
  signal: { readonly aborted: boolean; readonly reason?: unknown };

  /**
   * Report execution progress (0–100).
   * Pushed to the frontend as a progress bar update.
   */
  progress: (percent: number) => void;
}

// ── Module handler ─────────────────────────────────────────────────────────

/**
 * A module handler is an async function that receives context and returns
 * output values keyed by output port id.
 *
 * @example
 * ```typescript
 * const handler: ModuleHandler = async (ctx) => {
 *   ctx.log('info', 'processing...', { size: ctx.inputs.data.length });
 *   const result = transform(ctx.inputs.data, ctx.config);
 *   return { output: result };
 * };
 * ```
 */
export type ModuleHandler = (ctx: ModuleContext) => Promise<Record<string, unknown>>;

// ── Module registration ────────────────────────────────────────────────────

/**
 * A fully registered module = definition + handler.
 */
export interface RegisteredModule {
  definition: ModuleDef;
  handler: ModuleHandler;
}
