/**
 * ScopeChain — lexical scope chain for variable resolution during execution.
 *
 * Each loop iteration creates a new scope. References are resolved by
 * walking up the chain: innermost scope first, then parent, up to the root.
 *
 * Rules (aligned with Schema v0.1 §2.3):
 * - Child → Parent: substeps can `$steps`-reference outer steps    ✅
 * - Parent → Child: outer steps cannot see inside substeps          ❌
 * - Sibling: same-level steps can reference each other              ✅
 * - Shadowing: child scope id wins over parent with same id         ✅
 */

import type { StepOutputs } from '../types/index.js';

export class ScopeChain {
  /** Stack of scopes. Index 0 = root (top-level flow). */
  private scopes: StepOutputs[] = [];

  constructor() {
    // Root scope is always present
    this.scopes.push(new Map<string, unknown>());
  }

  // ── Scope lifecycle ──

  /** Enter a new child scope (e.g., on loop iteration start). */
  pushScope(): void {
    this.scopes.push(new Map<string, unknown>());
  }

  /** Exit the current child scope (e.g., on loop iteration end). */
  popScope(): void {
    if (this.scopes.length <= 1) {
      throw new Error('Cannot pop root scope');
    }
    this.scopes.pop();
  }

  /** The current nesting depth (1 = root only). */
  get depth(): number {
    return this.scopes.length;
  }

  // ── Step output read/write ──

  /**
   * Set a step's output in the current (innermost) scope.
   * This is the scope where the step is defined.
   */
  set(stepId: string, output: unknown): void {
    this.currentScope().set(stepId, output);
  }

  /**
   * Get a step's output by walking the scope chain from innermost outward.
   * Returns `undefined` if not found in any scope.
   */
  get(stepId: string): unknown | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (scope.has(stepId)) {
        return scope.get(stepId);
      }
    }
    return undefined;
  }

  /**
   * Check if a step id exists in the current scope only (not parents).
   */
  hasInCurrentScope(stepId: string): boolean {
    return this.currentScope().has(stepId);
  }

  /**
   * Check if a step id exists anywhere in the chain.
   */
  has(stepId: string): boolean {
    return this.get(stepId) !== undefined;
  }

  // ── Internals ──

  private currentScope(): StepOutputs {
    return this.scopes[this.scopes.length - 1];
  }
}
