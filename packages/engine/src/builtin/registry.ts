/**
 * Built-in module registry
 *
 * Registers all built-in modules (port from old dtool + Studio-specific).
 * Called once at server startup.
 */

import type { ModuleDef, ModuleHandler } from '../types/index.js';
import { ioModules } from './io.js';
import { encodeModules } from './encode.js';
import { securityModules } from './security.js';
import { transformModules } from './transform.js';
import { wrapModules } from './wrap.js';
import { loopDef, createLoopHandler, type LoopHandlerLookup } from './loop.js';

/**
 * Simple module registry that maps id → { definition, handler }.
 * Inline class to avoid circular dependency on a separate registry file.
 */
export class ModuleRegistry {
  private modules = new Map<string, { definition: ModuleDef; handler: ModuleHandler }>();

  /** Register a single module */
  register(definition: ModuleDef, handler: ModuleHandler): void {
    if (this.modules.has(definition.id)) {
      throw new Error(`Module already registered: ${definition.id}`);
    }
    this.modules.set(definition.id, { definition, handler });
  }

  /** Get a module by id */
  get(id: string): { definition: ModuleDef; handler: ModuleHandler } | undefined {
    return this.modules.get(id);
  }

  /** Check if a module is registered */
  has(id: string): boolean {
    return this.modules.has(id);
  }

  /** List all registered modules */
  list(): ModuleDef[] {
    return Array.from(this.modules.values()).map((m) => m.definition);
  }

  /** List modules by category */
  listByCategory(category: string): ModuleDef[] {
    return this.list().filter((m) => m.category === category);
  }

  /** Get count of registered modules */
  get size(): number {
    return this.modules.size;
  }
}

/**
 * Register all built-in modules into the provided registry.
 *
 * Usage:
 *   const registry = new ModuleRegistry();
 *   registerAll(registry);
 */
export function registerAll(registry: ModuleRegistry, lookup?: LoopHandlerLookup): void {
  const loopHandler = lookup
    ? createLoopHandler(lookup)
    : createLoopHandler({
        getModuleDef: (id) => registry.get(id)?.definition,
        getHandler: () => undefined,
      });

  const allModules: Array<{ definition: ModuleDef; handler: ModuleHandler }> = [
    ...ioModules,
    ...encodeModules,
    ...securityModules,
    ...transformModules,
    ...wrapModules,
    { definition: loopDef, handler: loopHandler },
  ];

  for (const mod of allModules) {
    registry.register(mod.definition, mod.handler);
  }
}
