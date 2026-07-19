
import { z } from 'zod';
import { findingSchema, type AnalysisResult, type EditorDiagnostic, type RepositoryFile, type WhiteboxFinding } from './contracts.js';
import { enforceAnalysisIntegrity,validateSourceEvidence } from './evidence-integrity.js';
import { canonicalDigest } from './canonical-integrity.js';

const candidateIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/);
const candidateFindingSchema = z.object({
  candidateId: candidateIdSchema,
  detectorFindingId: candidateIdSchema,
  detectorClaimDigest: z.string().regex(/^[a-f0-9]{64}$/i),
  repairability: z.literal('human_required'),
}).strict();

function requireUniqueCandidateIds(values: Array<{ candidateId?: string }>, context: z.RefinementCtx) {
  const ids = values.map((value) => value.candidateId);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Candidate IDs must be unique' });
}

export const hermesAuditorProposalSchema = z.object({
  version: z.literal('whitebox-auditor-proposal-v1'),
  repository: z.string().min(3),
  sourceCommitSha: z.string().regex(/^[a-f0-9]{40}$/i),
  summary: z.string().min(1).max(2_000),
  candidates: z.array(candidateFindingSchema).max(40),
}).strict().superRefine((value, context) => requireUniqueCandidateIds(value.candidates, context));
export type HermesAuditorProposal = z.infer<typeof hermesAuditorProposalSchema>;

const dispositionSchema = z.object({
  candidateId: candidateIdSchema,
  status: z.enum(['confirmed','needs_human_review','rejected']),
  confidence: z.number().min(0).max(1),
  rejectionReason: z.string().min(1).max(1_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === 'rejected' && !value.rejectionReason) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Rejected candidates require a rejection reason', path: ['rejectionReason'] });
});

export const hermesVerifiedResultSchema = z.object({
  version: z.literal('whitebox-verified-result-v1'),
  repository: z.string().min(3),
  sourceCommitSha: z.string().regex(/^[a-f0-9]{40}$/i),
  summary: z.string().min(1).max(2_000),
  findings: z.array(dispositionSchema).max(40),
}).strict().superRefine((value, context) => requireUniqueCandidateIds(value.findings, context));
export type HermesVerifiedResult = z.infer<typeof hermesVerifiedResultSchema>;

const reconciledFindingSchema = candidateFindingSchema.extend({
  confidence: z.number().min(0).max(1),
  status: z.enum(['confirmed','needs_human_review','rejected']),
  rejectionReason: z.string().optional(),
}).strict();
const reconciledResultSchema = z.object({
  version: z.literal('whitebox-verified-result-v1'), repository: z.string(), sourceCommitSha: z.string(), summary: z.string(),
  findings: z.array(reconciledFindingSchema),
}).strict();
export type ReconciledHermesResult = z.infer<typeof reconciledResultSchema>;

