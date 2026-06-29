/**
 * @dtool-studio/engine — Core type definitions
 *
 * All types are re-exported from this barrel file.
 * Consumers should import from `@dtool-studio/engine` directly.
 */

// ── Template types (raw format, pre-resolution) ──
export type {
  ParamType,
  SelectOption,
  ParamDef,
  StepDef,
  FlowDef,
  TemplateDef,
} from './template.js';

// ── Composite module types ──
export type {
  CompositeModule,
} from './composite.js';

// ── Pipeline types (post-resolution, execution-ready) ──
export type {
  ResolvedStepDef,
  ResolvedPipeline,
  StepOutputs,
} from './pipeline.js';

// ── Validation types ──
export type {
  ValidationSeverity,
  ValidationCode,
  ValidationError,
  ValidationResult,
} from './validation.js';

// ── Module types ──
export type {
  PortDef,
  ConfigFieldType,
  ConfigFieldOption,
  ConfigFieldDef,
  ModuleMeta,
  ModuleDef,
  ModuleContext,
  ModuleHandler,
  RegisteredModule,
} from './module.js';

// ── Variable resolver types ──
export type {
  ResolutionContext,
  ResolvedConfig,
  VariableReference,
} from './variable.js';

// ── DAG types ──
export type {
  PortType,
  Wire,
  ExecutionNode,
  ExecutionGraph,
} from './dag.js';
export { canConnect } from './dag.js';
