import { describe, expect, it } from 'vitest';
import { analyzeRepository } from '../src/analyzer.js';
import { assertCanonicalAnalysis, assertCanonicalSourceMetadata, canonicalDigest, canonicalStringify, gitBlobSha, sha256Text } from '../src/canonical-integrity.js';

const files = [{ path: 'src/api.ts', content: 'export async function call() { return fetch(url); }' }];

describe('canonical completion integrity', () => {
  it('accepts a source-backed audit-only analysis and produces a stable digest', async () => {
    const analysis = await analyzeRepository({ repositoryKey: 'acme/demo', files, goal: 'reliability' });
    expect(() => assertCanonicalAnalysis(analysis, files)).not.toThrow();
    await expect(assertCanonicalSourceMetadata(analysis, files)).resolves.toBeUndefined();
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    await expect(canonicalDigest(analysis)).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(sha256Text('hello\n')).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(gitBlobSha('hello\n')).resolves.toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('rejects duplicate topology IDs and unresolved edges', async () => {
    const analysis = await analyzeRepository({ repositoryKey: 'acme/demo', files, goal: 'reliability' });
    analysis.nodes.push({ ...analysis.nodes[0]! });
    expect(() => assertCanonicalAnalysis(analysis, files)).toThrow('Duplicate node');
    analysis.nodes.pop();
    analysis.edges.push({ id: 'bad-edge', from: 'missing', to: analysis.nodes[0]!.id, kind: 'calls', evidence: [], confidence: 1 });
    expect(() => assertCanonicalAnalysis(analysis, files)).toThrow('edge endpoint');
  });

  it('rejects active findings with tampered evidence', async () => {
    const analysis = await analyzeRepository({ repositoryKey: 'acme/demo', files, goal: 'reliability' });
    const active = analysis.findings.find((finding) => finding.status !== 'rejected')!;
    active.evidence[0]!.excerpt = 'not in source';
    expect(() => assertCanonicalAnalysis(analysis, files)).toThrow('evidence');

  });

  it('permits quarantined rejected claims to retain the invalid evidence that caused rejection', async () => {
    const analysis = await analyzeRepository({ repositoryKey: 'acme/demo', files, goal: 'audit', runId: 'run-1' });
    const finding = analysis.findings[0]!;
    finding.status = 'rejected';
    finding.evidence[0]!.excerpt = 'unresolvable producer claim';
    analysis.editorDiagnostics = [];
    expect(() => assertCanonicalAnalysis(analysis, files)).not.toThrow();
  });

  it('rejects unknown canonical fields and source-derived metadata tampering', async () => {
    const analysis = await analyzeRepository({ repositoryKey: 'acme/demo', files, goal: 'audit' });
    (analysis as unknown as Record<string,unknown>).unexpectedProducerField = 'private';
    expect(() => assertCanonicalAnalysis(analysis, files)).toThrow('schema');
    delete (analysis as unknown as Record<string,unknown>).unexpectedProducerField;
    analysis.manifest.files[0]!.fingerprint = 'f'.repeat(64);
    await expect(assertCanonicalSourceMetadata(analysis, files)).rejects.toThrow('source bytes');
  });

  it('rejects obsolete repair and validation fields even when they are empty', async()=>{
    const analysis=await analyzeRepository({repositoryKey:'acme/demo',files,goal:'audit',sourceCommitSha:'a'.repeat(40),analyzedAt:1});
    expect(()=>assertCanonicalAnalysis({...analysis,repairs:[],validations:[]} as never,files)).toThrow('schema is invalid');
  });
});
