import { canonicalDigest, canonicalStringify } from '../../packages/core/src/canonical-integrity.js';
import { classifyCompleteAuditTree } from '../../packages/core/src/github-audit-tree.js';
import { parseGitHubRepository } from '../../packages/core/src/security.js';

export type SnapshotFile = { path: string; blobSha: string; bytes: number };

export async function resolvePublicGitHubHead(repositoryInput:string,fetcher:typeof fetch=fetch,token?:string){
  const repository=parseGitHubRepository(repositoryInput);const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:`Bearer ${token}`}:{})};
  const metadataResponse=await fetcher(`https://api.github.com/repos/${repository.key}`,{headers,signal:AbortSignal.timeout(20_000)});if(!metadataResponse.ok)throw new Error(`GitHub repository verification failed (${metadataResponse.status})`);
  const metadata=await metadataResponse.json() as {private?:unknown;default_branch?:unknown};if(metadata.private!==false||typeof metadata.default_branch!=='string'||!metadata.default_branch)throw new Error('Whitebox accepts public repositories with a default branch only');
  const branchResponse=await fetcher(`https://api.github.com/repos/${repository.key}/branches/${encodeURIComponent(metadata.default_branch)}`,{headers,signal:AbortSignal.timeout(20_000)});if(!branchResponse.ok)throw new Error(`GitHub default branch verification failed (${branchResponse.status})`);
  const branch=await branchResponse.json() as {commit?:{sha?:unknown}};if(typeof branch.commit?.sha!=='string'||!/^[a-f0-9]{40}$/i.test(branch.commit.sha))throw new Error('GitHub default branch commit is malformed');
  return{repository,defaultBranch:metadata.default_branch,sourceCommitSha:branch.commit.sha.toLowerCase()};
}

export async function verifyPublicGitHubSnapshot(repositoryKey: string, sourceCommitSha: string, submittedFiles: SnapshotFile[], fetcher: typeof fetch = fetch, token?: string) {
  const repository = parseGitHubRepository(repositoryKey);
  if (!/^[a-f0-9]{40}$/i.test(sourceCommitSha)) throw new Error('Snapshot requires an immutable commit SHA');
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const metadataResponse = await fetcher(`https://api.github.com/repos/${repository.key}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!metadataResponse.ok) throw new Error(`GitHub repository verification failed (${metadataResponse.status})`);
  const metadata = await metadataResponse.json() as { private?: unknown };
  if (metadata.private !== false) throw new Error('Whitebox verifies public repositories only');

  const commitResponse = await fetcher(`https://api.github.com/repos/${repository.key}/git/commits/${sourceCommitSha}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!commitResponse.ok) throw new Error(`GitHub commit verification failed (${commitResponse.status})`);
  const commitPayload = await commitResponse.json() as { sha?: unknown; tree?: { sha?: unknown } };
  if (typeof commitPayload.sha !== 'string' || commitPayload.sha.toLowerCase() !== sourceCommitSha.toLowerCase()
    || typeof commitPayload.tree?.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(commitPayload.tree.sha)) {
    throw new Error('GitHub commit object is malformed or does not match the submitted commit');
  }

  const treeResponse = await fetcher(`https://api.github.com/repos/${repository.key}/git/trees/${commitPayload.tree.sha}?recursive=1`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!treeResponse.ok) throw new Error(`GitHub commit verification failed (${treeResponse.status})`);
  const treePayload = await treeResponse.json() as { truncated?: unknown; tree?: unknown };
  if (treePayload.truncated !== false || !Array.isArray(treePayload.tree)) throw new Error('GitHub tree is truncated or malformed');
  const tree = treePayload.tree.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('GitHub tree entry is malformed');
    const item = entry as Record<string, unknown>;
    if (typeof item.path !== 'string' || typeof item.type !== 'string' || (item.size !== undefined && typeof item.size !== 'number') || typeof item.sha !== 'string' || !/^[a-f0-9]{40}$/i.test(item.sha)) throw new Error('GitHub tree entry is malformed');
    return { path: item.path, type: item.type, size: item.size as number | undefined, sha: item.sha.toLowerCase() };
  });
  const coverage = classifyCompleteAuditTree(tree);
  const selected = coverage.selected;
  const snapshotFiles = selected.map((item) => ({ path: item.path, blobSha: item.sha!, bytes: item.size! })).sort((left, right) => left.path.localeCompare(right.path));
  const submitted = submittedFiles.map((item) => ({ path: item.path, blobSha: item.blobSha.toLowerCase(), bytes: item.bytes })).sort((left, right) => left.path.localeCompare(right.path));
  if (canonicalStringify(snapshotFiles) !== canonicalStringify(submitted)) throw new Error('Worker snapshot manifest does not match the independently resolved GitHub tree');
  const coverageDigest=await canonicalDigest({repositoryKey:repository.key,sourceCommitSha:sourceCommitSha.toLowerCase(),totalBlobCount:coverage.totalBlobCount,dispositions:coverage.dispositions});
  return { snapshotFiles, snapshotDigest: await canonicalDigest({ repositoryKey: repository.key, sourceCommitSha: sourceCommitSha.toLowerCase(), files: snapshotFiles,coverageDigest }),coverageDigest,coverageDispositions:coverage.dispositions };
}
