import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.js';

function response(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockGitHub(privateRepo = false, truncated = false, extraSourceFiles = 0) {
  const calls: string[] = [];
  const extraTree = Array.from({ length: extraSourceFiles }, (_, index) => ({ path: `src/extra-${index}.ts`, type: 'blob', size: 20, url: `https://api.github.com/blobs/extra-${index}` }));
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/repos/acme/demo')) return response({ default_branch: 'main', size: 42, private: privateRepo });
    if (url.endsWith('/repos/acme/demo/branches/main')) return response({ commit: { sha: '0123456789abcdef0123456789abcdef01234567' } });
    if (url.includes('/git/trees/0123456789')) return response({ sha: 'tree-sha', truncated, tree: [
      { path: 'docs/guide.md', type: 'blob', size: 20, url: 'https://api.github.com/blobs/docs' },
      { path: 'src/main.vue', type: 'blob', size: 20, url: 'https://api.github.com/blobs/main' },
      { path: 'db/schema.sql', type: 'blob', size: 20, url: 'https://api.github.com/blobs/sql' },
      { path: 'scripts/deploy.sh', type: 'blob', size: 20, url: 'https://api.github.com/blobs/sh' },
      { path: 'package.json', type: 'blob', size: 20, url: 'https://api.github.com/blobs/package' },
      { path: 'node_modules/noise.js', type: 'blob', size: 20, url: 'https://api.github.com/blobs/noise' },
      ...extraTree,
    ] });
    const path = url.includes('/blobs/') ? url.split('/blobs/')[1] : url.split('/0123456789abcdef0123456789abcdef01234567/')[1];
    const contents: Record<string, string> = {
      package: '{"scripts":{"test":"vitest"}}',
      'package.json': '{"scripts":{"test":"vitest"}}',
      main: '<script>export default {}</script>',
      'src/main.vue': '<script>export default {}</script>',
      sql: 'create table runs (id text);',
      'db/schema.sql': 'create table runs (id text);',
      sh: '#!/bin/sh\nset -eu',
      'scripts/deploy.sh': '#!/bin/sh\nset -eu',
      docs: '# Guide',
      'docs/guide.md': '# Guide',
    };
    const content = contents[path ?? ''];
    if (content === undefined) return response({ message: 'not found' }, 404);
    return privateRepo ? response({ encoding: 'base64', content: Buffer.from(content).toString('base64') }) : response(content);
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

describe('GitHub repository inspection', () => {
  it('uses an immutable commit SHA and supports common polyglot source files', async () => {
    const mock = mockGitHub();
    const repository = await new GitHubClient(undefined, mock.fetcher).inspect('https://github.com/acme/demo');
    expect(repository.sourceSha).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(repository.files.map((file) => file.path)).toEqual(expect.arrayContaining(['package.json', 'src/main.vue', 'db/schema.sql', 'scripts/deploy.sh']));
    expect(repository.files.some((file) => file.path.includes('node_modules'))).toBe(false);
    expect(mock.calls.some((url) => url.includes('/git/trees/0123456789abcdef'))).toBe(true);
  });

  it('rejects private repositories even when an authenticated token can read them', async () => {
    const mock = mockGitHub(true);
    await expect(new GitHubClient('token', mock.fetcher).inspect('acme/demo')).rejects.toThrow('public repositories only');
    expect(mock.calls.some((url) => url.includes('/branches/'))).toBe(false);
  });

  it('explains authentication requirements for inaccessible repositories', async () => {
    const fetcher = (async () => response({ message: 'Not Found' }, 404)) as typeof fetch;
    await expect(new GitHubClient(undefined, fetcher).inspect('acme/missing')).rejects.toThrow('not found or requires GitHub authentication');
  });

  it('blocks truncated repository trees instead of claiming full verification', async () => {
    const mock = mockGitHub(false, true);
    await expect(new GitHubClient(undefined, mock.fetcher).inspect('acme/demo')).rejects.toThrow('tree is truncated');
  });

  it('blocks repositories whose supported source set exceeds the bounded audit', async () => {
    const mock = mockGitHub(false, false, 81);
    await expect(new GitHubClient(undefined, mock.fetcher).inspect('acme/demo')).rejects.toThrow('supported file limit');
  });
});
