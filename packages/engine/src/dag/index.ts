/**
 * DAG module — barrel export.
 */

export { deriveWires, resolveNodeInputs, validateWires } from './connection-resolver.js';
export type { WireError } from './connection-resolver.js';

export { topologicalSort, executeGraph } from './dag-executor.js';
export type { TopoSortResult, DagExecuteCallbacks, DagExecuteOptions } from './dag-executor.js';

export { buildGraph, COMPOSITE_SENTINEL } from './graph-builder.js';
export type { GraphBuilderOptions } from './graph-builder.js';

export { derivePorts, parseDerivedPortId } from './port-derivation.js';
export type { PortDerivationInput, DerivedPorts } from './port-derivation.js';

export { createCompositeHandler } from './composite-handler.js';
export type { CompositeModuleLookup } from './composite-handler.js';
