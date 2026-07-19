import { describe, expect, it, vi } from 'vitest';
import { verifyPublicGitHubSnapshot } from './github_snapshot.js';

const sha = '0123456789abcdef0123456789abcdef01234567';
const treeSha = 'abcdef0123456789abcdef0123456789abcdef01';
const files = [
  { path: 'package.json', blobSha: '1'.repeat(40), bytes: 20 },
  { path: 'src/main.ts', blobSha: '2'.repeat(40), bytes: 30 },
];

function mockGitHub(privateRepository = false,includeGitlink=false) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/repos/acme/demo')) return new Response(JSON.stringify({ private: privateRepository }), { status: 200 });
    if (url.includes(`/git/commits/${sha}`)) return new Response(JSON.stringify({ sha, tree: { sha: treeSha } }), { status: 200 });
    if (url.includes(`/git/trees/${treeSha}`)) return new Response(JSON.stringify({ truncated: false, tree: [
      { path: 'package.json', type: 'blob', sha: '1'.repeat(40), size: 20 },
      { path: 'src/main.ts', type: 'blob', sha: '2'.repeat(40), size: 30 },
      { path: 'node_modules/noise.js', type: 'blob', sha: '3'.repeat(40), size: 10 },
      ...(includeGitlink?[{path:'vendor/linked',type:'commit',sha:'4'.repeat(40)}]:[]),
    ] }), { status: 200 });
    return new Response('missing', { status: 404 });
  }) as typeof fetch;
}

describe('server-side GitHub snapshot binding', () => {
  it('independently resolves a complete public tree and returns a digest', async () => {
    await expect(verifyPublicGitHubSnapshot('acme/demo', sha, files, mockGitHub())).resolves.toMatchObject({ snapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/), snapshotFiles: files });
  });

  it('rejects private repositories and mismatched worker manifests', async () => {
    await expect(verifyPublicGitHubSnapshot('acme/demo', sha, files, mockGitHub(true))).rejects.toThrow('public');
    await expect(verifyPublicGitHubSnapshot('acme/demo', sha, files.slice(0, 1), mockGitHub())).rejects.toThrow('manifest');
  });

  it('rejects a tree object presented as a commit', async () => {
    const fetcher = mockGitHub();
    await expect(verifyPublicGitHubSnapshot('acme/demo', treeSha, files, fetcher)).rejects.toThrow('commit');
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining(`/git/trees/${treeSha}`), expect.anything());
  });

  it('fails closed on uninspected Git submodules',async()=>{
    await expect(verifyPublicGitHubSnapshot('acme/demo',sha,files,mockGitHub(false,true))).rejects.toThrow('submodule');
  });
});
