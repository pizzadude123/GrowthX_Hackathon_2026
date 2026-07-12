import { z } from 'zod';

export const runStatusSchema = z.enum(['accepted','mapping','auditing','repairing','validating','publishing','completed','partial','audit_only','blocked','failed','cancelled']);
export const runModeSchema = z.enum(['audit_only','guarded_repair']);
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunMode = z.infer<typeof runModeSchema>;

export const sourceEvidenceSchema = z.object({
  path: z.string().min(1), startLine: z.number().int().positive(), endLine: z.number().int().positive(),
  excerpt: z.string().min(1), explanation: z.string().min(1), githubPermalink: z.string().url().optional()
}).refine((value) => value.endLine >= value.startLine, 'Invalid evidence range');
export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;

export const logisticsNodeSchema = z.object({
  id: z.string(), kind: z.enum(['entry_point','route','module','service','function','job','queue','data_store','domain_entity','external_api','configuration','environment_variable','dependency']),
  name: z.string(), path: z.string().optional(), startLine: z.number().optional(), endLine: z.number().optional(), summary: z.string(), confidence: z.number().min(0).max(1)
});
export type LogisticsNode = z.infer<typeof logisticsNodeSchema>;

export const logisticsEdgeSchema = z.object({
  id: z.string(), from: z.string(), to: z.string(), kind: z.enum(['calls','reads','writes','validates','transforms','authenticates','publishes','subscribes','retries','depends_on','transitions_to','configured_by','may_fail_at']),
  evidence: z.array(sourceEvidenceSchema), confidence: z.number().min(0).max(1)
});
export type LogisticsEdge = z.infer<typeof logisticsEdgeSchema>;

export const stateTransitionSchema = z.object({ entity: z.string(), from: z.string(), to: z.string(), evidence: z.array(sourceEvidenceSchema), guarded: z.boolean() });
export type StateTransition = z.infer<typeof stateTransitionSchema>;

export const invariantSchema = z.object({ id: z.string(), statement: z.string(), scopeNodeIds: z.array(z.string()), evidence: z.array(sourceEvidenceSchema), confidence: z.number().min(0).max(1) });
export type SystemInvariant = z.infer<typeof invariantSchema>;

export const systemFlowSchema = z.object({
  id: z.string(), name: z.string(), trigger: z.string(), orderedNodeIds: z.array(z.string()), inputContract: z.array(z.string()), outputContract: z.array(z.string()),
  sideEffects: z.array(z.string()), stateTransitions: z.array(stateTransitionSchema), invariants: z.array(invariantSchema), failurePoints: z.array(z.string()), externalDependencies: z.array(z.string()), confidence: z.number().min(0).max(1)
});
export type SystemFlow = z.infer<typeof systemFlowSchema>;

export const principleSchema = z.object({
  id: z.string(), statement: z.string(), scopeNodeIds: z.array(z.string()), scopeFlowIds: z.array(z.string()),
  provenance: z.array(z.enum(['code','test','type_or_schema','configuration','documentation','repeated_convention','human_approval'])),
  evidence: z.array(sourceEvidenceSchema), confidence: z.number().min(0).max(1), status: z.enum(['derived','human_approved','contested','deprecated']), approvedExceptionIds: z.array(z.string()), lastValidatedAt: z.number().optional()
});
export type CodebasePrinciple = z.infer<typeof principleSchema>;

