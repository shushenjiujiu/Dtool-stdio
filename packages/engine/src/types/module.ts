/**
 * Module types — module definition, handler signature, and execution context.
 *
 * Architecture (per Heye's design):
 *   ModuleMeta       ← shared interface for ALL modules
 *     ├── ModuleDef  ← atomic module (code handler)
 *     └── CompositeModule ← composite module (built from sub-modules / steps)
 */

// ── Port definition ────────────────────────────────────────────────────────

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

// ── ModuleMeta — shared interface for all modules ──────────────────────────

/**
 * ModuleMeta is the common external interface for every module type:
 * atomic (code) modules and composite (built from steps) modules.
 *
 * The editor uses this to render the module palette, while the engine
 * branches based on whether a handler or steps are attached.
 */
export interface ModuleMeta {
  /** Unique module ID, e.g. "encode/base64" or "my-custom-pipeline" */
  id: string;

  /** Display name */
  name: string;

  /** Category for grouping in the module palette */
  category: string;

  /** Short description */
  description: string;

  tags?: string[];

  /** Input ports */
  inputs: PortDef[];

  /** Output ports */
  outputs: PortDef[];
}

// ── Atomic module (code) ──────────────────────────────────────────────────

export interface ModuleDef extends ModuleMeta {
  /** Configurable fields (shown as form in the editor) */
  configFields: ConfigFieldDef[];
}

// ── Module execution context ───────────────────────────────────────────────

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
   */
  signal: { readonly aborted: boolean; readonly reason?: unknown };

  /**
   * Report execution progress (0–100).
   * Pushed to the frontend as a progress bar update.
   */
  progress: (percent: number) => void;
}

// ── Module handler ─────────────────────────────────────────────────────────

export type ModuleHandler = (ctx: ModuleContext) => Promise<Record<string, unknown>>;

// ── Module registration ────────────────────────────────────────────────────

export interface RegisteredModule {
  definition: ModuleDef;
  handler: ModuleHandler;
}
