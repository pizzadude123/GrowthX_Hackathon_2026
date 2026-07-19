import { z } from 'zod';
import { parseGitHubRepository } from '../../../packages/core/src/security.js';
import type { RepositoryFile } from '../../../packages/core/src/contracts.js';
import { MAX_AUDIT_BYTES } from '../../../packages/core/src/audit-limits.js';
import { classifyCompleteAuditTree } from '../../../packages/core/src/github-audit-tree.js';

const treeSchema = z.object({
  sha: z.string(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().optional(), sha: z.string().regex(/^[a-f0-9]{40}$/i), url: z.string().url().optional() })),
  truncated: z.boolean().optional(),
});
const metadataSchema = z.object({ default_branch: z.string().min(1), size: z.number(), private: z.boolean() });
const branchSchema = z.object({ commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/i) }) });
const commitSchema=z.object({sha:z.string().regex(/^[a-f0-9]{40}$/i),tree:z.object({sha:z.string().regex(/^[a-f0-9]{40}$/i)})});



class GitHubRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type TreeItem = z.infer<typeof treeSchema>['tree'][number];


export class GitHubClient {
  constructor(private readonly token?: string, private readonly fetcher: typeof fetch = fetch) {}

  private headers() {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  private async request(url: string, init: RequestInit = {}) {
    const response = await this.fetcher(url, {
      ...init,
      headers: { ...this.headers(), ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const message = response.status === 404
        ? 'Repository was not found or requires GitHub authentication'
        : response.status === 403 || response.status === 429
          ? 'GitHub rate limit or repository permission denied'
          : `GitHub request failed (${response.status})`;
      throw new GitHubRequestError(response.status, message);
    }
    return response;
  }

  private async readFile(repositoryKey: string, sourceSha: string, item: TreeItem): Promise<RepositoryFile | undefined> {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${repositoryKey}/${sourceSha}/${item.path.split('/').map(encodeURIComponent).join('/')}`;
      const content = await (await this.request(rawUrl)).text();
      if (content.includes('\0')) return undefined;
      return { path: item.path, content };
    } catch (error) {
      if (error instanceof GitHubRequestError && error.status === 404) return undefined;
      throw error;
    }
  }

  async inspect(url: string, expectedSourceCommitSha?:string) {
    const repo = parseGitHubRepository(url);
    const meta = metadataSchema.parse(await (await this.request(`https://api.github.com/repos/${repo.key}`)).json());
    if (meta.private) throw new Error('Whitebox audits public repositories only');
    if (meta.size > 250_000) throw new Error('Repository exceeds the 250 MB bounded-analysis safety limit');

    const branch = meta.default_branch;
    const sourceSha=expectedSourceCommitSha??branchSchema.parse(await (await this.request(`https://api.github.com/repos/${repo.key}/branches/${encodeURIComponent(branch)}`)).json()).commit.sha;
    if(!/^[a-f0-9]{40}$/i.test(sourceSha))throw new Error('Expected source commit is invalid');
    const commit=commitSchema.parse(await (await this.request(`https://api.github.com/repos/${repo.key}/git/commits/${sourceSha}`)).json());if(commit.sha.toLowerCase()!==sourceSha.toLowerCase())throw new Error('GitHub commit identity mismatch');
    const tree = treeSchema.parse(await (await this.request(`https://api.github.com/repos/${repo.key}/git/trees/${commit.tree.sha}?recursive=1`)).json());
    if (tree.truncated) throw new Error('Repository tree is truncated; Whitebox cannot claim complete verification');
    const coverage=classifyCompleteAuditTree(tree.tree);const selected = coverage.selected as TreeItem[];

    const files: RepositoryFile[] = [];
    let actualBytes = 0;
    for (let index = 0; index < selected.length; index += 8) {
      const batch = await Promise.all(selected.slice(index, index + 8).map((item) => this.readFile(repo.key, sourceSha, item)));
      for (const file of batch) {
        if (!file) continue;
        const bytes = Buffer.byteLength(file.content);
        if (actualBytes + bytes > MAX_AUDIT_BYTES) throw new Error('Repository source coverage exceeds the complete bounded audit');
        files.push(file);
        actualBytes += bytes;
      }
    }
    if (files.length !== selected.length) throw new Error('Repository source coverage is incomplete; one or more selected files could not be read within the audit bound');
    if (files.length === 0) throw new Error('Repository files could not be read; check GitHub access and rate limits');
    return { ...repo, defaultBranch: branch, sourceSha:sourceSha.toLowerCase(), files, snapshotFiles: selected.map((item) => ({ path: item.path, blobSha: item.sha, bytes: item.size ?? Buffer.byteLength(files.find((file) => file.path === item.path)!.content) })),coverageDispositions:coverage.dispositions, treeTruncated: Boolean(tree.truncated) };
  }

}
