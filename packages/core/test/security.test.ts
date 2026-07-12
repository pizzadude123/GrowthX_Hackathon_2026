import { describe, expect, it } from 'vitest';
import { parseGitHubRepository, resolveRunMode, sanitizeRelativePath, redactSecrets } from '../src/security.js';

describe('repository security policy', () => {
  it('normalizes a GitHub settings URL to a repository identity', () => {
    expect(parseGitHubRepository('https://github.com/pizzadude123/GrowthX_Hackathon_2026/settings')).toEqual({
      owner: 'pizzadude123',
      name: 'GrowthX_Hackathon_2026',
      key: 'pizzadude123/GrowthX_Hackathon_2026',
      canonicalUrl: 'https://github.com/pizzadude123/GrowthX_Hackathon_2026'
    });
  });

  it('rejects non-GitHub hosts and traversal paths', () => {
    expect(() => parseGitHubRepository('https://evil.example/a/b')).toThrow();
    expect(() => sanitizeRelativePath('../secret')).toThrow();
  });

  it('allows repairs only for exact allowlist entries', () => {
    expect(resolveRunMode('acme/demo', 'acme/demo,acme/fork')).toBe('guarded_repair');
    expect(resolveRunMode('acme/other', 'acme/demo,acme/fork')).toBe('audit_only');
  });

  it('redacts likely credentials', () => {
    const output = redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});
