import type { AnalysisResult, RepositoryFile, SourceEvidence, WhiteboxFinding } from './contracts.js';

type IntegrityCheck = { valid: boolean; reasons: string[] };
export type AnalysisIntegrityResult = {
  analysis: AnalysisResult;
  rejectedFindingIds: string[];
  reasonsByFindingId: Record<string, string[]>;
};

function repositoryLines(files: RepositoryFile[]) {
  return new Map(files.map((file) => [file.path, file.content.replace(/\r\n/g, '\n').split('\n')]));
}

export function validateSourceEvidence(evidence: SourceEvidence, files: RepositoryFile[]): IntegrityCheck {
  const reasons: string[] = [];
  const lines = repositoryLines(files).get(evidence.path);
  if (!lines) return { valid: false, reasons: [`Repository path does not exist: ${evidence.path}`] };
  if (evidence.startLine < 1 || evidence.endLine < evidence.startLine || evidence.endLine > lines.length) {
    reasons.push(`Evidence range ${evidence.startLine}-${evidence.endLine} is outside ${evidence.path} (1-${lines.length})`);
    return { valid: false, reasons };
  }
  const range = lines.slice(evidence.startLine - 1, evidence.endLine).join('\n');
  const excerpt = evidence.excerpt.replace(/\r\n/g, '\n');
  if (!range.includes(excerpt)) reasons.push(`Evidence excerpt does not match ${evidence.path}:${evidence.startLine}-${evidence.endLine}`);
  return { valid: reasons.length === 0, reasons };
}

function findingIntegrity(
  finding: WhiteboxFinding,
  analysis: AnalysisResult,
  files: RepositoryFile[],
): IntegrityCheck {
  if (finding.status === 'rejected') return { valid: true, reasons: [] };
  const reasons = finding.evidence.flatMap((evidence) => validateSourceEvidence(evidence, files).reasons);
  const nodeIds = new Set(analysis.nodes.map((node) => node.id));
  const flowIds = new Set(analysis.flows.map((flow) => flow.id));
  const invariantIds = new Set([
    ...analysis.principles.map((principle) => principle.id),
    ...analysis.flows.flatMap((flow) => flow.invariants.map((invariant) => invariant.id)),
  ]);
  if (finding.evidence.length === 0) reasons.push('Active finding has no repository evidence');
  if (finding.affectedNodeIds.length === 0) reasons.push('Active finding has no affected node');
  for (const id of finding.affectedNodeIds) if (!nodeIds.has(id)) reasons.push(`Affected node does not exist: ${id}`);
  for (const id of finding.affectedFlowIds) if (!flowIds.has(id)) reasons.push(`Affected flow does not exist: ${id}`);
  for (const id of finding.violatedInvariantIds) if (!invariantIds.has(id)) reasons.push(`Violated invariant does not exist: ${id}`);
  return { valid: reasons.length === 0, reasons };
}

export function enforceAnalysisIntegrity(analysis: AnalysisResult, files: RepositoryFile[]): AnalysisIntegrityResult {
  const rejectedFindingIds: string[] = [];
  const reasonsByFindingId: Record<string, string[]> = {};
  const findings = analysis.findings.map((finding) => {
    const check = findingIntegrity(finding, analysis, files);
    if (check.valid) return finding;
    rejectedFindingIds.push(finding.id);
    reasonsByFindingId[finding.id] = check.reasons;
    return {
      ...finding,
      status: 'rejected' as const,
      confidence: 0,
      repairability: 'human_required' as const,
      rejectionReason: `Evidence integrity failed: ${check.reasons.join('; ')}`,
    };
  });
  const acceptedFindingIds = new Set(findings.filter((finding) => finding.status !== 'rejected').map((finding) => finding.id));
  const repairs = analysis.repairs.filter((repair) => acceptedFindingIds.has(repair.findingId));
  const repairIds = new Set(repairs.map((repair) => repair.id));
  return {
    analysis: {
      ...analysis,
      findings,
      repairs,
      validations: analysis.validations.filter((validation) => repairIds.has(validation.repairId)),
      editorDiagnostics: analysis.editorDiagnostics.filter((diagnostic) => acceptedFindingIds.has(diagnostic.findingId)),
    },
    rejectedFindingIds,
    reasonsByFindingId,
  };
}
