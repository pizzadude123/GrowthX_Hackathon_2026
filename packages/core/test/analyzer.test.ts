import { describe, expect, it } from 'vitest';
import { buildManifest, analyzeRepository } from '../src/analyzer.js';

const files = [
  { path: 'src/config.ts', content: "export const paymentUrl = process.env.PAYMENT_URL;" },
  { path: 'src/checkout.ts', content: "import { paymentUrl } from './config';\nexport async function checkout() { return fetch(paymentUrl!); }" },
  { path: 'src/refund.py', content: "import os\nurl = os.environ['PAYMENTS_URL']\n" },
  { path: 'package.json', content: JSON.stringify({ dependencies: { axios: '^0.27.0' }, scripts: { test: 'vitest run', typecheck: 'tsc --noEmit' } }) }
];

describe('polyglot deterministic analysis', () => {
  it('detects languages, ecosystems, validation and fingerprints without execution', async () => {
    const manifest = await buildManifest(files);
    expect(manifest.languages.map((item) => item.language)).toEqual(expect.arrayContaining(['TypeScript', 'Python', 'JSON']));
    expect(manifest.ecosystems).toContain('npm');
    expect(manifest.validationCommands).toEqual(expect.arrayContaining(['npm run typecheck', 'npm test']));
    expect(manifest.files.every((file) => file.fingerprint.length === 64)).toBe(true);
  });

  it('builds evidence-backed flow, principle, finding, dependency blast radius and snapshot', async () => {
    const result = await analyzeRepository({ repositoryKey: 'acme/demo', files, goal: 'stabilize checkout' });
    const mismatch = result.findings.find((finding) => finding.category === 'configuration');
    expect(result.flows.length).toBeGreaterThan(0);
    expect(result.principles.length).toBeGreaterThan(0);
    expect(mismatch?.status).toBe('confirmed');
    expect(mismatch?.evidence.every((evidence) => evidence.startLine > 0 && evidence.excerpt.length > 0)).toBe(true);
    expect(result.dependencies[0]?.importingFiles).toContain('package.json');
    expect(result.snapshot.version).toBe(1);
  });

  it('ignores fetch-like prose and generated metadata as runtime HTTP calls', async () => {
    const metadataFiles = [
      { path: 'pnpm-lock.yaml', content: 'fetching-package: https://registry.example.test/archive.tgz' },
      { path: 'README.md', content: 'The service is fetching analyses from an API.' },
      { path: 'src/log.ts', content: 'console.error("Error fetching analyses", error);' },
    ];
    const result = await analyzeRepository({ repositoryKey: 'acme/metadata', files: metadataFiles, goal: 'reliability' });
    expect(result.findings.some((finding) => finding.title.includes('Outbound call'))).toBe(false);
    expect(result.nodes.some((node) => node.kind === 'external_api')).toBe(false);
  });

  it('rejects an unsupported timeout claim when a timeout is present', async () => {
    const safeFiles = [{ path: 'src/api.ts', content: "fetch(url, { signal: AbortSignal.timeout(5000) });" }];
    const result = await analyzeRepository({ repositoryKey: 'acme/safe', files: safeFiles, goal: 'reliability' });
    expect(result.findings.some((finding) => finding.status === 'rejected')).toBe(true);
    expect(result.editorDiagnostics).toHaveLength(0);
  });
});
