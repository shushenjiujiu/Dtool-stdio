/**
 * @dtool-studio/engine — Execution engine for dtool Studio
 *
 * Public API surface:
 *   Types        — template, pipeline, module, validation, variable
 *   Resolver     — variable reference ($param, $steps) resolution
 *   Scope        — lexical scope chain for loop execution
 *   Validator    — two-layer template validation (structure + semantic)
 *   Parser       — YAML/JSON template loading
 */

// ── Types ──
export type {
  ParamType,
  SelectOption,
  ParamDef,
  StepDef,
  FlowDef,
  TemplateDef,
} from './types/template.js';

export type {
  ResolvedStepDef,
  ResolvedPipeline,
  StepOutputs,
} from './types/pipeline.js';

export type {
  ValidationSeverity,
  ValidationCode,
  ValidationError,
  ValidationResult,
} from './types/validation.js';

export type {
  PortDirection,
  PortDef,
  ConfigFieldType,
  ConfigFieldOption,
  ConfigFieldDef,
  ModuleComplexity,
  ModuleDef,
  ModuleContext,
  ModuleHandler,
  RegisteredModule,
} from './types/module.js';

export type {
  ResolutionContext,
  ResolvedConfig,
  VariableReference,
} from './types/variable.js';

// ── Resolver ──
export {
  resolveTemplate,
  resolveStepConfig,
  ResolutionError,
} from './resolver/variable-resolver.js';

// ── Scope ──
export { ScopeChain } from './scope/scope-chain.js';

// ── Validator ──
export {
  validateStructure,
  validateSemantics,
} from './validator/validator.js';
export type { SemanticValidatorOptions } from './validator/validator.js';

// ── Parser ──
export {
  parseYamlTemplate,
  parseJsonTemplate,
} from './parser/template-parser.js';
export type { ParseResult } from './parser/template-parser.js';
