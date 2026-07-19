import { describe, expect, it } from 'vitest';
import { authorizedFor } from './token_scope.js';

const tokens = { commandToken: 'c'.repeat(40), workerToken: 'w'.repeat(40) };

describe('control-plane token scopes', () => {
  it('allows the command token only on command routes', () => {
    expect(authorizedFor('command', `Bearer ${tokens.commandToken}`, tokens)).toBe(true);
    expect(authorizedFor('worker', `Bearer ${tokens.commandToken}`, tokens)).toBe(false);
  });

  it('allows the worker token only on worker routes', () => {
    expect(authorizedFor('worker', `Bearer ${tokens.workerToken}`, tokens)).toBe(true);
    expect(authorizedFor('command', `Bearer ${tokens.workerToken}`, tokens)).toBe(false);
  });

  it('rejects missing, short, or identical credentials', () => {
    expect(authorizedFor('command', undefined, tokens)).toBe(false);
    expect(authorizedFor('command', 'Bearer short', { ...tokens, commandToken: 'short' })).toBe(false);
    expect(authorizedFor('worker', `Bearer ${tokens.workerToken}`, { commandToken: tokens.workerToken, workerToken: tokens.workerToken })).toBe(false);
  });
});
