import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import { parseGitHubRepository, resolveRunMode } from '../packages/core/src/security.js';

export const start = internalMutation({
  args: { repoUrl: v.string(), goal: v.string(), telegramUserId: v.optional(v.string()), telegramChatId: v.optional(v.string()), telegramThreadId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const repo = parseGitHubRepository(args.repoUrl);
    const goal = args.goal.trim() || 'stabilize critical flows';
    if (goal.length > 240) throw new Error('Goal must be 240 characters or fewer');
    const now = Date.now();
    const recent = await ctx.db.query('runs').withIndex('by_repository', (query) => query.eq('repository', repo.key)).order('desc').first();
    if (recent && now - recent.createdAt < 30_000 && recent.goal === goal && recent.telegramUserId === args.telegramUserId && !['blocked','cancelled','failed'].includes(recent.status)) {
      return { publicId: recent.publicId, runId: recent._id, repository: recent.repository, mode: recent.mode, dashboardUrl: `${process.env.PUBLIC_APP_URL ?? ''}/runs/${recent.publicId}` };
    }
    const publicId = `WB-${Date.now().toString(36).toUpperCase()}`;
    const mode = process.env.WHITEBOX_ENABLE_GUARDED_REPAIR === 'true'
      ? resolveRunMode(repo.key, process.env.GITHUB_REPAIR_ALLOWLIST ?? '')
      : 'audit_only';
    const runId = await ctx.db.insert('runs', {
      publicId,
      telegramUserId: args.telegramUserId,
      telegramChatId: args.telegramChatId,
      telegramThreadId: args.telegramThreadId,
      repository: repo.key,
      owner: repo.owner,
      name: repo.name,
      goal,
      mode,
      status: 'accepted',
      currentStage: 'accepted',
      promptVersion: 'whitebox-agency-v3-evidence',
      createdAt: now,
      dashboardSlug: publicId,
      mappedFiles: 0,
      flowCount: 0,
      confirmedFindingCount: 0,
      rejectedFindingCount: 0,
      verifiedRepairCount: 0,
      revertedRepairCount: 0,
      dependencyRiskCount: 0,
      analysisMode: 'initial_full',
      changedFileCount: 0,
      impactedFlowCount: 0,
      paused: false,
      conservativeRepair: true,
    });
    await ctx.db.insert('workerJobs', {
      runId,
      repoUrl: repo.canonicalUrl,
      status: 'queued',
      attempts: 0,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return {
      publicId,
      runId,
      repository: repo.key,
      mode,
      dashboardUrl: `${process.env.PUBLIC_APP_URL ?? ''}/runs/${publicId}`,
    };
  },
});
