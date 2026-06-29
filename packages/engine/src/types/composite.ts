/**
 * CompositeModule — a module built from sub-modules (steps).
 *
 * A composite module looks like a ModuleMeta from the outside (same ports,
 * name, category) but internally it is a pipeline of steps with params.
 *
 * The TemplateDef type from template.ts is essentially a CompositeModule,
 * but the schema version/author/created metadata is template-specific.
 * CompositeModule strips those template-only fields to match ModuleMeta.
 *
 * The engine determines whether a module is atomic or composite by checking
 * whether it has steps (composite) or a handler (atomic) — no separate
 * `kind` flag needed.
 */

import type { ModuleMeta } from './module.js';
import type { ParamDef, StepDef } from './template.js';

export interface CompositeModule extends ModuleMeta {
  /** User-configurable parameters (maps to config form in the editor) */
  params: ParamDef[];

  /** Internal pipeline steps */
  steps: StepDef[];

  /** Template-specific metadata (optional) */
  author?: string;
  created?: string;
}