export const findingSchema = z.object({
  id: z.string(), title: z.string(), category: z.enum(['state_flow','integration','dependency','data_consistency','validation','async_failure','configuration','authentication','reliability']),
  severity: z.enum(['low','medium','high','critical']), confidence: z.number().min(0).max(1), status: z.enum(['confirmed','probable','needs_human_review','rejected']),
  impact: z.string(), logicChain: z.array(z.string()), evidence: z.array(sourceEvidenceSchema), affectedNodeIds: z.array(z.string()), affectedFlowIds: z.array(z.string()),
  violatedInvariantIds: z.array(z.string()), businessImpact: z.string(), recommendation: z.string(), repairability: z.enum(['safe_automatic','guarded_automatic','human_required']), rejectionReason: z.string().optional()
}).superRefine((finding, context) => {
  if (finding.status === 'confirmed' && finding.evidence.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Confirmed findings require evidence', path: ['evidence'] });
});
export type WhiteboxFinding = z.infer<typeof findingSchema>;

export const dependencyHealthSchema = z.object({
  packageName: z.string(), configuredRange: z.string(), resolvedVersion: z.string().optional(), latestStableVersion: z.string().optional(), currentReleaseDate: z.string().optional(), latestReleaseDate: z.string().optional(),
  deprecated: z.boolean(), classification: z.enum(['healthy','aging','majorly_behind','deprecated','abandoned_signal']), importingFiles: z.array(z.string()), affectedNodeIds: z.array(z.string()), affectedFlowIds: z.array(z.string()),
  probableUpgradeComplexity: z.enum(['low','medium','high']), safeAction: z.enum(['none','patch_update','minor_update','manual_migration','replace_package']), evidenceSummary: z.string()
});
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export type RepairStatus = 'proposed'|'awaiting_approval'|'applying'|'validating'|'verified'|'reverted'|'escalated';
export type RepairRecord = { id:string; findingId:string; title:string; status:RepairStatus; intendedInvariant:string; affectedFlowIds:string[]; predictedBlastRadius:string; changedFiles:string[]; changedLineCount:number; patch:string; validationPlan:string[]; rollbackCondition:string; commitSha?:string; failureReason?:string };
export type ValidationRecord = { id:string; runId:string; repairId:string; check:'patch_apply'|'parse'|'json'|'dependency_resolution'|'typecheck'|'lint'|'tests'|'focused_tests'|'invariant'|'graph_diff'; status:'passed'|'failed'|'skipped'; durationMs?:number; summary:string; artifactUrl?:string };
export type RepositoryPreference = { id:string; category:'library'|'naming'|'error_handling'|'validation'|'architecture'|'testing'|'formatting'; value:string; source:'repository_evidence'|'explicit_human_approval'; evidence:SourceEvidence[]; confidence:number; active:boolean };
export type LivingSchemaSnapshot = { id:string; repositoryKey:string; version:number; parentSnapshotId?:string; sourceCommitSha?:string; createdAt:number; nodeIds:string[]; edgeIds:string[]; flowIds:string[]; principleIds:string[]; preferenceIds:string[]; dependencyRecordIds:string[]; confidenceSummary:string; fileFingerprints:Record<string,string> };
export type SchemaDelta = { id:string; runId:string; fromSnapshotId?:string; toSnapshotId:string; changedFiles:string[]; addedNodeIds:string[]; changedNodeIds:string[]; removedNodeIds:string[]; impactedFlowIds:string[]; addedPrincipleIds:string[]; changedPrincipleIds:string[]; resolvedFindingIds:string[]; newFindingIds:string[]; regressionFindingIds:string[]; conciseSummary:string };
export type EditorDiagnostic = { id:string; runId:string; findingId:string; path:string; startLine:number; endLine:number; severity:'information'|'warning'|'error'; title:string; flowLabel:string; principleStatement:string; impact:string; repairStatus:RepairStatus; dashboardUrl:string; githubPermalink?:string };
export type ExecutiveRunBrief = { headline:string; systemFlow:string; highestRisk:string; actionTaken:string; validation:string; nextAction?:string };
export type RepositoryFile = { path:string; content:string };
export type ManifestFile = { path:string; bytes:number; language:string; fingerprint:string };
export type RepositoryManifest = { files:ManifestFile[]; languages:{language:string; files:number; percentage:number}[]; ecosystems:string[]; manifests:string[]; validationCommands:string[]; unsupportedRegions:string[]; capability:{baseline:true; deepSemantic:boolean; verifiedRepair:boolean} };
export type AnalysisResult = { manifest:RepositoryManifest; nodes:LogisticsNode[]; edges:LogisticsEdge[]; flows:SystemFlow[]; principles:CodebasePrinciple[]; preferences:RepositoryPreference[]; findings:WhiteboxFinding[]; dependencies:DependencyHealth[]; repairs:RepairRecord[]; validations:ValidationRecord[]; snapshot:LivingSchemaSnapshot; editorDiagnostics:EditorDiagnostic[] };
