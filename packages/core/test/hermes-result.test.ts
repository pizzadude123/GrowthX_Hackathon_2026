import { describe, expect, it } from 'vitest';
import { analyzeRepository } from '../src/analyzer.js';
import { demoteUnverifiedAnalysis, mergeHermesVerifiedResult, parseHermesVerifiedResultText } from '../src/hermes-result.js';

const files = [
  { path: 'src/config.ts', content: "export const endpoint = process.env.SERVICE_URL;" },
  { path: 'src/client.ts', content: [
    'export async function load(url: string) {',
    '  return fetch(url);',
    '}',
  ].join('\n') },
  { path: 'package.json', content: JSON.stringify({ dependencies: { zod: '^3.24.1' } }) },
];

async function analysis() {
  const result = await analyzeRepository({ repositoryKey: 'acme/demo', files, goal: 'stabilize service', runId: 'WB-TEST' });
  result.snapshot.sourceCommitSha = '0123456789abcdef0123456789abcdef01234567';
  return result;
}

const verifiedResult = {
  version: 'whitebox-verified-result-v1',
  repository: 'acme/demo',
  sourceCommitSha: '0123456789abcdef0123456789abcdef01234567',
  summary: 'Independent review confirmed one boundary risk.',
  findings: [{
    title: 'Service endpoint can be absent at runtime',
    category: 'configuration', severity: 'high', confidence: 0.95, status: 'confirmed',
    impact: 'Requests can fail before reaching the dependency.',
    logicChain: ['runtime configuration', 'service client'],
    evidence: [{
      path: 'src/config.ts', startLine: 1, endLine: 1,
      excerpt: "export const endpoint = process.env.SERVICE_URL;",
      explanation: 'The endpoint is read directly from runtime configuration.',
    }],
    businessImpact: 'The primary service flow can be unavailable.',
    recommendation: 'Validate SERVICE_URL before accepting traffic.',
    repairability: 'guarded_automatic',
  }],
};

describe('Hermes verified result ingestion', () => {
  it('parses a fenced structured result without accepting surrounding prose', () => {
    const parsed = parseHermesVerifiedResultText(`Completed review.\n\n\`\`\`json\n${JSON.stringify(verifiedResult)}\n\`\`\``);
    expect(parsed.result?.version).toBe('whitebox-verified-result-v1');
    expect(parsed.errors).toEqual([]);
  });

  it('returns an honest parse error instead of throwing for malformed output', () => {
    const parsed = parseHermesVerifiedResultText('review finished without structured output');
    expect(parsed.result).toBeUndefined();
    expect(parsed.errors[0]).toContain('structured result');
  });

  it('maps verified evidence to source nodes without manufacturing flow or invariant applicability', async () => {
    const merged = mergeHermesVerifiedResult(await analysis(), files, verifiedResult);
    const finding = merged.analysis.findings.find((item) => item.title === verifiedResult.findings[0]?.title);
    expect(merged.acceptedCount).toBe(1);
    expect(merged.analysis.findings.filter((item) => item.status === 'confirmed')).toHaveLength(1);
    expect(finding?.status).toBe('confirmed');
    expect(finding?.affectedNodeIds.length).toBeGreaterThan(0);
    expect(finding?.affectedFlowIds).toEqual([]);
    expect(finding?.violatedInvariantIds).toEqual([]);
    expect(merged.analysis.editorDiagnostics.some((item) => item.findingId === finding?.id)).toBe(false);
  });

  it('rejects a structured finding when its source excerpt is fabricated', async () => {
    const tampered = structuredClone(verifiedResult);
    tampered.findings[0]!.evidence[0]!.excerpt = 'invented source text';
    const merged = mergeHermesVerifiedResult(await analysis(), files, tampered);
    const finding = merged.analysis.findings.find((item) => item.title === verifiedResult.findings[0]?.title);
    expect(merged.acceptedCount).toBe(0);
    expect(merged.rejectedCount).toBe(1);
    expect(finding?.status).toBe('rejected');
    expect(finding?.rejectionReason).toContain('Evidence integrity failed');
  });

  it('rejects a result bound to a different repository commit', async () => {
    const wrongCommit = { ...verifiedResult, sourceCommitSha: 'ffffffffffffffffffffffffffffffffffffffff' };
    const merged = mergeHermesVerifiedResult(await analysis(), files, wrongCommit);
    expect(merged.acceptedCount).toBe(0);
    expect(merged.errors[0]).toContain('commit');
  });

  it('demotes deterministic candidates when independent verification is unavailable', async () => {
    const baseline = await analysis();
    expect(baseline.findings.some((finding) => finding.status === 'confirmed')).toBe(true);
    const partial = demoteUnverifiedAnalysis(baseline, 'Structured Hermes result was missing');
    expect(partial.findings.some((finding) => finding.status === 'confirmed')).toBe(false);
    expect(partial.findings.some((finding) => finding.status === 'needs_human_review')).toBe(true);
    expect(partial.editorDiagnostics).toEqual([]);
    expect(partial.repairs).toEqual([]);
  });

  it('deduplicates a repeated Hermes finding by title and primary evidence range', async () => {
    const repeated = { ...verifiedResult, findings: [verifiedResult.findings[0]!, verifiedResult.findings[0]!] };
    const merged = mergeHermesVerifiedResult(await analysis(), files, repeated);
    expect(merged.analysis.findings.filter((item) => item.title === verifiedResult.findings[0]?.title)).toHaveLength(1);
  });
});
