import { z } from 'zod';
import { parseGitHubRepository } from '../../../packages/core/src/security.js';
import type { RepositoryFile } from '../../../packages/core/src/contracts.js';

const treeSchema = z.object({
  sha: z.string(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().optional(), url: z.string().url().optional() })),
  truncated: z.boolean().optional(),
});
const metadataSchema = z.object({ default_branch: z.string().min(1), size: z.number(), private: z.boolean() });
const branchSchema = z.object({ commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/i) }) });

const sourceExtensions = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte|astro|py|pyi|go|rs|java|kt|kts|scala|cs|fs|fsx|rb|php|swift|m|mm|c|cc|cpp|cxx|h|hpp|hxx|ex|exs|erl|hrl|hs|lhs|clj|cljs|cljc|groovy|dart|lua|r|jl|sol|move|sql|graphql|gql|proto|sh|bash|zsh|fish|ps1|tf|hcl|nix|json|jsonc|ya?ml|toml|ini|env\.example|md|mdx)$/i;
const namedSource = /(^|\/)(README(?:\.[^/]*)?|LICENSE(?:\.[^/]*)?|Dockerfile(?:\.[^/]*)?|Makefile|Procfile|Gemfile|Rakefile|Podfile|Vagrantfile|CMakeLists\.txt)$/i;
const manifests = /(^|\/)(package\.json|pyproject\.toml|requirements[^/]*\.txt|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|mix\.exs|pubspec\.yaml|Dockerfile|wrangler\.toml|vite\.config\.[^/]+|next\.config\.[^/]+)$/i;
const excluded = /(^|\/)(node_modules|vendor|dist|build|coverage|\.git|\.next|\.nuxt|target|Pods|DerivedData|venv|\.venv|__pycache__|fixtures\/generated)(\/|$)|\.(?:min\.|map$)|(?:^|\/)(?:package-lock|yarn\.lock|pnpm-lock|bun\.lockb|Cargo\.lock)$/i;

class GitHubRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type TreeItem = z.infer<typeof treeSchema>['tree'][number];

function priority(path: string) {
  if (manifests.test(path)) return 0;
  if (/(^|\/)(src|app|lib|server|api|cmd|internal|packages)(\/|$)/i.test(path)) return 10;
  if (/(^|\/)(config|infra|migrations|db|scripts)(\/|$)/i.test(path)) return 20;
  if (/(^|\/)(test|tests|spec|__tests__)(\/|$)/i.test(path)) return 30;
  if (/\.(?:md|mdx)$/i.test(path)) return 50;
  return 40;
}

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

  async inspect(url: string) {
    const repo = parseGitHubRepository(url);
    const meta = metadataSchema.parse(await (await this.request(`https://api.github.com/repos/${repo.key}`)).json());
    if (meta.private) throw new Error('Whitebox audits public repositories only');
    if (meta.size > 250_000) throw new Error('Repository exceeds the 250 MB bounded-analysis safety limit');

    const branch = meta.default_branch;
    const branchData = branchSchema.parse(await (await this.request(`https://api.github.com/repos/${repo.key}/branches/${encodeURIComponent(branch)}`)).json());
    const sourceSha = branchData.commit.sha;
    const tree = treeSchema.parse(await (await this.request(`https://api.github.com/repos/${repo.key}/git/trees/${sourceSha}?recursive=1`)).json());
    if (tree.truncated) throw new Error('Repository tree is truncated; Whitebox cannot claim complete verification');
    const supported = tree.tree
      .filter((item) => item.type === 'blob' && !excluded.test(item.path) && (sourceExtensions.test(item.path) || namedSource.test(item.path)) && (item.size ?? 0) < 200_000)
      .sort((left, right) => priority(left.path) - priority(right.path) || left.path.localeCompare(right.path));

    const selected: TreeItem[] = [];
    let predictedBytes = 0;
    for (const item of supported) {
      const size = item.size ?? 50_000;
      if (selected.length >= 80 || predictedBytes + size > 900_000) continue;
      selected.push(item);
      predictedBytes += size;
    }
    if (selected.length !== supported.length) throw new Error('Repository exceeds the supported file limit for a complete bounded audit');
    if (selected.length === 0) throw new Error('Repository has no supported readable source or configuration files');

    const files: RepositoryFile[] = [];
    let actualBytes = 0;
    for (let index = 0; index < selected.length; index += 8) {
      const batch = await Promise.all(selected.slice(index, index + 8).map((item) => this.readFile(repo.key, sourceSha, item)));
      for (const file of batch) {
        if (!file) continue;
        const bytes = Buffer.byteLength(file.content);
        if (actualBytes + bytes > 900_000) continue;
        files.push(file);
        actualBytes += bytes;
      }
    }
    if (files.length !== selected.length) throw new Error('Repository source coverage is incomplete; one or more selected files could not be read within the audit bound');
    if (files.length === 0) throw new Error('Repository files could not be read; check GitHub access and rate limits');
    return { ...repo, defaultBranch: branch, sourceSha, files, treeTruncated: Boolean(tree.truncated) };
  }

  async openPullRequest(input: { repositoryKey: string; head: string; base: string; title: string; body: string }) {
    if (!this.token) throw new Error('GITHUB_TOKEN is required to publish');
    const response = await this.request(`https://api.github.com/repos/${input.repositoryKey}/pulls`, { method: 'POST', body: JSON.stringify({ title: input.title, head: input.head, base: input.base, body: input.body }) });
    const data = z.object({ html_url: z.string().url(), number: z.number() }).parse(await response.json());
    return { url: data.html_url, number: data.number };
  }
}
