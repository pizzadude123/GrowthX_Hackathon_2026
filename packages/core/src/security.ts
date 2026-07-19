const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
export function parseGitHubRepository(input: string) {
  const trimmed = input.trim();
  const normalized = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(trimmed)
    ? `https://github.com/${trimmed}`
    : trimmed;
  let url: URL;
  try { url = new URL(normalized); } catch { throw new Error('A valid GitHub URL or owner/repository is required'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') throw new Error('Only https://github.com repositories are accepted');
  const [owner, rawName] = url.pathname.split('/').filter(Boolean);
  const name = rawName?.replace(/\.git$/, '');
  if (!owner || !name || !SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(name)) throw new Error('GitHub URL must include a valid owner and repository');
  const key = `${owner}/${name}`;
  return { owner, name, key, canonicalUrl: `https://github.com/${key}` };
}

export function sanitizeRelativePath(path: string) {
  const normalized = path.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../') || normalized.includes('\0')) throw new Error('Unsafe repository path');
  return normalized;
}
export function redactSecrets(value: string) {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/\b(?:ghp_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\b[a-f0-9]{48,}\b/gi, '[REDACTED]');
}
