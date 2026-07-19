import { createHash } from 'node:crypto';
import { z } from 'zod';
import { findingSchema, sourceEvidenceSchema, type AnalysisResult, type EditorDiagnostic, type RepositoryFile, type WhiteboxFinding } from './contracts.js';
import { enforceAnalysisIntegrity } from './evidence-integrity.js';

const verifiedFindingSchema = z.object({
  title: z.string().min(1).max(180),
  category: z.enum(['state_flow','integration','dependency','data_consistency','validation','async_failure','configuration','authentication','reliability']),
  severity: z.enum(['low','medium','high','critical']),
  confidence: z.number().min(0).max(1),
  status: z.enum(['confirmed','probable','needs_human_review','rejected']),
  impact: z.string().min(1).max(1_000),
  logicChain: z.array(z.string().min(1)).max(20),
  evidence: z.array(sourceEvidenceSchema).max(12),
  businessImpact: z.string().min(1).max(1_000),
  recommendation: z.string().min(1).max(1_000),
  repairability: z.enum(['safe_automatic','guarded_automatic','human_required']),
  rejectionReason: z.string().optional(),
}).strict();

export const hermesVerifiedResultSchema = z.object({
  version: z.literal('whitebox-verified-result-v1'),
  repository: z.string().min(3),
  sourceCommitSha: z.string().regex(/^[a-f0-9]{40}$/i),
  summary: z.string().min(1).max(2_000),
  findings: z.array(verifiedFindingSchema).max(40),
}).strict();
export type HermesVerifiedResult = z.infer<typeof hermesVerifiedResultSchema>;

export function parseHermesVerifiedResultText(text: string): { result?: HermesVerifiedResult; errors: string[] } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? (text.trim().startsWith('{') ? text.trim() : undefined);
  if (!candidate) return { errors: ['Hermes output did not contain a structured result'] };
  try {
    const parsed = hermesVerifiedResultSchema.safeParse(JSON.parse(candidate));
    if (!parsed.success) return { errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'result'}: ${issue.message}`) };
    return { result: parsed.data, errors: [] };
  } catch (error) {
    return { errors: [`Hermes structured result is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

function stableId(value: string) {
  return `finding-hermes-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

function primaryKey(finding: HermesVerifiedResult['findings'][number]) {
  const evidence = finding.evidence[0];
  return `${finding.title.toLowerCase()}|${evidence?.path ?? ''}|${evidence?.startLine ?? 0}|${evidence?.endLine ?? 0}`;
}

function canonicalFinding(
  finding: HermesVerifiedResult['findings'][number],
  analysis: AnalysisResult,
): WhiteboxFinding {
  const affectedNodeIds = [...new Set(finding.evidence.flatMap((evidence) => analysis.nodes.filter((node) => node.path === evidence.path).map((node) => node.id)))];
  const evidence = finding.evidence;
  const first = evidence[0];
  return findingSchema.parse({
    ...finding,
    id: stableId(`${primaryKey(finding)}|${first?.excerpt ?? ''}`),
    evidence,
    affectedNodeIds,
    affectedFlowIds: [],
    violatedInvariantIds: [],
  });
}

function diagnosticFor(finding: WhiteboxFinding, analysis: AnalysisResult): EditorDiagnostic | undefined {
  const evidence = finding.evidence[0];
  const flow = analysis.flows.find((item) => finding.affectedFlowIds.includes(item.id));
  const principle = analysis.principles.find((item) => finding.violatedInvariantIds.includes(item.id));
  if (!evidence || !flow || !principle || finding.status === 'rejected' || finding.confidence < 0.8 || !['medium','high','critical'].includes(finding.severity)) return undefined;
  return {
    id: `diagnostic-${finding.id}`,
    runId: analysis.editorDiagnostics[0]?.runId ?? 'analysis',
    findingId: finding.id,
    path: evidence.path,
    startLine: evidence.startLine,
    endLine: evidence.endLine,
    severity: finding.severity === 'high' || finding.severity === 'critical' ? 'error' : 'warning',
    title: finding.title,
    flowLabel: flow.name,
    principleStatement: principle.statement,
    impact: finding.impact,
    repairStatus: 'proposed',
    dashboardUrl: analysis.editorDiagnostics[0]?.dashboardUrl ?? '/runs/analysis',
    ...(evidence.githubPermalink ? { githubPermalink: evidence.githubPermalink } : {}),
  };
}

export function demoteUnverifiedAnalysis(analysis: AnalysisResult, reason: string): AnalysisResult {
  return {
    ...analysis,
    findings: analysis.findings.map((finding) => ['confirmed','probable'].includes(finding.status)
      ? { ...finding, status: 'needs_human_review' as const, recommendation: `${finding.recommendation} Independent verification unavailable: ${reason}.` }
      : finding),
    editorDiagnostics: [],
    repairs: [],
    validations: [],
  };
}

export function mergeHermesVerifiedResult(
  analysis: AnalysisResult,
  files: RepositoryFile[],
  input: unknown,
): { analysis: AnalysisResult; acceptedCount: number; rejectedCount: number; errors: string[] } {
  const parsed = hermesVerifiedResultSchema.safeParse(input);
  if (!parsed.success) return { analysis, acceptedCount: 0, rejectedCount: 0, errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'result'}: ${issue.message}`) };
  if (parsed.data.repository.toLowerCase() !== analysis.snapshot.repositoryKey.toLowerCase()) {
    return { analysis, acceptedCount: 0, rejectedCount: 0, errors: [`Hermes result repository ${parsed.data.repository} does not match ${analysis.snapshot.repositoryKey}`] };
  }
  if (!analysis.snapshot.sourceCommitSha || parsed.data.sourceCommitSha.toLowerCase() !== analysis.snapshot.sourceCommitSha.toLowerCase()) {
    return { analysis, acceptedCount: 0, rejectedCount: 0, errors: [`Hermes result commit ${parsed.data.sourceCommitSha} does not match snapshot commit ${analysis.snapshot.sourceCommitSha ?? 'missing'}`] };
  }
  const unique = [...new Map(parsed.data.findings.map((finding) => [primaryKey(finding), finding])).values()];
  const canonical = unique.map((finding) => canonicalFinding(finding, analysis));
  const diagnostics = canonical.map((finding) => diagnosticFor(finding, analysis)).filter((item): item is EditorDiagnostic => Boolean(item));
  const baselineFindings = analysis.findings.map((finding) => ['confirmed','probable'].includes(finding.status)
    ? { ...finding, status: 'needs_human_review' as const, recommendation: `${finding.recommendation} Awaiting Hermes independent verification.` }
    : finding);
  const merged = enforceAnalysisIntegrity({
    ...analysis,
    findings: [...baselineFindings, ...canonical],
    editorDiagnostics: diagnostics,
  }, files);
  const externalIds = new Set(canonical.map((finding) => finding.id));
  const acceptedCount = merged.analysis.findings.filter((finding) => externalIds.has(finding.id) && finding.status !== 'rejected').length;
  const rejectedCount = merged.analysis.findings.filter((finding) => externalIds.has(finding.id) && finding.status === 'rejected').length;
  return { analysis: merged.analysis, acceptedCount, rejectedCount, errors: [] };
}
