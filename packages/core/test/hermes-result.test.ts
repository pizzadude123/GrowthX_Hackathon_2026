import { describe, expect, it } from 'vitest';
import { analyzeRepository } from '../src/analyzer.js';
import { demoteUnverifiedAnalysis, detectorFindingClaimDigest, mergeHermesVerifiedResult, parseHermesAuditorProposalText, parseHermesVerifiedResultText, reconcileHermesReview } from '../src/hermes-result.js';

const files = [
  { path: 'src/config.ts', content: "export const endpoint = process.env.SERVICE_URL;" },
  { path: 'src/other.ts', content: "export const endpoint = process.env.SERVICES_URL;" },
  { path: 'src/client.ts', content: ['export async function load(url: string) {', '  return fetch(url);', '}'].join('\n') },
  { path: 'package.json', content: JSON.stringify({ dependencies: { zod: '^3.24.1' } }) },
];
const commit = '0123456789abcdef0123456789abcdef01234567';

async function analysis() {
  const result = await analyzeRepository({ repositoryKey: 'acme/demo', files, goal: 'stabilize service', runId: 'WB-TEST' });
  result.snapshot.sourceCommitSha = commit;
  return result;
}

async function envelopes() {
  const baseline=await analysis(),detector=baseline.findings.find(finding=>finding.category==='configuration')!;
  const proposal={version:'whitebox-auditor-proposal-v1' as const,repository:'acme/demo',sourceCommitSha:commit,summary:'Repository Auditor selected one trusted detector.',candidates:[{candidateId:detector.id,detectorFindingId:detector.id,detectorClaimDigest:await detectorFindingClaimDigest(detector),repairability:'human_required' as const}]};
  const verification={version:'whitebox-verified-result-v1' as const,repository:'acme/demo',sourceCommitSha:commit,summary:'Independent review confirmed one detector.',findings:[{candidateId:detector.id,status:'confirmed' as const,confidence:.95}]};
  return{baseline,detector,proposal,verification};
}

async function reconciled() {
  const {proposal,verification}=await envelopes();
  const result = reconcileHermesReview(proposal, verification);
  expect(result.errors).toEqual([]);
  return result.result!;
}

describe('Hermes auditor/verifier result ingestion', () => {
  it('strictly parses both producer envelopes', async () => {
    const {proposal,verification}=await envelopes();
    expect(parseHermesAuditorProposalText(JSON.stringify(proposal)).result?.version).toBe('whitebox-auditor-proposal-v1');
    expect(parseHermesVerifiedResultText(`\`\`\`json\n${JSON.stringify(verification)}\n\`\`\``).result?.version).toBe('whitebox-verified-result-v1');
    expect(parseHermesVerifiedResultText('review finished without structured output').errors[0]).toContain('structured');
  });

  it('requires the verifier to disposition exactly the auditor candidate IDs', async () => {
    const {proposal,verification}=await envelopes();
    const omitted = { ...verification, findings: [] };
    const introduced = { ...verification, findings: [...verification.findings, { candidateId: 'candidate-new-self-approved', status: 'confirmed' as const, confidence: 1 }] };
    expect(reconcileHermesReview(proposal, omitted).errors[0]).toContain('omitted');
    expect(reconcileHermesReview(proposal, introduced).errors[0]).toContain('unproposed');
  });

  it('derives defensible source, flow, and invariant linkage for active findings', async () => {
    const merged = await mergeHermesVerifiedResult(await analysis(), files, await reconciled());
    const finding = merged.analysis.findings.find((item) => item.status === 'confirmed' && item.category === 'configuration');
    expect(merged.acceptedCount).toBe(1);
    expect(finding?.status).toBe('confirmed');
    expect(finding?.affectedNodeIds.length).toBeGreaterThan(0);
    expect(finding?.affectedFlowIds.length).toBeGreaterThan(0);
    expect(finding?.violatedInvariantIds.length).toBeGreaterThan(0);
    expect(merged.analysis.editorDiagnostics.some((item) => item.findingId === finding?.id)).toBe(true);
  });

  it('rejects a candidate whose detector digest is fabricated', async () => {
    const tampered = structuredClone(await reconciled());
    tampered.findings[0]!.detectorClaimDigest = 'f'.repeat(64);
    const merged = await mergeHermesVerifiedResult(await analysis(), files, tampered);
    expect(merged.acceptedCount).toBe(0);
    expect(merged.errors[0]).toContain('digest');
  });

  it('cannot alias overlapping detector semantics by swapping IDs and digests', async () => {
    const {baseline,detector}=await envelopes(),other={...structuredClone(detector),id:'finding-overlapping-configuration',title:'Different overlapping detector claim'};
    baseline.findings.push(other);
    const input=structuredClone(await reconciled());input.findings[0]!.detectorFindingId=other.id;
    const merged=await mergeHermesVerifiedResult(baseline,files,input);
    expect(merged.acceptedCount).toBe(0);
    expect(merged.errors[0]).toContain('digest');
  });

  it('rejects a result bound to a different repository commit', async () => {
    const wrong = { ...await reconciled(), sourceCommitSha: 'f'.repeat(40) };
    expect((await mergeHermesVerifiedResult(await analysis(), files, wrong)).errors[0]).toContain('commit');
  });

  it('demotes deterministic candidates when independent verification is unavailable', async () => {
    const baseline = await analysis();
    const partial = demoteUnverifiedAnalysis(baseline, 'Structured Hermes result was missing');
    expect(partial.findings.some((finding) => finding.status === 'confirmed')).toBe(false);
    expect(partial.findings.some((finding) => finding.status === 'needs_human_review')).toBe(true);
    expect(partial.editorDiagnostics).toEqual([]);

  });
});
