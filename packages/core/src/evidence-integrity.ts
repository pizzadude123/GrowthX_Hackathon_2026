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
  if (!excerpt.trim()) reasons.push('Evidence excerpt must be non-empty');
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
  if (finding.affectedFlowIds.length === 0) reasons.push('Active finding has no affected flow');
  if (finding.violatedInvariantIds.length === 0) reasons.push('Active finding has no violated invariant');
  for (const id of finding.affectedNodeIds) if (!nodeIds.has(id)) reasons.push(`Affected node does not exist: ${id}`);
  for (const id of finding.affectedFlowIds) if (!flowIds.has(id)) reasons.push(`Affected flow does not exist: ${id}`);
  for (const id of finding.violatedInvariantIds) if (!invariantIds.has(id)) reasons.push(`Violated invariant does not exist: ${id}`);
  const evidenceNodeIds = new Set<string>();
  for (const evidence of finding.evidence) {
    const matching = analysis.nodes.filter((node) => node.path === evidence.path
      && (node.startLine === undefined || node.endLine === undefined || (node.startLine <= evidence.endLine && node.endLine >= evidence.startLine)));
    if (!matching.length) reasons.push(`Evidence range has no overlapping source node: ${evidence.path}:${evidence.startLine}-${evidence.endLine}`);
    for (const node of matching) if (finding.affectedNodeIds.includes(node.id)) evidenceNodeIds.add(node.id);
    if (!matching.some((node) => finding.affectedNodeIds.includes(node.id))) reasons.push(`Evidence is not linked to an affected source node: ${evidence.path}:${evidence.startLine}-${evidence.endLine}`);
  }
  for (const nodeId of finding.affectedNodeIds) {
    if (!analysis.flows.some((flow) => finding.affectedFlowIds.includes(flow.id) && flow.orderedNodeIds.includes(nodeId))) reasons.push(`Affected node ${nodeId} is not contained in an affected flow`);
  }
  for (const invariantId of finding.violatedInvariantIds) {
    const applicable = analysis.flows.some((flow) => finding.affectedFlowIds.includes(flow.id)
      && flow.invariants.some((invariant) => invariant.id === invariantId && finding.affectedNodeIds.every((id) => invariant.scopeNodeIds.includes(id))))
      || analysis.principles.some((principle) => principle.id === invariantId
        && finding.affectedFlowIds.some((id) => principle.scopeFlowIds.includes(id))
        && finding.affectedNodeIds.every((id) => principle.scopeNodeIds.includes(id)));
    if (!applicable) reasons.push(`Violated invariant is not applicable to every affected node and flow: ${invariantId}`);
  }
  for (const flowId of finding.affectedFlowIds) {
    const flow = analysis.flows.find((item) => item.id === flowId);
    if (flow && !flow.orderedNodeIds.some((id) => evidenceNodeIds.has(id))) reasons.push(`Affected flow has no evidence-linked source node: ${flowId}`);
  }
  for (const invariantId of finding.violatedInvariantIds) {
    const scopedNodeIds = [
      ...analysis.flows.flatMap((flow) => flow.invariants.filter((item) => item.id === invariantId).flatMap((item) => item.scopeNodeIds)),
      ...analysis.principles.filter((item) => item.id === invariantId).flatMap((item) => item.scopeNodeIds),
    ];
    if (!scopedNodeIds.some((id) => evidenceNodeIds.has(id))) reasons.push(`Violated invariant has no evidence-linked source node: ${invariantId}`);
  }
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

  return {
    analysis: {
      ...analysis,
      findings,
      editorDiagnostics: analysis.editorDiagnostics.filter((diagnostic) => acceptedFindingIds.has(diagnostic.findingId)),
    },
    rejectedFindingIds,
    reasonsByFindingId,
  };
}
