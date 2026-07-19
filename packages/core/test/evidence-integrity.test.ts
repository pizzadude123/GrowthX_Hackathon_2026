import { describe, expect, it } from 'vitest';
import { analyzeRepository } from '../src/analyzer.js';
import { enforceAnalysisIntegrity, validateSourceEvidence } from '../src/evidence-integrity.js';

const files = [
  { path: 'src/checkout.ts', content: [
    "export async function checkout(url: string) {",
    "  return fetch(url);",
    "}",
  ].join('\n') },
  { path: 'package.json', content: JSON.stringify({ scripts: { test: 'vitest run' } }) },
];

async function fixture() {
  return analyzeRepository({ repositoryKey: 'acme/shop', files, goal: 'stabilize checkout', runId: 'WB-TEST' });
}

describe('repository evidence integrity', () => {
  it('accepts a verbatim excerpt inside a valid repository range', () => {
    expect(validateSourceEvidence({
      path: 'src/checkout.ts', startLine: 2, endLine: 2,
      excerpt: '  return fetch(url);', explanation: 'Outbound request',
    }, files)).toEqual({ valid: true, reasons: [] });
  });

  it.each([
    ['missing path', { path: 'src/missing.ts', startLine: 1, endLine: 1, excerpt: 'x', explanation: 'x' }],
    ['out-of-range line', { path: 'src/checkout.ts', startLine: 99, endLine: 99, excerpt: 'x', explanation: 'x' }],
    ['excerpt mismatch', { path: 'src/checkout.ts', startLine: 2, endLine: 2, excerpt: 'invented code', explanation: 'x' }],
  ])('rejects %s evidence', (_name, evidence) => {
    const result = validateSourceEvidence(evidence, files);
    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('keeps a confirmed finding only when evidence and graph references resolve', async () => {
    const analysis = await fixture();
    const result = enforceAnalysisIntegrity(analysis, files);
    expect(result.rejectedFindingIds).toEqual([]);
    expect(result.analysis.findings.some((finding) => finding.status === 'confirmed')).toBe(true);
    expect(result.analysis.editorDiagnostics.length).toBeGreaterThan(0);
  });

  it('rejects tampered confirmed findings and removes their active diagnostics and repairs', async () => {
    const analysis = await fixture();
    const real = analysis.findings.find((finding) => finding.status === 'confirmed');
    expect(real).toBeDefined();
    if (!real) return;
    const tampered = {
      ...real,
      id: 'finding-tampered',
      evidence: [{ path: 'does/not/exist.ts', startLine: 999, endLine: 999, excerpt: 'invented', explanation: 'tampered' }],
      affectedNodeIds: ['missing-node'],
      affectedFlowIds: ['missing-flow'],
      violatedInvariantIds: ['missing-invariant'],
    };
    const input = {
      ...analysis,
      findings: [...analysis.findings, tampered],
      editorDiagnostics: [...analysis.editorDiagnostics, {
        id: 'diagnostic-tampered', runId: 'WB-TEST', findingId: tampered.id,
        path: 'does/not/exist.ts', startLine: 999, endLine: 999, severity: 'error' as const,
        title: tampered.title, flowLabel: 'missing', principleStatement: 'missing', impact: tampered.impact,
        repairStatus: 'proposed' as const, dashboardUrl: '/runs/WB-TEST',
      }],
      repairs: [{
        id: 'repair-tampered', findingId: tampered.id, title: 'Unsafe repair', status: 'proposed' as const,
        intendedInvariant: 'missing', affectedFlowIds: ['missing-flow'], predictedBlastRadius: 'unknown',
        changedFiles: ['does/not/exist.ts'], changedLineCount: 1, patch: 'invented', validationPlan: ['invariant'], rollbackCondition: 'failure',
      }],
    };
    const result = enforceAnalysisIntegrity(input, files);
    const rejected = result.analysis.findings.find((finding) => finding.id === tampered.id);
    expect(result.rejectedFindingIds).toContain(tampered.id);
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejectionReason).toContain('Evidence integrity failed');
    expect(result.analysis.editorDiagnostics.some((item) => item.findingId === tampered.id)).toBe(false);
    expect(result.analysis.repairs.some((item) => item.findingId === tampered.id)).toBe(false);
  });

  it('keeps source-backed findings when no repository flow or invariant applies', async () => {
    const analysis = await fixture();
    const real = analysis.findings.find((finding) => finding.status === 'confirmed');
    expect(real).toBeDefined();
    if (!real) return;
    const sourceBacked = { ...real, id: 'finding-source-backed', affectedFlowIds: [], violatedInvariantIds: [] };
    const result = enforceAnalysisIntegrity({ ...analysis, findings: [...analysis.findings, sourceBacked] }, files);
    expect(result.rejectedFindingIds).not.toContain(sourceBacked.id);
    expect(result.analysis.findings.find((finding) => finding.id === sourceBacked.id)?.status).toBe('confirmed');
  });

  it('rejects confirmed findings that omit graph-node linkage', async () => {
    const analysis = await fixture();
    const real = analysis.findings.find((finding) => finding.status === 'confirmed');
    expect(real).toBeDefined();
    if (!real) return;
    const unlinked = { ...real, id: 'finding-unlinked', affectedNodeIds: [], affectedFlowIds: [], violatedInvariantIds: [] };
    const result = enforceAnalysisIntegrity({ ...analysis, findings: [...analysis.findings, unlinked] }, files);
    expect(result.rejectedFindingIds).toContain(unlinked.id);
  });
});
