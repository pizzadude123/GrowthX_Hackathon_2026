import { internalMutation, internalQuery, query } from './_generated/server';
import { v } from 'convex/values';

import { projectPublicDelta, projectPublicDependency, projectPublicDiagnostic, projectPublicEdge, projectPublicFinding, projectPublicFlow, projectPublicNode, projectPublicRun, projectPublicSnapshot, projectPublicStep } from './lib/public_run';
import {producerEvidenceBound} from './lib/completion_binding';
import {WHITEBOX_RELEASE_SOURCE_DIGEST} from '../packages/core/src/release-identity';

export const listRecent = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query('runs').order('desc').take(50))
    .filter((run) => !['blocked', 'cancelled', 'failed'].includes(run.status))
    .slice(0, 10)
    .map(projectPublicRun),
});

export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.query('runs').withIndex('by_public_id', (q) => q.eq('publicId', args.publicId)).unique();
    if (!run) return null;
    const [steps, nodes, edges, flows, findings, dependencies, diagnostics, deltas, schemaSnapshot, workerJob] = await Promise.all([
      ctx.db.query('agentSteps').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('graphNodes').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('graphEdges').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('flows').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('findings').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('dependencies').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),

      ctx.db.query('editorDiagnostics').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('schemaDeltas').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      run.outputSchemaSnapshotId ? ctx.db.query('schemaSnapshots').withIndex('by_snapshot_id', (q) => q.eq('snapshotId', run.outputSchemaSnapshotId!)).first() : null,
      ctx.db.query('workerJobs').withIndex('by_run',(q)=>q.eq('runId',run._id)).first(),
    ]);
    const acceptedFindings = findings.filter((finding) => finding.status !== 'rejected');
    const schemaDocument = `# Whitebox Living Code Logistics Schema\n\nRun: ${run.publicId}\nRepository: ${run.repository}\nCommit: ${run.sourceCommitSha ?? 'unbound'}\nMode: audit_only\n\n## Flows\n${flows.map((flow) => `- ${flow.name}`).join('\n') || '- None'}\n\n## Confirmed findings\n${acceptedFindings.filter((finding) => finding.status === 'confirmed').map((finding) => `- ${finding.severity.toUpperCase()} · ${finding.title}`).join('\n') || '- None'}\n`;

    const publicSteps=steps.filter((step)=>!step.analysisAttemptId||step.analysisAttemptId===workerJob?.currentAttemptId).map(projectPublicStep);
    return { run: projectPublicRun(run), steps:publicSteps, nodes:nodes.map(projectPublicNode), edges:edges.map(projectPublicEdge), flows:flows.map(projectPublicFlow), findings:acceptedFindings.map(projectPublicFinding), dependencies:dependencies.map(projectPublicDependency), diagnostics:diagnostics.map(projectPublicDiagnostic), deltas:deltas.map(projectPublicDelta), schemaSnapshot:schemaSnapshot ? projectPublicSnapshot(schemaSnapshot,schemaDocument) : null };
  },
});

export const patch = internalMutation({
  args: { runId: v.id('runs'), patch: v.any() },
  handler: async (ctx, args) => ctx.db.patch(args.runId, args.patch),
});


export const releaseEvidence = internalQuery({
  args: { publicId:v.string(),expectedTreeSha:v.string(),expectedSourceDigest:v.string() },
  handler: async (ctx,args) => {
    const run=await ctx.db.query('runs').withIndex('by_public_id',q=>q.eq('publicId',args.publicId)).unique();
    if(!run)return null;
    const [job,findings,flows,outbox]=await Promise.all([
      ctx.db.query('workerJobs').withIndex('by_run',q=>q.eq('runId',run._id)).first(),
      ctx.db.query('findings').withIndex('by_run',q=>q.eq('runId',run._id)).collect(),
      ctx.db.query('flows').withIndex('by_run',q=>q.eq('runId',run._id)).collect(),
      ctx.db.query('deliveryOutbox').withIndex('by_run',q=>q.eq('runId',run._id)).collect(),
    ]);
    const attempt=job?.currentAttemptId?await ctx.db.query('analysisAttempts').withIndex('by_attempt_id',q=>q.eq('attemptId',job.currentAttemptId!)).unique():null,delivery=outbox[0];
    const checks={
      releaseTreeBound:run.releaseTreeSha===args.expectedTreeSha&&/^[a-f0-9]{40}$/.test(args.expectedTreeSha),
      releaseSourceBound:args.expectedSourceDigest===WHITEBOX_RELEASE_SOURCE_DIGEST&&run.releaseSourceDigest===WHITEBOX_RELEASE_SOURCE_DIGEST&&attempt?.releaseSourceDigest===WHITEBOX_RELEASE_SOURCE_DIGEST,
      terminalAuditOnly:run.status==='audit_only'&&run.currentStage==='audit_only'&&run.mode==='audit_only'&&job?.status==='completed'&&attempt?.status==='completed',
      sourceBound:!!run.sourceCommitSha&&run.sourceCommitSha===attempt?.sourceCommitSha&&run.sourceCommitSha===(run.requestedSourceCommitSha??run.sourceCommitSha)&&run.snapshotDigest===attempt?.snapshotDigest&&!!run.snapshotManifest?.length&&run.snapshotManifest.length===attempt?.snapshotManifest?.length&&!!attempt?.coverageDigest&&!!attempt.coverageDispositions,
      producersBound:producerEvidenceBound(run,attempt),
      runtimeBound:!!run.runtimeIdentityDigest&&run.runtimeIdentityDigest===attempt?.runtimeIdentityDigest&&run.runtimeProcessPid===attempt?.runtimeProcessPid&&run.runtimeBootNonce===attempt?.runtimeBootNonce&&!!run.roleProofDigest,
      canonicalReconciled:!!run.resultDigest&&run.resultDigest===attempt?.resultDigest&&run.confirmedFindingCount===findings.filter(finding=>finding.status==='confirmed').length&&run.rejectedFindingCount===findings.filter(finding=>finding.status==='rejected').length&&run.flowCount===flows.length&&run.mappedFiles===run.snapshotManifest?.length,
      deliveryBound:outbox.length===1&&run.deliveryStatus==='delivered'&&delivery?.status==='delivered'&&delivery.messageStatus==='delivered'&&delivery.attachmentStatus==='delivered'&&!!delivery.messageReceiptDigest&&!!delivery.attachmentReceiptDigest&&/^[1-9]\d*$/.test(delivery.messagePlatformReceiptId??'')&&/^[1-9]\d*$/.test(delivery.attachmentPlatformReceiptId??''),
    };
    return{version:'whitebox-release-evidence-v2',publicId:run.publicId,releaseTreeSha:run.releaseTreeSha,releaseSourceDigest:WHITEBOX_RELEASE_SOURCE_DIGEST,sourceCommitSha:run.sourceCommitSha,runtimeIdentityDigest:run.runtimeIdentityDigest,checks,passed:Object.values(checks).every(Boolean)};
  },
});

export const getByInternalId = internalQuery({ args: { runId: v.id('runs') }, handler: async (ctx, args) => ctx.db.get(args.runId) });
export const getRunByPublicIdInternal = internalQuery({ args: { publicId: v.string() }, handler: async (ctx, args) => ctx.db.query('runs').withIndex('by_public_id', (q) => q.eq('publicId', args.publicId)).unique() });
export const getLatestByRepositoryInternal = internalQuery({ args: { repository: v.string() }, handler: async (ctx, args) => ctx.db.query('runs').withIndex('by_repository', (q) => q.eq('repository', args.repository)).order('desc').first() });