function parseStructuredText<T>(text: string, schema: z.ZodType<T>, label: string): { result?: T; errors: string[] } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? (text.trim().startsWith('{') ? text.trim() : undefined);
  if (!candidate) return { errors: [`Hermes output did not contain a structured ${label}`] };
  try {
    const parsed = schema.safeParse(JSON.parse(candidate));
    if (!parsed.success) return { errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || label}: ${issue.message}`) };
    return { result: parsed.data, errors: [] };
  } catch {
    return { errors: [`Hermes structured ${label} is not valid JSON`] };
  }
}

export function parseHermesAuditorProposalText(text: string) {
  return parseStructuredText(text, hermesAuditorProposalSchema, 'auditor proposal');
}

export function parseHermesVerifiedResultText(text: string) {
  return parseStructuredText(text, hermesVerifiedResultSchema, 'verified result');
}

export function reconcileHermesReview(proposalInput: unknown, verificationInput: unknown): { result?: ReconciledHermesResult; errors: string[] } {
  const proposal = hermesAuditorProposalSchema.safeParse(proposalInput);
  const verification = hermesVerifiedResultSchema.safeParse(verificationInput);
  const errors = [
    ...(proposal.success ? [] : proposal.error.issues.map((issue) => `proposal.${issue.path.join('.') || 'result'}: ${issue.message}`)),
    ...(verification.success ? [] : verification.error.issues.map((issue) => `verification.${issue.path.join('.') || 'result'}: ${issue.message}`)),
  ];
  if (!proposal.success || !verification.success) return { errors };
  if (proposal.data.repository.toLowerCase() !== verification.data.repository.toLowerCase()) errors.push('Verifier repository does not match auditor proposal');
  if (proposal.data.sourceCommitSha.toLowerCase() !== verification.data.sourceCommitSha.toLowerCase()) errors.push('Verifier commit does not match auditor proposal');
  const candidates = new Map(proposal.data.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const dispositions = new Map(verification.data.findings.map((finding) => [finding.candidateId, finding]));
  for (const id of candidates.keys()) if (!dispositions.has(id)) errors.push(`Verifier omitted auditor candidate ${id}`);
  for (const id of dispositions.keys()) if (!candidates.has(id)) errors.push(`Verifier introduced unproposed candidate ${id}`);
  if (errors.length) return { errors };
  return {
    errors: [],
    result: reconciledResultSchema.parse({
      version: 'whitebox-verified-result-v1',
      repository: proposal.data.repository,
      sourceCommitSha: proposal.data.sourceCommitSha,
      summary: verification.data.summary,
      findings: proposal.data.candidates.map((candidate) => ({ ...candidate, ...dispositions.get(candidate.candidateId)! })),
    }),
  };
}

function stableId(value: string) {
  let first=0x811c9dc5,second=0x9e3779b9;for(let index=0;index<value.length;index+=1){const code=value.charCodeAt(index);first=Math.imul(first^code,0x01000193);second=Math.imul(second^code,0x85ebca6b);}return `finding-hermes-${(first>>>0).toString(16).padStart(8,'0')}${(second>>>0).toString(16).padStart(8,'0').slice(0,4)}`;
}

export function detectorFindingClaim(finding:WhiteboxFinding){return{
  detectorFindingId:finding.id,title:finding.title,category:finding.category,severity:finding.severity,impact:finding.impact,logicChain:finding.logicChain,evidence:finding.evidence,
  affectedNodeIds:finding.affectedNodeIds,affectedFlowIds:finding.affectedFlowIds,violatedInvariantIds:finding.violatedInvariantIds,businessImpact:finding.businessImpact,recommendation:finding.recommendation,repairability:'human_required' as const,
};}
export async function detectorFindingClaimDigest(finding:WhiteboxFinding){return canonicalDigest(detectorFindingClaim(finding));}

async function canonicalFinding(finding: ReconciledHermesResult['findings'][number], analysis: AnalysisResult,files:RepositoryFile[]):Promise<{finding?:WhiteboxFinding;error?:string}>{
  const trusted=analysis.findings.find(candidate=>candidate.id===finding.detectorFindingId);
  if(!trusted)return{error:`Unknown detector finding ${finding.detectorFindingId}`};
  if(!trusted.evidence.every(evidence=>validateSourceEvidence(evidence,files).valid))return{error:`Trusted detector evidence is invalid for ${finding.detectorFindingId}`};
  if(await detectorFindingClaimDigest(trusted)!==finding.detectorClaimDigest)return{error:`Detector claim digest mismatch for ${finding.detectorFindingId}`};
  return{finding:findingSchema.parse({
    ...trusted,id:stableId(finding.detectorFindingId),status:finding.status,confidence:Math.min(trusted.confidence,finding.confidence),repairability:'human_required',
    ...(finding.status==='rejected'?{rejectionReason:finding.rejectionReason??'Verification rejected the trusted candidate.'}:{rejectionReason:undefined}),
  })};
}

function diagnosticFor(finding: WhiteboxFinding, analysis: AnalysisResult): EditorDiagnostic | undefined {
  const evidence = finding.evidence[0];
  const flow = analysis.flows.find((item) => finding.affectedFlowIds.includes(item.id));
  const principle = analysis.principles.find((item) => finding.violatedInvariantIds.includes(item.id));
  if (!evidence || !flow || !principle || finding.status === 'rejected' || finding.confidence < 0.8 || !['medium','high','critical'].includes(finding.severity)) return undefined;
  return {
    id: `diagnostic-${finding.id}`, runId: analysis.editorDiagnostics[0]?.runId ?? 'analysis', findingId: finding.id,
    path: evidence.path, startLine: evidence.startLine, endLine: evidence.endLine,
    severity: finding.severity === 'high' || finding.severity === 'critical' ? 'error' : 'warning', title: finding.title,
    flowLabel: flow.name, principleStatement: principle.statement, impact: finding.impact,
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
  };
}

export async function mergeHermesVerifiedResult(analysis: AnalysisResult, files: RepositoryFile[], input: unknown) {
  const parsed = reconciledResultSchema.safeParse(input);
  if (!parsed.success) return { analysis, acceptedCount: 0, rejectedCount: 0, errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || 'result'}: ${issue.message}`) };
  if (parsed.data.repository.toLowerCase() !== analysis.snapshot.repositoryKey.toLowerCase()) return { analysis, acceptedCount: 0, rejectedCount: 0, errors: ['Hermes result repository does not match snapshot repository'] };
  if (!analysis.snapshot.sourceCommitSha || parsed.data.sourceCommitSha.toLowerCase() !== analysis.snapshot.sourceCommitSha.toLowerCase()) return { analysis, acceptedCount: 0, rejectedCount: 0, errors: ['Hermes result commit does not match snapshot commit'] };
  const resolved=await Promise.all(parsed.data.findings.map(finding=>canonicalFinding(finding,analysis,files))),resolutionErrors=resolved.flatMap(item=>item.error?[item.error]:[]);
  if(resolutionErrors.length)return{analysis,acceptedCount:0,rejectedCount:0,errors:resolutionErrors};
  const canonical=resolved.flatMap(item=>item.finding?[item.finding]:[]);
  const diagnostics = canonical.map((finding) => diagnosticFor(finding, analysis)).filter((item): item is EditorDiagnostic => Boolean(item));
  const baselineFindings = analysis.findings.map((finding) => ['confirmed','probable'].includes(finding.status)
    ? { ...finding, status: 'needs_human_review' as const, recommendation: `${finding.recommendation} Awaiting Hermes independent verification.` }
    : finding);
  const merged = enforceAnalysisIntegrity({ ...analysis, findings: [...baselineFindings, ...canonical], editorDiagnostics: diagnostics }, files);
  const externalIds = new Set(canonical.map((finding) => finding.id));
  return {
    analysis: merged.analysis,
    acceptedCount: merged.analysis.findings.filter((finding) => externalIds.has(finding.id) && finding.status !== 'rejected').length,
    rejectedCount: merged.analysis.findings.filter((finding) => externalIds.has(finding.id) && finding.status === 'rejected').length,
    errors: [],
  };
}
