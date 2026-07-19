import { internalMutation, internalQuery, query } from './_generated/server';
import { v } from 'convex/values';
import { replaceCanonicalAnalysis } from './lib/persist_analysis';

export const listRecent = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query('runs').order('desc').take(50))
    .filter((run) => !['blocked', 'cancelled', 'failed'].includes(run.status))
    .slice(0, 10)
    .map(publicRun),
});

export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db.query('runs').withIndex('by_public_id', (q) => q.eq('publicId', args.publicId)).unique();
    if (!run) return null;
    const [steps, nodes, edges, flows, findings, dependencies, repairs, validations, diagnostics, deltas, schemaSnapshot, evalCases] = await Promise.all([
      ctx.db.query('agentSteps').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('graphNodes').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('graphEdges').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('flows').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('findings').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('dependencies').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('repairs').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('validations').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('editorDiagnostics').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      ctx.db.query('schemaDeltas').withIndex('by_run', (q) => q.eq('runId', run._id)).collect(),
      run.outputSchemaSnapshotId ? ctx.db.query('schemaSnapshots').withIndex('by_snapshot_id', (q) => q.eq('snapshotId', run.outputSchemaSnapshotId!)).first() : null,
      ctx.db.query('evalCases').collect(),
    ]);
    return { run: publicRun(run), steps, nodes, edges, flows, findings, dependencies, repairs, validations, diagnostics, deltas, schemaSnapshot, evalCases: evalCases.map(({ caseId, name, version }) => ({ caseId, name, version })) };
  },
});

export const patch = internalMutation({
  args: { runId: v.id('runs'), patch: v.any() },
  handler: async (ctx, args) => ctx.db.patch(args.runId, args.patch),
});

export const persistAnalysis = internalMutation({
  args: { runId: v.id('runs'), repositoryKey: v.string(), analysis: v.any() },
  handler: async (ctx, args) => {
    const summary = await replaceCanonicalAnalysis(ctx, args);
    const terminal = ['completed','audit_only','partial','blocked','cancelled'].includes(summary.run.status);
    await ctx.db.patch(args.runId, {
      ...(terminal ? {} : { status: 'auditing', currentStage: 'auditing' }),
      mappedFiles: summary.mappedFiles,
      flowCount: summary.flowCount,
      confirmedFindingCount: summary.confirmedFindingCount,
      rejectedFindingCount: summary.rejectedFindingCount,
      dependencyRiskCount: summary.dependencyRiskCount,
      outputSchemaSnapshotId: summary.outputSchemaSnapshotId,
      capabilityProfile: summary.capabilityProfile,
    });
    return { ok: true };
  },
});

export const getByInternalId = internalQuery({ args: { runId: v.id('runs') }, handler: async (ctx, args) => ctx.db.get(args.runId) });
export const getRunByPublicIdInternal = internalQuery({ args: { publicId: v.string() }, handler: async (ctx, args) => ctx.db.query('runs').withIndex('by_public_id', (q) => q.eq('publicId', args.publicId)).unique() });
export const getLatestByRepositoryInternal = internalQuery({ args: { repository: v.string() }, handler: async (ctx, args) => ctx.db.query('runs').withIndex('by_repository', (q) => q.eq('repository', args.repository)).order('desc').first() });

function publicRun<T extends Record<string, unknown>>(run: T) {
  const safe: Record<string, unknown> = { ...run };
  delete safe.telegramUserId;
  delete safe.telegramChatId;
  delete safe.telegramThreadId;
  delete safe.telegramMessageId;
  delete safe.pdfMessageId;
  delete safe.userId;
  return safe;
}
