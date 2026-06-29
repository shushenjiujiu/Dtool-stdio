import { describe, it, expect } from 'vitest';
import { ScopeChain } from '../scope/scope-chain.js';

describe('ScopeChain', () => {
  it('starts with root scope', () => {
    const chain = new ScopeChain();
    expect(chain.depth).toBe(1);
  });

  it('set/get in root scope', () => {
    const chain = new ScopeChain();
    chain.set('step_a', { data: 'hello' });
    expect(chain.get('step_a')).toEqual({ data: 'hello' });
  });

  it('returns undefined for unknown step', () => {
    const chain = new ScopeChain();
    expect(chain.get('nonexistent')).toBeUndefined();
  });

  it('pushScope increases depth', () => {
    const chain = new ScopeChain();
    chain.pushScope();
    expect(chain.depth).toBe(2);
    chain.pushScope();
    expect(chain.depth).toBe(3);
  });

  it('popScope decreases depth', () => {
    const chain = new ScopeChain();
    chain.pushScope();
    chain.pushScope();
    chain.popScope();
    expect(chain.depth).toBe(2);
    chain.popScope();
    expect(chain.depth).toBe(1);
  });

  it('child scope can read parent scope values', () => {
    const chain = new ScopeChain();
    chain.set('user', { name: 'alice' });

    chain.pushScope();
    const val = chain.get('user');
    expect(val).toEqual({ name: 'alice' });
  });

  it('child scope value shadows parent with same id', () => {
    const chain = new ScopeChain();
    chain.set('x', 'parent_value');

    chain.pushScope();
    chain.set('x', 'child_value');
    expect(chain.get('x')).toBe('child_value');

    chain.popScope();
    expect(chain.get('x')).toBe('parent_value');
  });

  it('parent scope cannot read child scope values', () => {
    const chain = new ScopeChain();
    chain.pushScope();
    chain.set('secret', 'hidden');
    chain.popScope();

    expect(chain.get('secret')).toBeUndefined();
  });

  it('has returns true only if step exists in chain', () => {
    const chain = new ScopeChain();
    chain.set('a', 1);
    expect(chain.has('a')).toBe(true);
    expect(chain.has('b')).toBe(false);
  });

  it('hasInCurrentScope returns false for parent steps when in child scope', () => {
    const chain = new ScopeChain();
    chain.set('parent_step', 'yes');
    chain.pushScope();
    expect(chain.hasInCurrentScope('parent_step')).toBe(false);
    expect(chain.has('parent_step')).toBe(true); // chain lookup still works
  });

  it('popScope on root scope throws', () => {
    const chain = new ScopeChain();
    expect(() => chain.popScope()).toThrow('Cannot pop root scope');
  });

  it('nested scopes resolve correctly (3 levels)', () => {
    const chain = new ScopeChain();
    chain.set('level', 'root');

    chain.pushScope();
    chain.set('level', 'l1');
    expect(chain.get('level')).toBe('l1');

    chain.pushScope();
    chain.set('level', 'l2');
    expect(chain.get('level')).toBe('l2');

    chain.popScope();
    expect(chain.get('level')).toBe('l1');

    chain.popScope();
    expect(chain.get('level')).toBe('root');
  });

  it('multiple steps in same scope', () => {
    const chain = new ScopeChain();
    chain.set('a', 1);
    chain.set('b', 2);
    chain.set('c', 3);
    expect(chain.get('a')).toBe(1);
    expect(chain.get('b')).toBe(2);
    expect(chain.get('c')).toBe(3);
  });
});
