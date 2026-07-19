import { describe, expect, it } from 'vitest';
import { assertRunOwner, authorizedFor } from './token_scope.js';

const tokens = { commandToken: 'c'.repeat(40), workerToken: 'w'.repeat(40), deliveryToken: 'd'.repeat(40), releaseToken: 'r'.repeat(40),proxyToken:'p'.repeat(40) };

describe('control-plane token scopes', () => {
  it('allows the command token only on command routes', () => {
    expect(authorizedFor('command', `Bearer ${tokens.commandToken}`, tokens)).toBe(true);
    expect(authorizedFor('worker', `Bearer ${tokens.commandToken}`, tokens)).toBe(false);
  });

  it('allows the worker token only on worker routes', () => {
    expect(authorizedFor('worker', `Bearer ${tokens.workerToken}`, tokens)).toBe(true);
    expect(authorizedFor('command', `Bearer ${tokens.workerToken}`, tokens)).toBe(false);
  });

  it('isolates trusted delivery and release credentials from command and worker routes', () => {
    expect(authorizedFor('delivery', `Bearer ${tokens.deliveryToken}`, tokens)).toBe(true);
    expect(authorizedFor('release', `Bearer ${tokens.releaseToken}`, tokens)).toBe(true);
    expect(authorizedFor('proxy',`Bearer ${tokens.proxyToken}`,tokens)).toBe(true);
    for (const scope of ['command', 'worker', 'release'] as const) expect(authorizedFor(scope, `Bearer ${tokens.deliveryToken}`, tokens)).toBe(false);
    for (const scope of ['command', 'worker', 'delivery'] as const) expect(authorizedFor(scope, `Bearer ${tokens.releaseToken}`, tokens)).toBe(false);
    for(const scope of ['command','worker','delivery','release'] as const)expect(authorizedFor(scope,`Bearer ${tokens.proxyToken}`,tokens)).toBe(false);
  });

  it('rejects missing, short, or identical credentials', () => {
    expect(authorizedFor('command', undefined, tokens)).toBe(false);
    expect(authorizedFor('command', 'Bearer short', { ...tokens, commandToken: 'short' })).toBe(false);
    expect(authorizedFor('worker', `Bearer ${tokens.workerToken}`, { commandToken: tokens.workerToken, workerToken: tokens.workerToken })).toBe(false);
    expect(authorizedFor('delivery', `Bearer ${tokens.deliveryToken}`, { ...tokens, releaseToken: tokens.deliveryToken })).toBe(false);
  });

  it('rejects management of ownerless or differently owned runs', () => {
    expect(() => assertRunOwner(undefined, '123')).toThrow('owner');
    expect(() => assertRunOwner('123', '456')).toThrow('owner');
    expect(() => assertRunOwner('123', '123')).not.toThrow();
  });
});
