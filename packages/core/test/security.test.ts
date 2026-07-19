import { describe, expect, it } from 'vitest';
import { parseGitHubRepository, sanitizeRelativePath, redactSecrets } from '../src/security.js';

describe('repository security policy', () => {
  it('normalizes a GitHub settings URL or owner/repository to a repository identity', () => {
    const expected = {
      owner: 'pizzadude123',
      name: 'GrowthX_Hackathon_2026',
      key: 'pizzadude123/GrowthX_Hackathon_2026',
      canonicalUrl: 'https://github.com/pizzadude123/GrowthX_Hackathon_2026'
    };
    expect(parseGitHubRepository('https://github.com/pizzadude123/GrowthX_Hackathon_2026/settings')).toEqual(expected);
    expect(parseGitHubRepository('pizzadude123/GrowthX_Hackathon_2026.git')).toEqual(expected);
  });

  it('rejects non-GitHub hosts and traversal paths', () => {
    expect(() => parseGitHubRepository('https://evil.example/a/b')).toThrow();
    expect(() => sanitizeRelativePath('../secret')).toThrow();
  });


  it('redacts likely credentials', () => {
    const output = redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');
    expect(output).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});
